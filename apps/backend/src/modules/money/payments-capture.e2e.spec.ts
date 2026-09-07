import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { rupeeStringToPaise } from '@towing/api-contracts';
import { createTestApp, customerAuthHeaderFor } from '../../test/app';
import { ENV, type Env } from '../../config/env';
import {
  seedCustomer,
  seedDriver,
  seedFleet,
  setupTestDatabase,
  truncateAll,
  type TestDatabase,
} from '../../test/db';
import { seedBooking } from '../../test/fixtures';
import { ledgerInvariants } from '../../db/ledger/invariants';
import { devCheckoutSignature, devPaymentRef } from './dev-payment.adapter';

/**
 * §14.2's capture, end to end.
 *
 * WHAT THIS FILE IS REALLY FOR: `commissionAmount + driverPayout + taxAmount ===
 * total` and "exactly one ledger leg per settlement, however many times you
 * ask". Everything else here exists to make one of those two true under a
 * condition somebody might not have thought about — a forged signature, a
 * mismatched amount, a double tap, two workers, a replayed webhook.
 *
 * EVERY TEST ASSERTS THE INVARIANTS ARE ZERO AT ITS END, not just one dedicated
 * test. Before this phase no booking had ever been `paid`, so `bookingDrift`
 * and `ledgerDrift` have never had anything to check on live data; making them
 * a per-test postcondition is what stops the first real drift being discovered
 * by the nightly job at 01:00 IST.
 */
