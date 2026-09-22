import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { rupeeStringToPaise } from '@towing/api-contracts';
import { createTestApp, customerAuthHeaderFor, driverAuthHeaderFor } from '../../test/app';
import {
  seedCustomer,
  seedDriver,
  setupTestDatabase,
  truncateAll,
  type TestDatabase,
} from '../../test/db';
import { seedBooking } from '../../test/fixtures';
import { ledgerInvariants } from '../../db/ledger/invariants';

/**
 * Figma 27's cash flow, end to end.
 *
 * The customer picks cash (booking stays `completed`), the driver confirms
 * collection (booking becomes `paid`), and the driver's wallet goes NEGATIVE by
 * the commission — the pool is credited at capture-equivalent time and the
 * commission is debited, so the driver owes the platform the fee.
 *
 * EVERY TEST ASSERTS THE INVARIANTS ARE ZERO AT ITS END, matching the capture
 * spec: the first real drift should not be discovered by the nightly job.
 */
describe('cash payment e2e (/v1/payments/:bookingId/cash, /v1/jobs/:id/cash-collected)', () => {
  let app: INestApplication;
  let db: TestDatabase;
  let auth: string;
  let userId: string;
  let driverId: string;
  let driverAuth: string;
  let bookingId: string;

  beforeAll(async () => {
    db = await setupTestDatabase();
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await truncateAll();
    userId = await seedCustomer(db, 'Cash Customer');
    auth = await customerAuthHeaderFor(app, { userId });
    driverId = await seedDriver(db, { name: 'Cash Driver' });
    driverAuth = await driverAuthHeaderFor(app, { driverId });
    // ₹2,000, Band A (10 %), independent driver — the simplest settlement
    // there is, so a failure here is never about the split.
    bookingId = await seedBooking(db, {
      userId,
      driverId,
      status: 'completed',
      total: '2000.00',
    });
    await db.execute(sql`
      update bookings set commission_band = 'A', commission_pct = 10
       where id = ${bookingId}::uuid
    `);
  });

  /** Every test ends here. */
  const expectNoDrift = async (): Promise<void> => {
    await expect(ledgerInvariants(db)).resolves.toEqual({
      walletDrift: 0,
      bookingDrift: 0,
      ledgerDrift: 0,
      reversalDrift: 0,
      couponDrift: 0,
    });
  };

  const chooseCash = () =>
    request(app.getHttpServer())
      .post(`/v1/payments/${bookingId}/cash`)
      .set('Authorization', auth)
      .send({});

  const collectCash = (token = driverAuth) =>
    request(app.getHttpServer())
      .post(`/v1/jobs/${bookingId}/cash-collected`)
      .set('Authorization', token)
      .send({});

  const legCount = async (): Promise<number> => {
    const [row] = (await db.execute(sql`
      select count(*)::int as count from wallet_transactions where ref_id = ${bookingId}::uuid
    `)) as unknown as [{ count: number }];
    return row.count;
  };

  const driverWalletBalancePaise = async (): Promise<number> => {
    const [row] = (await db.execute(sql`
      select balance from wallets
       where owner_type = 'driver' and owner_id = ${driverId}::uuid
    `)) as unknown as [{ balance: string } | undefined];
    return row ? rupeeStringToPaise(row.balance) : 0;
  };

  it('customer chooses cash: awaiting_cash, booking still completed, idempotent', async () => {
    const first = await chooseCash().expect(200);
    expect(first.body.status).toBe('awaiting_cash');
    expect(first.body.amountPaise).toBe(200_000);

    const [booking] = (await db.execute(sql`
      select status from bookings where id = ${bookingId}::uuid
    `)) as unknown as [{ status: string }];
    expect(booking.status).toBe('completed');

    const second = await chooseCash().expect(200);
    expect(second.body.paymentId).toBe(first.body.paymentId);
    expect(second.body.status).toBe('awaiting_cash');

    await expectNoDrift();
  });

  it('driver confirms: paid, cash method, wallet negative by commission, replay is a no-op', async () => {
    await chooseCash().expect(200);

    const result = await collectCash().expect(200);
    expect(result.body.bookingStatus).toBe('paid');

    const [booking] = (await db.execute(sql`
      select status, payment_method from bookings where id = ${bookingId}::uuid
    `)) as unknown as [{ status: string; payment_method: string }];
    expect(booking.status).toBe('paid');
    expect(booking.payment_method).toBe('cash');

    // Pool credited (₹1,800) minus commission (₹200) = −₹200.
    expect(await driverWalletBalancePaise()).toBe(-20_000);

    const legsAfterFirst = await legCount();
    expect(legsAfterFirst).toBeGreaterThan(0);

    const replay = await collectCash().expect(200);
    expect(replay.body.bookingStatus).toBe('paid');
    expect(await legCount()).toBe(legsAfterFirst);

    await expectNoDrift();
  });

  it('driver confirms without the customer choosing cash → 409', async () => {
    await collectCash().expect(409);
    await expectNoDrift();
  });

  it('a different driver → 404', async () => {
    await chooseCash().expect(200);

    const otherDriverId = await seedDriver(db, { name: 'Other Driver' });
    const otherAuth = await driverAuthHeaderFor(app, { driverId: otherDriverId });

    await collectCash(otherAuth).expect(404);
    await expectNoDrift();
  });

  it('switching to a normal intent fails the cash row and blocks collection', async () => {
    await chooseCash().expect(200);

    await request(app.getHttpServer())
      .post(`/v1/payments/${bookingId}/intent`)
      .set('Authorization', auth)
      .set('Idempotency-Key', randomUUID())
      .send({ purpose: 'booking' })
      .expect(201);

    const [cashRow] = (await db.execute(sql`
      select status from payments
       where booking_id = ${bookingId}::uuid and method = 'cash'
    `)) as unknown as [{ status: string } | undefined];
    expect(cashRow?.status).toBe('failed');

    await collectCash().expect(409);
    await expectNoDrift();
  });
});
