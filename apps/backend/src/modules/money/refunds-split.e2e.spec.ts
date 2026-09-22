import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { rupeeStringToPaise } from '@towing/api-contracts';
import { createTestApp, customerAuthHeaderFor, driverAuthHeaderFor } from '../../test/app';
import { ENV, type Env } from '../../config/env';
import {
  seedCustomer,
  seedDriver,
  setupTestDatabase,
  truncateAll,
  type TestDatabase,
  seedAdmin,
} from '../../test/db';
import { seedBooking, seedWalletWithLedger } from '../../test/fixtures';
import { ledgerInvariants } from '../../db/ledger/invariants';
import { LedgerService } from '../../db/ledger/ledger.service';
import { devCheckoutSignature, devPaymentRef } from './dev-payment.adapter';
import { RefundsService } from './refunds.service';

/**
 * W8 — the two refundable pools of a captured `booking` payment.
 *
 * A booking can be paid through the gateway, partly or wholly from the
 * customer's MiTow wallet, in cash to the driver, or with a coupon. Each of
 * those leaves a different split between the gateway pool and the wallet pool,
 * and a refund has to spend them in the right order: gateway FIRST, wallet
 * last, cash only ever as wallet credit. Every test ends by asserting the
 * ledger invariants are zero.
 */