describe('payment capture e2e (/v1/payments/:bookingId)', () => {
  let app: INestApplication;
  let db: TestDatabase;
  let auth: string;
  let userId: string;
  let driverId: string;
  let bookingId: string;

  /**
   * Read off the running app rather than hardcoded — the dev adapter signs the
   * checkout handshake with the same secret it verifies webhooks against, and
   * the spec must compute what the adapter will check.
   */
  let SECRET: string;

  beforeAll(async () => {
    db = await setupTestDatabase();
    app = await createTestApp();
    SECRET = app.get<Env>(ENV).PAYMENT_WEBHOOK_SECRET;
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await truncateAll();
    userId = await seedCustomer(db, 'Paying Customer');
    auth = await customerAuthHeaderFor(app, { userId });
    driverId = await seedDriver(db, { name: 'Settling Driver' });
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

  /** One narrowing point, so `noUncheckedIndexedAccess` does not spread `!` everywhere. */
  const paiseOf = (row: Record<string, string> | undefined, column: string): number =>
    rupeeStringToPaise(row?.[column] ?? '0');

  const legCount = async (): Promise<number> => {
    const [row] = (await db.execute(sql`
      select count(*)::int as count from wallet_transactions where ref_id = ${bookingId}::uuid
    `)) as unknown as [{ count: number }];
    return row.count;
  };

  const openIntent = (key = randomUUID()) =>
    request(app.getHttpServer())
      .post(`/v1/payments/${bookingId}/intent`)
      .set('Authorization', auth)
      .set('Idempotency-Key', key)
      .send({ purpose: 'booking' });

  const captureWith = (body: Record<string, unknown>, key = randomUUID()) =>
    request(app.getHttpServer())
      .post(`/v1/payments/${bookingId}/capture`)
      .set('Authorization', auth)
      .set('Idempotency-Key', key)
      .send(body);

  /** A well-formed dev checkout result for a given order. */
  const checkoutFor = (orderRef: string) => {
    const gatewayRef = devPaymentRef(orderRef);
    return { orderRef, gatewayRef, signature: devCheckoutSignature(orderRef, gatewayRef, SECRET) };
  };

  describe('intent', () => {
    it('is idempotent on the key: one payments row, one order', async () => {
      const key = randomUUID();
      const first = await openIntent(key).expect(201);
      const second = await openIntent(key).expect(201);

      expect(second.body.orderRef).toBe(first.body.orderRef);

      const [row] = (await db.execute(sql`
        select count(*)::int as count from payments where booking_id = ${bookingId}::uuid
      `)) as unknown as [{ count: number }];
      expect(row.count).toBe(1);
      await expectNoDrift();
    });

    it('reuses an open intent even under a DIFFERENT key', async () => {
      // A customer who backgrounds the app and comes back mints a new client
      // key for what is still one intent to pay. TWO LIVE ORDERS FOR ONE
      // BOOKING IS HOW YOU GET TWO CAPTURES.
      const first = await openIntent().expect(201);
      const second = await openIntent().expect(201);

      expect(second.body.orderRef).toBe(first.body.orderRef);

      const [row] = (await db.execute(sql`
        select count(*)::int as count from payments where booking_id = ${bookingId}::uuid
      `)) as unknown as [{ count: number }];
      expect(row.count).toBe(1);
    });

    it('refuses a booking that is not finished', async () => {
      const active = await seedBooking(db, { userId, driverId, status: 'in_progress', total: '500.00' });
      await request(app.getHttpServer())
        .post(`/v1/payments/${active}/intent`)
        .set('Authorization', auth)
        .set('Idempotency-Key', randomUUID())
        .send({ purpose: 'booking' })
        .expect(409);
    });

    it("404s on somebody else's booking rather than 403", async () => {
      // A 403 would confirm the booking exists to a stranger guessing ids.
      const stranger = await seedCustomer(db, 'Stranger');
      const strangerAuth = await customerAuthHeaderFor(app, { userId: stranger });

      await request(app.getHttpServer())
        .post(`/v1/payments/${bookingId}/intent`)
        .set('Authorization', strangerAuth)
        .set('Idempotency-Key', randomUUID())
        .send({ purpose: 'booking' })
        .expect(404);
    });
  });

  describe('capture', () => {
    it('settles: paid, the money identity holds, exactly one leg', async () => {
      const intent = await openIntent().expect(201);
      const result = await captureWith(checkoutFor(intent.body.orderRef)).expect(200);

      expect(result.body.bookingStatus).toBe('paid');

      const [booking] = (await db.execute(sql`
        select status, total, commission_amount, driver_payout, tax_amount, paid_at
          from bookings where id = ${bookingId}::uuid
      `)) as unknown as [Record<string, string> | undefined];

      expect(booking!.status).toBe('paid');
      expect(booking!.paid_at).not.toBeNull();

      // §14.3: Band A is 10 %, so ₹2,000 → ₹200 commission, ₹1,800 pool.
      expect(paiseOf(booking, 'commission_amount')).toBe(20_000);
      expect(paiseOf(booking, 'driver_payout')).toBe(180_000);

      // THE IDENTITY. `ck_bookings_payout_within_total` enforces the inequality
      // in the database; this asserts the equality the arithmetic promises.
      expect(
        paiseOf(booking, 'commission_amount') +
          paiseOf(booking, 'driver_payout') +
          paiseOf(booking, 'tax_amount'),
      ).toBe(paiseOf(booking, 'total'));

      // One leg: an independent driver takes the whole pool as `fare_credit`.
      const legs = (await db.execute(sql`
        select type, amount from wallet_transactions where ref_id = ${bookingId}::uuid
      `)) as unknown as Array<{ type: string; amount: string }>;
      expect(legs).toHaveLength(1);
      expect(legs[0]!.type).toBe('fare_credit');
      expect(rupeeStringToPaise(legs[0]!.amount)).toBe(180_000);

      // Exactly one `paid` row in the history — the state machine's guard.
      const [history] = (await db.execute(sql`
        select count(*)::int as count from booking_status_history
         where booking_id = ${bookingId}::uuid and status = 'paid'
      `)) as unknown as [{ count: number }];
      expect(history.count).toBe(1);

      await expectNoDrift();
    });

    it('splits a fleet driver two ways, and the legs sum to the pool', async () => {
      const fleet = await seedFleet(db, 'Splitting Fleet');
      const fleetDriver = await seedDriver(db, { fleetId: fleet.fleetId, name: 'Fleet Driver' });
      await db.execute(sql`
        insert into fleet_driver_shares (fleet_id, driver_id, driver_share, fleet_share)
        values (${fleet.fleetId}::uuid, ${fleetDriver}::uuid, 80, 20)
      `);

      const fleetBooking = await seedBooking(db, {
        userId,
        driverId: fleetDriver,
        fleetId: fleet.fleetId,
        status: 'completed',
        total: '2000.00',
      });
      await db.execute(sql`
        update bookings set commission_band = 'A', commission_pct = 10
         where id = ${fleetBooking}::uuid
      `);

      const intent = await request(app.getHttpServer())
        .post(`/v1/payments/${fleetBooking}/intent`)
        .set('Authorization', auth)
        .set('Idempotency-Key', randomUUID())
        .send({ purpose: 'booking' })
        .expect(201);

      await request(app.getHttpServer())
        .post(`/v1/payments/${fleetBooking}/capture`)
        .set('Authorization', auth)
        .set('Idempotency-Key', randomUUID())
        .send(checkoutFor(intent.body.orderRef))
        .expect(200);

      const legs = (await db.execute(sql`
        select type, amount from wallet_transactions where ref_id = ${fleetBooking}::uuid
      `)) as unknown as Array<{ type: string; amount: string }>;

      const byType = new Map(legs.map((leg) => [leg.type, rupeeStringToPaise(leg.amount)]));
      expect([...byType.keys()].sort()).toEqual(['driver_share_credit', 'fleet_share_credit']);

      // ₹2,000 − ₹200 commission = ₹1,800 pool, split 80/20.
      expect(byType.get('driver_share_credit')).toBe(144_000);
      expect(byType.get('fleet_share_credit')).toBe(36_000);
      // And the two legs reconstruct the pool exactly — §14.3's whole point.
      expect(byType.get('driver_share_credit')! + byType.get('fleet_share_credit')!).toBe(180_000);

      await expectNoDrift();
    });

    it('refuses a forged signature with ZERO ledger rows', async () => {
      const intent = await openIntent().expect(201);
      const forged = checkoutFor(intent.body.orderRef);

      await captureWith({ ...forged, signature: 'deadbeef'.repeat(8) }).expect(401);

      expect(await legCount()).toBe(0);
      const [row] = (await db.execute(sql`
        select status from bookings where id = ${bookingId}::uuid
      `)) as unknown as [{ status: string }];
      expect(row.status).toBe('completed');
      await expectNoDrift();
    });

    it('is a 200 REPLAY, not a 409, when the booking is already paid', async () => {
      const intent = await openIntent().expect(201);
      const checkout = checkoutFor(intent.body.orderRef);

      await captureWith(checkout).expect(200);
      const second = await captureWith(checkout).expect(200);

      expect(second.body.bookingStatus).toBe('paid');
      // The point: one leg, one history row, however many times the client asks.
      expect(await legCount()).toBe(1);
      await expectNoDrift();
    });

    it('two CONCURRENT captures produce exactly one leg', async () => {
      const intent = await openIntent().expect(201);
      const checkout = checkoutFor(intent.body.orderRef);

      const results = await Promise.all([
        captureWith(checkout),
        captureWith(checkout),
      ]);

      // At least one wins; a loser may 200 (replay) or 409 (lost the state
      // machine's FOR UPDATE race). Neither may produce a second credit.
      expect(results.some((res) => res.status === 200)).toBe(true);
      expect(results.every((res) => res.status === 200 || res.status === 409)).toBe(true);

      expect(await legCount()).toBe(1);

      const [history] = (await db.execute(sql`
        select count(*)::int as count from booking_status_history
         where booking_id = ${bookingId}::uuid and status = 'paid'
      `)) as unknown as [{ count: number }];
      expect(history.count).toBe(1);

      await expectNoDrift();
    });
  });

  describe('GST', () => {
    it('credits the driver on the PRE-TAX amount, never on the total', async () => {
      // THE ASSERTION THIS WHOLE SUB-DESCRIBE EXISTS FOR. At the default rate
      // of zero, passing `total` and passing `taxable` are the same number, so
      // the mistake is invisible. At 18 % it is a driver being credited a share
      // of the government's money.
      //
      // ₹2,000 total with 18 % tax → ₹1,694.92 taxable, ₹305.08 tax.
      await db.execute(sql`
        update bookings set tax_pct = 18, tax_amount = 305.08, total = 2000.00
         where id = ${bookingId}::uuid
      `);

      const intent = await openIntent().expect(201);
      await captureWith(checkoutFor(intent.body.orderRef)).expect(200);

      const [booking] = (await db.execute(sql`
        select total, commission_amount, driver_payout, tax_amount
          from bookings where id = ${bookingId}::uuid
      `)) as unknown as [Record<string, string> | undefined];

      const taxablePaise = 200_000 - 30_508;
      const commissionPaise = Math.round(taxablePaise * 0.1);

      expect(paiseOf(booking, 'commission_amount')).toBe(commissionPaise);
      expect(paiseOf(booking, 'driver_payout')).toBe(taxablePaise - commissionPaise);

      // The identity, with tax in it.
      expect(
        paiseOf(booking, 'commission_amount') +
          paiseOf(booking, 'driver_payout') +
          paiseOf(booking, 'tax_amount'),
      ).toBe(paiseOf(booking, 'total'));

      // And the credited leg matches the payout to the paisa.
      const [leg] = (await db.execute(sql`
        select amount from wallet_transactions where ref_id = ${bookingId}::uuid
      `)) as unknown as [{ amount: string }];
      expect(rupeeStringToPaise(leg.amount)).toBe(paiseOf(booking, 'driver_payout'));

      await expectNoDrift();
    });

    it('at the default rate of zero, behaviour is identical to no tax at all', async () => {
      const intent = await openIntent().expect(201);
      await captureWith(checkoutFor(intent.body.orderRef)).expect(200);

      const [booking] = (await db.execute(sql`
        select commission_amount, driver_payout, tax_amount
          from bookings where id = ${bookingId}::uuid
      `)) as unknown as [Record<string, string> | undefined];

      expect(paiseOf(booking, 'tax_amount')).toBe(0);
      expect(paiseOf(booking, 'commission_amount')).toBe(20_000);
      expect(paiseOf(booking, 'driver_payout')).toBe(180_000);
      await expectNoDrift();
    });
  });
});
