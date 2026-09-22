import type { INestApplication } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ledgerInvariants } from '../../db/ledger/invariants';
import { NotificationService } from '../../common/notifications/notification.service';
import { seedAdmin, seedCustomer, seedDriver, setupTestDatabase, truncateAll } from '../../test/db';
import type { TestDatabase } from '../../test/db';
import { createTestApp } from '../../test/app';
import { seedBooking } from '../../test/fixtures';
import { closeTestRedis, flushTestRedis } from '../../test/redis';
import { PaymentReconcileService } from './payment-reconcile.service';
import { PaymentsService } from './payments.service';

/**
 * W9 decision (2) — CAPTURE-AFTER-CANCEL.
 *
 * A booking is cancelled while its checkout sheet is still open; the customer
 * pays anyway (a stale sheet, a late UPI debit, a webhook that finally lands).
 * The gateway's money is REAL, and the pre-W9 behaviour — throwing 409 from
 * `settleInner` because the booking is not `completed` — left that capture
 * invisible to every ledger read and re-alerting the sweep forever.
 *
 * What this spec pins, in the order the operator experiences it:
 * 1. the capture is RECORDED on the payment row (it happened — the ledger must
 *    not pretend otherwise);
 * 2. the booking does NOT move (the customer cancelled it; the refund path
 *    leaves it where it is);
 * 3. exactly ONE ops alert per payment, however many times the capture is
 *    seen — the trigger's dedupe key is the payment id;
 * 4. no settlement legs: nobody is owed a share of a cancelled trip;
 * 5. all five invariants stay zero, and a capture on a non-terminal booking
 *    still 409s — the branch is `cancelled` only.
 */
describe('W9 — capture after cancel (PaymentsService)', () => {
  let app: INestApplication;
  let db: TestDatabase;
  let payments: PaymentsService;
  let reconcile: PaymentReconcileService;
  let notifications: NotificationService;
  let emitSpy: ReturnType<typeof vi.spyOn>;
  let userId: string;
  let driverId: string;

  beforeAll(async () => {
    db = await setupTestDatabase();
    app = await createTestApp();
    payments = app.get(PaymentsService);
    reconcile = app.get(PaymentReconcileService);
    notifications = app.get(NotificationService);
  });

  afterAll(async () => {
    await app.close();
    await closeTestRedis();
  });

  beforeEach(async () => {
    await truncateAll();
    await flushTestRedis();
    await seedAdmin(db, { subRole: 'super_admin' });
    userId = await seedCustomer(db, 'Conflict Customer');
    driverId = await seedDriver(db, { name: 'Conflict Driver' });
    emitSpy = vi.spyOn(notifications, 'emit');
    // `vi.spyOn` on an already-spied method hands back the SAME spy, so a
    // fresh `spyOn` per test would still count every earlier test's calls.
    emitSpy.mockClear();
  });

  const handle = {
    gatewayRef: 'pay_dev_conflict_1',
    orderRef: 'order_dev_conflict_1',
    status: 'captured' as const,
    method: 'upi' as const,
    // The dev adapter returns null amounts by design; the conflict path does
    // not need one (nothing is credited).
    amountPaise: null,
  };

  /** A cancelled booking with the checkout sheet that was still open at the time. */
  async function seedCancelledWithOpenIntent(): Promise<string> {
    const bookingId = await seedBooking(db, {
      userId,
      driverId: null,
      status: 'cancelled',
      total: '750.00',
    });
    await db.execute(sql`
      insert into payments (booking_id, amount, tax_amount, purpose, method, status,
                            idempotency_key, provider, gateway_order_ref)
      values (${bookingId}::uuid, 750.00, 0, 'booking', 'upi', 'pending',
              ${`pay:v1:conflict:${bookingId}`}, 'dev', ${handle.orderRef})
    `);
    return bookingId;
  }

  it('records the capture, alerts ops once per payment, and leaves the booking cancelled', async () => {
    const bookingId = await seedCancelledWithOpenIntent();

    await payments.settleCapturedPayment(bookingId, handle);

    // (1) The money is real and recorded.
    const [payment] = (await db.execute(sql`
      select status, gateway_ref, captured_at from payments where booking_id = ${bookingId}::uuid
    `)) as unknown as [{ status: string; gateway_ref: string; captured_at: Date | null }];
    expect(payment.status).toBe('captured');
    expect(payment.gateway_ref).toBe(handle.gatewayRef);
    expect(payment.captured_at).not.toBeNull();

    // (2) The booking does not move — the customer cancelled it.
    const [booking] = (await db.execute(sql`
      select status from bookings where id = ${bookingId}::uuid
    `)) as unknown as [{ status: string }];
    expect(booking.status).toBe('cancelled');

    // (4) No settlement legs: nobody is owed a share of a cancelled trip.
    const [legs] = (await db.execute(sql`
      select count(*)::int as n from wallet_transactions where ref_id = ${bookingId}::uuid
    `)) as unknown as [{ n: number }];
    expect(legs.n).toBe(0);

    // (3) One ops alert, naming the booking and the amount.
    expect(emitSpy).toHaveBeenCalledWith(
      'finance.settlement_conflict',
      expect.objectContaining({ bookingId, amountPaise: 75_000 }),
    );

    // A second sighting of the same capture (webhook redelivery, sweep pass)
    // asks the registry to emit again — and the DEDUPE, not the caller, is what
    // keeps the alarm to one: the trigger's key is the payment id, so the
    // second emit resolves to null rather than a second email.
    await payments.settleCapturedPayment(bookingId, handle);
    expect(emitSpy).toHaveBeenCalledTimes(2);
    const results = emitSpy.mock.results.map(
      (entry: { value: unknown }) => entry.value as Promise<unknown> | null,
    );
    await expect(results[0]).resolves.not.toBeNull();
    await expect(results[1]).resolves.toBeNull();

    // (5) The ledger is untouched and the invariants agree.
    await expect(ledgerInvariants(db)).resolves.toEqual({
      walletDrift: 0,
      bookingDrift: 0,
      ledgerDrift: 0,
      reversalDrift: 0,
      couponDrift: 0,
    });
  });

  it('the §14.2 recheck reports the recorded capture for Finance to refund', async () => {
    const bookingId = await seedCancelledWithOpenIntent();
    await payments.settleCapturedPayment(bookingId, handle);

    const result = await reconcile.recheckBooking(bookingId);
    expect(result.paymentStatus).toBe('captured');
    expect(result.settled).toBe(true);
  });

  it('a capture on a booking that is neither completed nor cancelled still 409s', async () => {
    const bookingId = await seedBooking(db, { userId, status: 'searching' });
    await db.execute(sql`
      insert into payments (booking_id, amount, tax_amount, purpose, method, status,
                            idempotency_key, provider, gateway_order_ref)
      values (${bookingId}::uuid, 750.00, 0, 'booking', 'upi', 'pending',
              ${`pay:v1:searching:${bookingId}`}, 'dev', 'order_dev_searching_1')
    `);

    await expect(
      payments.settleCapturedPayment(bookingId, {
        ...handle,
        gatewayRef: 'pay_dev_searching_1',
        orderRef: 'order_dev_searching_1',
      }),
    ).rejects.toMatchObject({ status: 409 });

    // Nothing was recorded and nothing alerted — this is still a genuine bug
    // state, not a recoverable conflict.
    const [payment] = (await db.execute(sql`
      select status from payments where booking_id = ${bookingId}::uuid
    `)) as unknown as [{ status: string }];
    expect(payment.status).toBe('pending');
    expect(emitSpy).not.toHaveBeenCalled();
  });
});
