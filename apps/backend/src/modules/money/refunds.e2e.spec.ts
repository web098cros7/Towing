import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ledgerInvariants } from '../../db/ledger/invariants';
import { seedAdmin, seedCustomer, seedDriver, setupTestDatabase, truncateAll } from '../../test/db';
import type { TestDatabase } from '../../test/db';
import { createTestApp } from '../../test/app';
import { seedBooking, seedWalletWithLedger } from '../../test/fixtures';
import { closeTestRedis, flushTestRedis } from '../../test/redis';
import { RefundsService } from './refunds.service';

/**
 * A8 — `RefundsService.refundBooking` completes (this service had no test).
 *
 * The bug: `paid` was terminal with no outgoing edges while `refundBooking`
 * ends by transitioning to `cancelled`/`disputed` — so it threw 409 AFTER the
 * gateway refund and the compensating legs had already run. Every test below
 * asserts all five ledger invariants are zero: money paths prove them, always.
 */
describe('refunds e2e (/v1 money, RefundsService)', () => {
  let app: INestApplication;
  let db: TestDatabase;
  let refunds: RefundsService;
  let adminId: string;
  let userId: string;
  let driverId: string;

  beforeAll(async () => {
    db = await setupTestDatabase();
    app = await createTestApp();
    refunds = app.get(RefundsService);
  });

  afterAll(async () => {
    await app.close();
    await closeTestRedis();
  });

  beforeEach(async () => {
    await truncateAll();
    await flushTestRedis();

    adminId = (await seedAdmin(db, { subRole: 'super_admin' })).id;
    userId = await seedCustomer(db, 'Refund Customer');
    driverId = await seedDriver(db, { name: 'Refund Driver' });
  });

  const expectNoDrift = async (): Promise<void> => {
    await expect(ledgerInvariants(db)).resolves.toEqual({
      walletDrift: 0,
      bookingDrift: 0,
      ledgerDrift: 0,
      reversalDrift: 0,
      couponDrift: 0,
    });
  };

  const status = async (booking: string): Promise<string> => {
    const [row] = (await db.execute(sql`
      select status from bookings where id = ${booking}::uuid
    `)) as unknown as [{ status: string }];
    return row.status;
  };

  const legs = async (booking: string) => {
    const rows = (await db.execute(sql`
      select type, amount::text as amount from wallet_transactions
       where ref_id = ${booking}::uuid order by created_at
    `)) as unknown as Array<{ type: string; amount: string }>;
    return rows;
  };

  /**
   * A settled paid booking: money columns balance (1000 = 100 + 900 + 0 tax),
   * a captured dev-gateway payment, and the driver's settlement leg — the
   * exact shape Phase 19's capture leaves behind.
   */
  const seedPaidBooking = async (): Promise<string> => {
    const bookingId = await seedBooking(db, {
      userId,
      driverId,
      status: 'paid',
      total: '1000.00',
      commissionAmount: '100.00',
      driverPayout: '900.00',
    });
    await db.execute(sql`
      insert into payments (booking_id, amount, tax_amount, purpose, method, status,
                            idempotency_key, provider, gateway_ref)
      values (${bookingId}::uuid, 1000.00, 0, 'booking', 'upi', 'captured',
              ${`pay:v1:test:${bookingId}:${randomUUID()}`}, 'dev', ${`pay_dev_${randomUUID().slice(0, 8)}`})
    `);
    await seedWalletWithLedger(db, { ownerType: 'driver', ownerId: driverId }, [
      { type: 'driver_share_credit', amount: '900.00', refId: bookingId },
    ]);
    return bookingId;
  };

  it('a full refund of a paid booking completes: gateway, legs, move, markRefunded', async () => {
    const bookingId = await seedPaidBooking();

    const result = await refunds.refundBooking({
      bookingId,
      reason: 'cancellation',
      initiatedBy: adminId,
      transitionTo: 'disputed',
    });

    expect(result.replayed).toBe(false);

    // Gateway refunded through the dev adapter.
    const [refund] = (await db.execute(sql`
      select status, gateway_ref from refunds where id = ${result.refundId}::uuid
    `)) as unknown as [{ status: string; gateway_ref: string }];
    expect(refund.status).toBe('processed');
    expect(refund.gateway_ref).toMatch(/^rfnd_dev_/);

    // Compensating leg negates the original credit; the original is untouched.
    expect(await legs(bookingId)).toEqual([
      { type: 'driver_share_credit', amount: '900.00' },
      { type: 'refund_debit', amount: '-900.00' },
    ]);

    // Booking moved (paid → disputed is legal since A8) with history.
    expect(await status(bookingId)).toBe('disputed');
    const [history] = (await db.execute(sql`
      select status, actor from booking_status_history
       where booking_id = ${bookingId}::uuid order by created_at desc limit 1
    `)) as unknown as [{ status: string; actor: string }];
    expect(history).toMatchObject({ status: 'disputed', actor: 'system' });

    // The booking's own money columns are never rewritten by a refund.
    const [money] = (await db.execute(sql`
      select total::text as total, commission_amount::text as commission,
             driver_payout::text as payout from bookings where id = ${bookingId}::uuid
    `)) as unknown as [{ total: string; commission: string; payout: string }];
    expect(money).toEqual({ total: '1000.00', commission: '100.00', payout: '900.00' });

    // markRefunded reached.
    const [payment] = (await db.execute(sql`
      select status from payments where booking_id = ${bookingId}::uuid
    `)) as unknown as [{ status: string }];
    expect(payment.status).toBe('refunded');

    await expectNoDrift();
  });

  it('transitionTo null skips the status write when the booking is already placed', async () => {
    const bookingId = await seedPaidBooking();
    await db.execute(sql`
      update bookings set status = 'disputed', updated_at = now() where id = ${bookingId}::uuid
    `);

    const result = await refunds.refundBooking({
      bookingId,
      reason: 'dispute',
      initiatedBy: adminId,
      transitionTo: null,
    });

    expect(result.replayed).toBe(false);
    // Money settled, status untouched.
    expect(await status(bookingId)).toBe('disputed');
    expect(await legs(bookingId)).toEqual([
      { type: 'driver_share_credit', amount: '900.00' },
      { type: 'refund_debit', amount: '-900.00' },
    ]);
    const [payment] = (await db.execute(sql`
      select status from payments where booking_id = ${bookingId}::uuid
    `)) as unknown as [{ status: string }];
    expect(payment.status).toBe('refunded');

    await expectNoDrift();
  });

  it('a replayed refund moves no money twice', async () => {
    const bookingId = await seedPaidBooking();
    // A crash between the refund row and the transition leaves exactly this:
    // the row exists, the payment is still captured.
    await db.execute(sql`
      insert into refunds (booking_id, amount, reason, status, idempotency_key, initiated_by)
      values (${bookingId}::uuid, 1000.00, 'cancellation', 'processed',
              ${`rf:v1:${bookingId}:cancellation`}, ${adminId})
    `);

    const result = await refunds.refundBooking({
      bookingId,
      reason: 'cancellation',
      initiatedBy: adminId,
      transitionTo: 'disputed',
    });

    expect(result).toMatchObject({ replayed: true });
    // Nothing else ran: booking unmoved, no legs, payment still captured.
    expect(await status(bookingId)).toBe('paid');
    expect(await legs(bookingId)).toEqual([{ type: 'driver_share_credit', amount: '900.00' }]);

    await expectNoDrift();
  });

  it('refuses with 409 before writing anything when no payment was captured', async () => {
    // A coherent paid booking (settlement legs present) with no captured
    // payment row — the refund must stop before its first write. Note a paid
    // booking with NO legs is itself `ledgerDrift` by definition (A9's
    // insight), so the legs are seeded to keep this test about the 409.
    const bookingId = await seedBooking(db, {
      userId,
      driverId,
      status: 'paid',
      total: '1000.00',
      commissionAmount: '100.00',
      driverPayout: '900.00',
    });
    await seedWalletWithLedger(db, { ownerType: 'driver', ownerId: driverId }, [
      { type: 'driver_share_credit', amount: '900.00', refId: bookingId },
    ]);

    await expect(
      refunds.refundBooking({
        bookingId,
        reason: 'cancellation',
        initiatedBy: adminId,
        transitionTo: 'disputed',
      }),
    ).rejects.toMatchObject({ status: 409 });

    const [row] = (await db.execute(sql`
      select count(*)::int as count from refunds where booking_id = ${bookingId}::uuid
    `)) as unknown as [{ count: number }];
    expect(row.count).toBe(0);
    expect(await status(bookingId)).toBe('paid');

    await expectNoDrift();
  });
});
