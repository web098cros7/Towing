import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { bookingCancelResponseSchema } from '@towing/api-contracts';
import { desc, eq, sql } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { bookingStatusHistory, bookings } from '../../db/schema';
import { createTestApp, customerAuthHeaderFor } from '../../test/app';
import { expectMatchesContract } from '../../test/contracts';
import {
  seedCustomer,
  seedDriver,
  setupTestDatabase,
  truncateAll,
  type TestDatabase,
} from '../../test/db';
import { seedBooking } from '../../test/fixtures';
import { closeTestRedis, flushTestRedis } from '../../test/redis';
import { ENV, type Env } from '../../config/env';
import {
  devCheckoutSignature,
  devPaymentRef,
} from '../money/dev-payment.adapter';

/**
 * `POST /v1/bookings/:id/cancel` — §3.5, all three tiers.
 *
 * PHASE 15 REFUSED THE CHARGEABLE TIERS with a 409 and this file asserted that
 * refusal, deliberately: cancelling for ₹0 instead would have been a revenue
 * bug nobody notices until a month's numbers come out. Phase 19 gave those
 * tiers the ledger leg and the collection path they were waiting for, so the
 * refusal tests are REWRITTEN rather than deleted — the behaviour they pinned
 * has genuinely changed, and the new shape deserves the same scrutiny.
 *
 * The chargeable path is now two calls: the fee is collected BEFORE the trip is
 * cancelled, because cancelling first and chasing the money afterwards leaves
 * the platform holding nothing.
 */
