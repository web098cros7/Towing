import type { INestApplication } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, customerAuthHeaderFor } from '../../test/app';
import { seedCustomer, setupTestDatabase, truncateAll, type TestDatabase } from '../../test/db';
import { seedBooking } from '../../test/fixtures';
import { ledgerInvariants } from '../../db/ledger/invariants';
import { CouponsService } from './coupons.service';

/**
 * §9.4.11's coupons.
 *
 * THE TEST THAT MATTERS is the exhaustion race. `used_count` against `max_uses`
 * is the textbook read-check-write, and a SELECT-then-compare loses it every
 * time under concurrency: two confirms both read 0 against a single-use coupon
 * and both pass. The conditional UPDATE decides it in one statement, and the
 * assertion here is that the loser leaves NO ORPHAN BOOKING behind — the whole
 * confirm transaction rolls back, fare lock and all.
 */
describe('coupons e2e', () => {
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
  });

  beforeEach(async () => {
    await truncateAll();
    userId = await seedCustomer(db, 'Coupon Customer');
    auth = await customerAuthHeaderFor(app, { userId });
  });

  const seedCoupon = async (values: Record<string, unknown> = {}): Promise<string> => {
    const row = {
      code: 'SAVE20',
      kind: 'percent',
      value: '20',
      max_discount: null,
      min_order: '0',
      max_uses: null,
      max_uses_per_user: 1,
      starts_at: null,
      expires_at: null,
      is_active: true,
      ...values,
    };

    const [created] = (await db.execute(sql`
      insert into coupons (code, kind, value, max_discount, min_order, max_uses,
                           max_uses_per_user, starts_at, expires_at, is_active)
      values (${row.code}, ${row.kind}, ${row.value}::numeric,
              ${row.max_discount}::numeric, ${row.min_order}::numeric,
              ${row.max_uses}::int, ${row.max_uses_per_user}::int,
              ${row.starts_at}::timestamptz, ${row.expires_at}::timestamptz, ${row.is_active})
      returning id
    `)) as unknown as [{ id: string }];

    return created.id;
  };

  const validate = (code: string, subtotalPaise = 200_000) =>
    request(app.getHttpServer())
      .post('/v1/coupons/validate')
      .set('Authorization', auth)
      .send({ code, subtotalPaise });

  describe('validate', () => {
    it('prices a percentage coupon', async () => {
      await seedCoupon();
      const res = await validate('SAVE20').expect(200);

      expect(res.body).toMatchObject({ valid: true, code: 'SAVE20', discountPaise: 40_000 });
    });

    it('is CASE-INSENSITIVE and echoes the coupon’s own casing', async () => {
      // The unique index is on `upper(code)`. A code that works in one casing
      // and not another is a support ticket.
      await seedCoupon();
      const res = await validate('save20').expect(200);

      expect(res.body.valid).toBe(true);
      expect(res.body.code).toBe('SAVE20');
    });

    it('caps a percentage coupon at max_discount', async () => {
      await seedCoupon({ max_discount: '100.00' });
      const res = await validate('SAVE20').expect(200);
      expect(res.body.discountPaise).toBe(10_000);
    });

    it('clamps a flat coupon to the subtotal', async () => {
      // A ₹500 coupon on a ₹300 fare discounts ₹300, never more —
      // `ck_bookings_non_negative` would reject a negative total outright.
      await seedCoupon({ kind: 'flat', value: '500.00' });
      const res = await validate('SAVE20', 30_000).expect(200);
      expect(res.body.discountPaise).toBe(30_000);
    });

    it('gives an UNKNOWN and an INACTIVE code the same answer', async () => {
      // A coupon endpoint is a code-guessing surface. Distinguishing the two
      // would confirm which strings exist.
      const unknown = await validate('NOPE').expect(200);
      await seedCoupon({ code: 'OFFCODE', is_active: false });
      const inactive = await validate('OFFCODE').expect(200);

      expect(unknown.body).toMatchObject({ valid: false, reason: 'invalid', code: null });
      expect(inactive.body).toMatchObject({ valid: false, reason: 'invalid', code: null });
    });

    it('names the specific reason for a code that is genuinely theirs', async () => {
      await seedCoupon({
        code: 'EXPIRED',
        expires_at: new Date(Date.now() - 86_400_000).toISOString(),
      });
      await seedCoupon({ code: 'BIGORDER', min_order: '5000.00' });

      expect((await validate('EXPIRED').expect(200)).body.reason).toBe('expired');
      expect((await validate('BIGORDER').expect(200)).body.reason).toBe('below_min_order');
    });
  });

  describe('the exhaustion race', () => {
    it('two concurrent claims produce ONE redemption and NO orphan booking', async () => {
      const couponId = await seedCoupon({ max_uses: 1, max_uses_per_user: 5 });

      // Drive the service directly rather than through `POST /bookings`: the
      // confirm path needs a full pricing fixture, and the race being tested is
      // in the coupon claim, not in the fare lock.
      const coupons = app.get(CouponsService);

      // TWO CUSTOMERS, and the bookings created UP FRONT. §3.8's
      // `uq_bookings_one_active_per_user` allows one open booking per customer,
      // so two `searching` rows for one customer is a unique violation rather
      // than a race — and racing the INSERTs alongside the coupon claim
      // deadlocked the two transactions against each other, which proves
      // nothing about the coupon.
      const racers = await Promise.all([
        seedCustomer(db, 'Racer A'),
        seedCustomer(db, 'Racer B'),
      ]);
      const bookings = await Promise.all(
        racers.map((owner) => seedBooking(db, { userId: owner, status: 'searching', total: '2000.00' })),
      );

      const claim = async (index: number): Promise<'won' | 'lost'> => {
        try {
          await db.transaction((tx) =>
            coupons.applyInTransaction(tx, {
              userId: racers[index]!,
              bookingId: bookings[index]!,
              code: 'SAVE20',
              subtotalPaise: 200_000,
            }),
          );
          return 'won';
        } catch {
          return 'lost';
        }
      };

      const results = await Promise.all([claim(0), claim(1)]);

      expect(results.filter((r) => r === 'won')).toHaveLength(1);

      const [redemptions] = (await db.execute(sql`
        select count(*)::int as count from coupon_redemptions where coupon_id = ${couponId}::uuid
      `)) as unknown as [{ count: number }];
      expect(redemptions.count).toBe(1);

      const [coupon] = (await db.execute(sql`
        select used_count from coupons where id = ${couponId}::uuid
      `)) as unknown as [{ used_count: number }];
      expect(coupon.used_count).toBe(1);

      // `couponDrift` is the nightly check on exactly this: a denormalised
      // counter that can drift silently is worse than no counter.
      await expect(ledgerInvariants(db)).resolves.toMatchObject({ couponDrift: 0 });
    });

    it('refuses a second use by the same customer', async () => {
      await seedCoupon({ max_uses_per_user: 1 });
      const coupons = app.get(CouponsService);

      const first = await seedBooking(db, { userId, status: 'searching', total: '2000.00' });
      await db.transaction((tx) =>
        coupons.applyInTransaction(tx, {
          userId,
          bookingId: first,
          code: 'SAVE20',
          subtotalPaise: 200_000,
        }),
      );

      expect((await validate('SAVE20').expect(200)).body.reason).toBe('already_used');
    });
  });

  describe('cancellation returns the use', () => {
    it('a FREE cancellation gives the coupon back; the counter and rows agree', async () => {
      // Burning a single-use code on a ninety-second cancellation is
      // user-hostile. A chargeable one keeps it burnt — the customer got a
      // driver.
      const couponId = await seedCoupon({ max_uses: 1 });
      const coupons = app.get(CouponsService);

      const bookingId = await seedBooking(db, { userId, status: 'searching', total: '2000.00' });
      await db.transaction((tx) =>
        coupons.applyInTransaction(tx, {
          userId,
          bookingId,
          code: 'SAVE20',
          subtotalPaise: 200_000,
        }),
      );

      await request(app.getHttpServer())
        .post(`/v1/bookings/${bookingId}/cancel`)
        .set('Authorization', auth)
        .send({})
        .expect(200);

      const [coupon] = (await db.execute(sql`
        select used_count from coupons where id = ${couponId}::uuid
      `)) as unknown as [{ used_count: number }];
      expect(coupon.used_count).toBe(0);

      const [redemptions] = (await db.execute(sql`
        select count(*)::int as count from coupon_redemptions where coupon_id = ${couponId}::uuid
      `)) as unknown as [{ count: number }];
      expect(redemptions.count).toBe(0);

      await expect(ledgerInvariants(db)).resolves.toMatchObject({ couponDrift: 0 });
    });
  });
});