describe('refund split e2e (RefundsService, two pools)', () => {
  let app: INestApplication;
  let db: TestDatabase;
  let refunds: RefundsService;
  let adminId: string;
  let userId: string;
  let driverId: string;
  let driverAuth: string;
  let auth: string;
  let bookingId: string;
  let SECRET: string;

  beforeAll(async () => {
    db = await setupTestDatabase();
    app = await createTestApp();
    refunds = app.get(RefundsService);
    SECRET = app.get<Env>(ENV).PAYMENT_WEBHOOK_SECRET;
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await truncateAll();
    userId = await seedCustomer(db, 'Split Customer');
    auth = await customerAuthHeaderFor(app, { userId });
    driverId = await seedDriver(db, { name: 'Split Driver' });
    driverAuth = await driverAuthHeaderFor(app, { driverId });
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
    // The admin id is only used as `initiatedBy` on the refund rows.
    adminId = (await seedAdmin(db, { subRole: 'finance' })).id;
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

  const walletBalancePaise = async (ownerType: 'user' | 'driver'): Promise<number> => {
    const ownerId = ownerType === 'user' ? userId : driverId;
    const [row] = (await db.execute(sql`
      select balance from wallets
       where owner_type = ${ownerType}::wallet_owner_type and owner_id = ${ownerId}::uuid
    `)) as unknown as [{ balance: string } | undefined];
    return row ? rupeeStringToPaise(row.balance) : 0;
  };

  const refundRow = async (refundId: string) => {
    const [row] = (await db.execute(sql`
      select amount::text as amount,
             gateway_amount::text as gateway_amount,
             wallet_amount::text as wallet_amount,
             status, gateway_ref
        from refunds where id = ${refundId}::uuid
    `)) as unknown as [
      {
        amount: string;
        gateway_amount: string;
        wallet_amount: string;
        status: string;
        gateway_ref: string | null;
      },
    ];
    return row;
  };

  const paymentRow = async () => {
    const [row] = (await db.execute(sql`
      select status, refunded_amount::text as refunded from payments
       where booking_id = ${bookingId}::uuid and purpose = 'booking'
       order by created_at desc limit 1
    `)) as unknown as [{ status: string; refunded: string }];
    return row;
  };

  /** Pay the booking through the real intent/capture routes, with a wallet top-up. */
  const payWithWalletAndGateway = async (walletRupees: string): Promise<void> => {
    await seedWalletWithLedger(
      db,
      { ownerId: userId, ownerType: 'user' as never },
      [{ type: 'adjustment' as never, amount: walletRupees }],
    );

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
  };

  /** Pay the booking in cash through the real routes. */
  const payWithCash = async (): Promise<void> => {
    await request(app.getHttpServer())
      .post(`/v1/payments/${bookingId}/cash`)
      .set('Authorization', auth)
      .send({})
      .expect(200);
    await request(app.getHttpServer())
      .post(`/v1/jobs/${bookingId}/cash-collected`)
      .set('Authorization', driverAuth)
      .send({})
      .expect(200);
  };

  it('a) wallet ₹500 + gateway ₹1,500: full refund splits 1500/500 and restores the wallet', async () => {
    await payWithWalletAndGateway('500.00');
    // The wallet was spent on the payment; the customer's balance is now 0.
    expect(await walletBalancePaise('user')).toBe(0);

    const result = await refunds.refundBooking({
      bookingId,
      reason: 'cancellation',
      initiatedBy: adminId,
      transitionTo: 'disputed',
    });

    const row = await refundRow(result.refundId);
    expect(row.gateway_amount).toBe('1500.00');
    expect(row.wallet_amount).toBe('500.00');
    expect(row.amount).toBe('2000.00');
    expect(row.status).toBe('processed');
    expect(row.gateway_ref).toMatch(/^rfnd_dev_/);

    // The wallet credit leg brought the customer back to their pre-payment 500.
    expect(await walletBalancePaise('user')).toBe(50_000);

    const payment = await paymentRow();
    expect(payment.status).toBe('refunded');
    expect(payment.refunded).toBe('1500.00');

    await expectNoDrift();
  });

  it('b) partials spend the gateway pool first, then the wallet pool', async () => {
    await payWithWalletAndGateway('500.00');

    // ₹1,700 partial: gateway 1500 + wallet 200.
    const first = await refunds.refundPartial({
      bookingId,
      amountPaise: 170_000,
      liability: 'platform',
      reason: 'overcharge',
      initiatedBy: adminId,
      keySource: { kind: 'admin', adminId, clientKey: randomUUID() },
    });
    const firstRow = await refundRow(first.refundId);
    expect(firstRow.gateway_amount).toBe('1500.00');
    expect(firstRow.wallet_amount).toBe('200.00');
    expect(firstRow.amount).toBe('1700.00');

    // Only ₹300 left — a ₹400 partial is refused with 422.
    await expect(
      refunds.refundPartial({
        bookingId,
        amountPaise: 40_000,
        liability: 'platform',
        reason: 'overcharge',
        initiatedBy: adminId,
        keySource: { kind: 'admin', adminId, clientKey: randomUUID() },
      }),
    ).rejects.toMatchObject({ status: 422 });

    // ₹300 partial: gateway pool is exhausted, so it all comes from the wallet.
    const second = await refunds.refundPartial({
      bookingId,
      amountPaise: 30_000,
      liability: 'platform',
      reason: 'overcharge',
      initiatedBy: adminId,
      keySource: { kind: 'admin', adminId, clientKey: randomUUID() },
    });
    const secondRow = await refundRow(second.refundId);
    expect(secondRow.gateway_amount).toBe('0.00');
    expect(secondRow.wallet_amount).toBe('300.00');
    expect(secondRow.amount).toBe('300.00');

    // Wallet got 200 + 300 = 500 back.
    expect(await walletBalancePaise('user')).toBe(50_000);

    await expectNoDrift();
  });

  it('c) cash: full refund is wallet-only, no gateway call, driver pool reversed', async () => {
    await payWithCash();
    // The driver's pool credit (₹1,800) minus commission (₹200) = −₹200.
    expect(await walletBalancePaise('driver')).toBe(-20_000);

    const result = await refunds.refundBooking({
      bookingId,
      reason: 'cancellation',
      initiatedBy: adminId,
      transitionTo: 'disputed',
    });

    const row = await refundRow(result.refundId);
    expect(row.gateway_amount).toBe('0.00');
    expect(row.wallet_amount).toBe('2000.00');
    expect(row.amount).toBe('2000.00');
    // No gateway part → no vendor call, marked processed right away.
    expect(row.status).toBe('processed');
    expect(row.gateway_ref).toBeNull();

    // The customer's wallet got the whole ₹2,000 as credit.
    expect(await walletBalancePaise('user')).toBe(200_000);
    // The driver's pool credit was reversed; the cash_collected_debit stays: the driver
    // now owes the whole ₹2,000 they collected in cash and the customer got back.
    expect(await walletBalancePaise('driver')).toBe(-200_000);

    await expectNoDrift();
  });

  it('d) a full refund releases the coupon and resets its used_count', async () => {
    const [coupon] = (await db.execute(sql`
      insert into coupons (code, kind, value, max_discount, min_order, max_uses,
                           max_uses_per_user, starts_at, expires_at, is_active, is_public)
      values ('SAVE10', 'percent', '10'::numeric, '150.00'::numeric, '0'::numeric,
              null, 1, null, null, true, true)
      returning id
    `)) as unknown as [{ id: string }];

    await request(app.getHttpServer())
      .post(`/v1/payments/${bookingId}/coupon`)
      .set('Authorization', auth)
      .send({ code: 'SAVE10' })
      .expect(200);

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

    await refunds.refundBooking({
      bookingId,
      reason: 'cancellation',
      initiatedBy: adminId,
      transitionTo: 'disputed',
    });

    const [redemption] = (await db.execute(sql`
      select count(*)::int as count from coupon_redemptions where booking_id = ${bookingId}::uuid
    `)) as unknown as [{ count: number }];
    expect(redemption.count).toBe(0);

    const [used] = (await db.execute(sql`
      select used_count from coupons where id = ${coupon.id}::uuid
    `)) as unknown as [{ used_count: number }];
    expect(used.used_count).toBe(0);

    await expectNoDrift();
  });
});
