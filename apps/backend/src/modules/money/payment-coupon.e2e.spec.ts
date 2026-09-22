import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, customerAuthHeaderFor } from '../../test/app';
import {
  seedCustomer,
  seedDriver,
  setupTestDatabase,
  truncateAll,
  type TestDatabase,
} from '../../test/db';
import { seedBooking } from '../../test/fixtures';
import { ledgerInvariants } from '../../db/ledger/invariants';
import { devCheckoutSignature, devPaymentRef } from './dev-payment.adapter';
import { ENV, type Env } from '../../config/env';

/**
 * Figma 27 → 28's payment-time coupon: apply, re-price, remove.
 *
 * The fare arithmetic is the same one confirm runs, so the assertions here are
 * about the recompute landing on the row and the redemption staying in step.
 */
describe('payment coupon e2e (/v1/payments/:bookingId/coupon)', () => {
  let app: INestApplication;
  let db: TestDatabase;
  let auth: string;
  let userId: string;
  let driverId: string;
  let bookingId: string;
  let couponId: string;
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
    userId = await seedCustomer(db, 'Coupon Customer');
    auth = await customerAuthHeaderFor(app, { userId });
    driverId = await seedDriver(db, { name: 'Coupon Driver' });
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

    const [created] = (await db.execute(sql`
      insert into coupons (code, kind, value, max_discount, min_order, max_uses,
                           max_uses_per_user, starts_at, expires_at, is_active, is_public)
      values ('SAVE10', 'percent', '10'::numeric, '150.00'::numeric, '0'::numeric,
              null, 1, null, null, true, true)
      returning id
    `)) as unknown as [{ id: string }];
    couponId = created.id;
  });

  const apply = (code = 'SAVE10') =>
    request(app.getHttpServer())
      .post(`/v1/payments/${bookingId}/coupon`)
      .set('Authorization', auth)
      .send({ code });

  const remove = () =>
    request(app.getHttpServer())
      .delete(`/v1/payments/${bookingId}/coupon`)
      .set('Authorization', auth);

  const bookingRow = async (): Promise<Record<string, string | null>> => {
    const [row] = (await db.execute(sql`
      select total, tax_amount, discount, coupon_id, coupon_code
        from bookings where id = ${bookingId}::uuid
    `)) as unknown as [Record<string, string | null>];
    return row;
  };

  const redemptionCount = async (): Promise<number> => {
    const [row] = (await db.execute(sql`
      select count(*)::int as count from coupon_redemptions where booking_id = ${bookingId}::uuid
    `)) as unknown as [{ count: number }];
    return row.count;
  };

  const usedCount = async (): Promise<number> => {
    const [row] = (await db.execute(sql`
      select used_count from coupons where id = ${couponId}::uuid
    `)) as unknown as [{ used_count: number }];
    return row.used_count;
  };

  it('applies a coupon, re-prices the booking, and records the redemption', async () => {
    const res = await apply().expect(200);

    expect(res.body.discountPaise).toBe(15_000);
    expect(res.body.totalPaise).toBe(185_000);
    expect(res.body.couponCode).toBe('SAVE10');

    const row = await bookingRow();
    expect(row.total).toBe('1850.00');
    expect(row.coupon_code).toBe('SAVE10');
    expect(row.coupon_id).toBe(couponId);

    expect(await redemptionCount()).toBe(1);
    expect(await usedCount()).toBe(1);
  });

  it('charges the discounted total on the next intent and settles cleanly', async () => {
    await apply().expect(200);

    const intent = await request(app.getHttpServer())
      .post(`/v1/payments/${bookingId}/intent`)
      .set('Authorization', auth)
      .set('Idempotency-Key', randomUUID())
      .send({ purpose: 'booking' })
      .expect(201);

    expect(intent.body.amountPaise).toBe(185_000);

    const gatewayRef = devPaymentRef(intent.body.orderRef);
    const signature = devCheckoutSignature(intent.body.orderRef, gatewayRef, SECRET);

    const capture = await request(app.getHttpServer())
      .post(`/v1/payments/${bookingId}/capture`)
      .set('Authorization', auth)
      .set('Idempotency-Key', randomUUID())
      .send({ orderRef: intent.body.orderRef, gatewayRef, signature })
      .expect(200);

    expect(capture.body.bookingStatus).toBe('paid');

    await expect(ledgerInvariants(db)).resolves.toEqual({
      walletDrift: 0,
      bookingDrift: 0,
      ledgerDrift: 0,
      reversalDrift: 0,
      couponDrift: 0,
    });
  });

  it('removes the coupon: total back to 2000, no redemption, counter back to 0', async () => {
    await apply().expect(200);
    const res = await remove().expect(200);

    expect(res.body.discountPaise).toBe(0);
    expect(res.body.totalPaise).toBe(200_000);
    expect(res.body.couponCode).toBeNull();

    const row = await bookingRow();
    expect(row.total).toBe('2000.00');
    expect(row.coupon_id).toBeNull();
    expect(row.coupon_code).toBeNull();

    expect(await redemptionCount()).toBe(0);
    expect(await usedCount()).toBe(0);
  });

  it('refuses to change a coupon once the booking is paid', async () => {
    const intent = await request(app.getHttpServer())
      .post(`/v1/payments/${bookingId}/intent`)
      .set('Authorization', auth)
      .set('Idempotency-Key', randomUUID())
      .send({ purpose: 'booking' })
      .expect(201);

    const gatewayRef = devPaymentRef(intent.body.orderRef);
    const signature = devCheckoutSignature(intent.body.orderRef, gatewayRef, SECRET);

    await request(app.getHttpServer())
      .post(`/v1/payments/${bookingId}/capture`)
      .set('Authorization', auth)
      .set('Idempotency-Key', randomUUID())
      .send({ orderRef: intent.body.orderRef, gatewayRef, signature })
      .expect(200);

    await apply().expect(409);
  });

  it('rejects an unknown code with 422', async () => {
    await apply('NOPE99').expect(422);
  });
});