describe('POST /v1/bookings/:id/cancel', () => {
  let app: INestApplication;
  let db: TestDatabase;
  let userId: string;
  let auth: string;

  beforeAll(async () => {
    db = await setupTestDatabase();
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
    await closeTestRedis();
  });

  beforeEach(async () => {
    await truncateAll();
    await flushTestRedis();
    userId = await seedCustomer(db);
    auth = await customerAuthHeaderFor(app, { userId });
  });

  async function seedIn(
    status: (typeof bookings.$inferInsert)['status'],
    options: { minutesAgo?: number; owner?: string } = {},
  ): Promise<string> {
    const id = await seedBooking(db, { userId: options.owner ?? userId, status: 'paid' });
    await db
      .update(bookings)
      .set({
        status,
        baseFare: '999.00',
        createdAt: new Date(Date.now() - (options.minutesAgo ?? 0) * 60_000),
      })
      .where(eq(bookings.id, id));
    return id;
  }

  const cancel = (id: string, reason?: string) =>
    request(app.getHttpServer())
      .post(`/v1/bookings/${id}/cancel`)
      .set('Authorization', auth)
      .send(reason ? { reason } : {});

  describe('the free branches', () => {
    it('cancels a SEARCHING booking free, however long it has been searching', async () => {
      // §3.5: "During search cancellation is always free — the customer hasn't
      // been matched yet."
      const id = await seedIn('searching', { minutesAgo: 45 });

      const response = await cancel(id, 'Found another way').expect(200);
      expectMatchesContract(bookingCancelResponseSchema, response.body);

      expect(response.body.status).toBe('cancelled');
      expect(response.body.tier).toBe('free');
      expect(response.body.feePaise).toBe(0);
    });

    it('cancels free inside the 2-minute window after assignment', async () => {
      const id = await seedIn('assigned', { minutesAgo: 1 });
      const response = await cancel(id).expect(200);
      expect(response.body.tier).toBe('free');
    });

    it('records who cancelled, why, and a zero fee', async () => {
      const id = await seedIn('searching');
      await cancel(id, 'Changed my mind').expect(200);

      const [row] = await db.select().from(bookings).where(eq(bookings.id, id));
      expect(row!.status).toBe('cancelled');
      expect(row!.cancelledBy).toBe('customer');
      expect(row!.cancellationReason).toBe('Changed my mind');
      expect(row!.cancellationFee).toBe('0.00');
    });

    it('writes a history row through the state machine', async () => {
      const id = await seedIn('searching');
      await cancel(id, 'Changed my mind').expect(200);

      const [latest] = await db
        .select()
        .from(bookingStatusHistory)
        .where(eq(bookingStatusHistory.bookingId, id))
        .orderBy(desc(bookingStatusHistory.createdAt))
        .limit(1);

      expect(latest!.status).toBe('cancelled');
      expect(latest!.actor).toBe('customer');
      expect(latest!.note).toBe('Changed my mind');
    });

    it('frees the §3.8 slot so the customer can book again', async () => {
      const id = await seedIn('searching');
      await cancel(id).expect(200);
      // The partial unique index only covers open statuses, so a second open
      // booking is now insertable. If it were not, a cancelled trip would lock
      // a customer out permanently.
      await expect(seedIn('searching')).resolves.toBeTruthy();
    });
  });

  describe('the chargeable branches collect first, then cancel', () => {
    /** Opens an intent for the fee and returns a valid checkout result. */
    const payFeeFor = async (id: string) => {
      const intent = await request(app.getHttpServer())
        .post(`/v1/payments/${id}/intent`)
        .set('Authorization', auth)
        .set('Idempotency-Key', randomUUID())
        .send({ purpose: 'cancellation_fee' })
        .expect(201);

      const orderRef = intent.body.orderRef as string;
      const gatewayRef = devPaymentRef(orderRef);
      const secret = app.get<Env>(ENV).PAYMENT_WEBHOOK_SECRET;

      return { orderRef, gatewayRef, signature: devCheckoutSignature(orderRef, gatewayRef, secret) };
    };

    it('REFUSES a chargeable cancel with no payment, and nothing moves', async () => {
      const id = await seedIn('assigned', { minutesAgo: 6 });

      const response = await cancel(id).expect(422);
      expect(response.body.error.code).toBe('cancellation_requires_payment');
      expect(response.body.error.details.tier).toBe('partial');
      expect(response.body.error.details.feePaise).toBe(15_000); // §3.5's ₹150

      const [row] = await db.select().from(bookings).where(eq(bookings.id, id));
      expect(row!.status).toBe('assigned');
    });

    it('cancels a partial-fee trip once the fee is paid, and records it', async () => {
      const id = await seedIn('assigned', { minutesAgo: 6 });
      const payment = await payFeeFor(id);

      const response = await request(app.getHttpServer())
        .post(`/v1/bookings/${id}/cancel`)
        .set('Authorization', auth)
        .send({ payment })
        .expect(200);

      expect(response.body).toMatchObject({ status: 'cancelled', tier: 'partial', feePaise: 15_000 });

      const [row] = await db.select().from(bookings).where(eq(bookings.id, id));
      expect(row!.status).toBe('cancelled');
      expect(row!.cancellationFee).toBe('150.00');
    });

    it('compensates the driver with an `adjustment`, NEVER an earning leg', async () => {
      // ⚠ THE MOST LIKELY SILENT BUG IN PHASE 19. A `fare_credit` or
      // `driver_share_credit` here would make the earnings projector count
      // `gross = booking.total` for a trip that NEVER RAN — inflating
      // `earnings_daily`, every fleet report and the §9.4.13 GMV chart — while
      // tripping no invariant at all, because `ledgerDrift` filters
      // `status = 'paid'` and `projectionDrift` compares the projection against
      // the same wrong query.
      const driverId = await seedDriver(db, { name: 'Compensated Driver' });
      const id = await seedIn('en_route', { minutesAgo: 1 });
      await db.update(bookings).set({ driverId }).where(eq(bookings.id, id));

      const payment = await payFeeFor(id);

      const response = await request(app.getHttpServer())
        .post(`/v1/bookings/${id}/cancel`)
        .set('Authorization', auth)
        .send({ payment })
        .expect(200);

      // §3.5 example C — the full base fare, and 50 % of it to the driver.
      expect(response.body.feePaise).toBe(99_900);
      expect(response.body.driverCompensationPaise).toBe(49_950);

      const legs = (await db.execute(sql`
        select type, amount from wallet_transactions where ref_id = ${id}::uuid
      `)) as unknown as Array<{ type: string; amount: string }>;

      expect(legs).toHaveLength(1);
      expect(legs[0]!.type).toBe('adjustment');
      expect(legs[0]!.amount).toBe('499.50');

      // AND THE ASSERTION THAT CATCHES A REGRESSION: the earnings projection
      // for this driver is untouched by a trip that never happened.
      const [cells] = (await db.execute(sql`
        select count(*)::int as count from earnings_daily where driver_id = ${driverId}::uuid
      `)) as unknown as [{ count: number }];
      expect(cells.count).toBe(0);
    });

    it('pays no compensation when there was no driver to compensate', async () => {
      const id = await seedIn('assigned', { minutesAgo: 6 });
      const payment = await payFeeFor(id);

      const response = await request(app.getHttpServer())
        .post(`/v1/bookings/${id}/cancel`)
        .set('Authorization', auth)
        .send({ payment })
        .expect(200);

      expect(response.body.driverCompensationPaise).toBe(0);

      const [legs] = (await db.execute(sql`
        select count(*)::int as count from wallet_transactions where ref_id = ${id}::uuid
      `)) as unknown as [{ count: number }];
      expect(legs.count).toBe(0);
    });

    it('refuses a forged payment signature', async () => {
      const id = await seedIn('assigned', { minutesAgo: 6 });
      const payment = await payFeeFor(id);

      await request(app.getHttpServer())
        .post(`/v1/bookings/${id}/cancel`)
        .set('Authorization', auth)
        .send({ payment: { ...payment, signature: 'deadbeef'.repeat(8) } })
        .expect(401);

      const [row] = await db.select().from(bookings).where(eq(bookings.id, id));
      expect(row!.status).toBe('assigned');
    });
  });

  describe('illegal cancellations', () => {
    it.each(['completed', 'paid'] as const)('refuses to cancel a %s trip', async (status) => {
      // The tow happened. The remedy is a dispute or a refund — cancelling
      // would erase a job the driver is owed for.
      const id = await seedIn(status);
      await cancel(id).expect(409);
    });

    it('refuses to cancel an already-cancelled booking', async () => {
      const id = await seedIn('searching');
      await cancel(id).expect(200);
      await cancel(id).expect(409);
    });
  });

  describe('ownership', () => {
    it('404s another customer\'s booking', async () => {
      const stranger = await seedCustomer(db);
      const theirs = await seedIn('searching', { owner: stranger });

      await request(app.getHttpServer())
        .post(`/v1/bookings/${theirs}/cancel`)
        .set('Authorization', auth)
        .send({})
        .expect(404);

      const [row] = await db.select().from(bookings).where(eq(bookings.id, theirs));
      expect(row!.status).toBe('searching');
    });

    it('rejects an anonymous caller', async () => {
      const id = await seedIn('searching');
      await request(app.getHttpServer()).post(`/v1/bookings/${id}/cancel`).send({}).expect(401);
    });
  });
});
