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
  setupTestDatabase,
  truncateAll,
  type TestDatabase,
} from '../../test/db';
import { seedBooking, seedWalletWithLedger } from '../../test/fixtures';
import { LedgerService } from '../../db/ledger/ledger.service';
import { devCheckoutSignature, devPaymentRef } from './dev-payment.adapter';

/**
 * Wallet auto-application at booking payment (Figma 27 bill, 44 Wallet).
 * Covers: zero balance, partial wallet, wallet-only settlement via explicit
 * confirm, and the balance-changed race.
 */
describe('payment wallet application e2e (/v1/payments/:bookingId)', () => {
  let app: INestApplication;
  let db: TestDatabase;
  let auth: string;
  let userId: string;
  let driverId: string;
  let bookingId: string;
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
    userId = await seedCustomer(db, 'Wallet Customer');
    auth = await customerAuthHeaderFor(app, { userId });
    driverId = await seedDriver(db, { name: 'Wallet Driver' });
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

  const expectNoDrift = async (): Promise<void> => {
    await expect(app.get(LedgerService).invariants()).resolves.toEqual({
      walletDrift: 0,
      bookingDrift: 0,
      ledgerDrift: 0,
      reversalDrift: 0,
      couponDrift: 0,
    });
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

  const confirmWallet = (key = randomUUID()) =>
    request(app.getHttpServer())
      .post(`/v1/payments/${bookingId}/wallet`)
      .set('Authorization', auth)
      .set('Idempotency-Key', key)
      .send({});

  const checkoutFor = (orderRef: string) => {
    const gatewayRef = devPaymentRef(orderRef);
    return { orderRef, gatewayRef, signature: devCheckoutSignature(orderRef, gatewayRef, SECRET) };
  };

  const walletBalancePaise = async (): Promise<number> => {
    const [row] = (await db.execute(sql`
      select balance from wallets
       where owner_type = 'user'::wallet_owner_type and owner_id = ${userId}::uuid
    `)) as unknown as [{ balance: string } | undefined];
    return row ? rupeeStringToPaise(row.balance) : 0;
  };

  const bookingStatus = async (): Promise<string> => {
    const [row] = (await db.execute(sql`
      select status from bookings where id = ${bookingId}::uuid
    `)) as unknown as [{ status: string }];
    return row.status;
  };

  it('a) zero balance: no wallet applied, full amount to the gateway', async () => {
    const intent = await openIntent().expect(201);

    expect(intent.body.walletAppliedPaise).toBe(0);
    expect(intent.body.amountPaise).toBe(200_000);
    expect(intent.body.walletOnly).toBe(false);

    await expectNoDrift();
  });

  it('b) partial wallet: ₹100 off a ₹2,000 fare, then capture settles the rest', async () => {
    await seedWalletWithLedger(
      db,
      { ownerId: userId, ownerType: 'user' as never },
      [{ type: 'adjustment' as never, amount: '100.00' }],
    );

    const intent = await openIntent().expect(201);
    expect(intent.body.walletAppliedPaise).toBe(10_000);
    expect(intent.body.amountPaise).toBe(190_000);
    expect(intent.body.walletOnly).toBe(false);

    const result = await captureWith(checkoutFor(intent.body.orderRef)).expect(200);
    expect(result.body.bookingStatus).toBe('paid');

    expect(await walletBalancePaise()).toBe(0);

    await expectNoDrift();
  });

  it('c) wallet covers the whole fare: intent opens, confirm settles', async () => {
    await seedWalletWithLedger(
      db,
      { ownerId: userId, ownerType: 'user' as never },
      [{ type: 'adjustment' as never, amount: '2500.00' }],
    );

    const intent = await openIntent().expect(201);
    expect(intent.body.walletOnly).toBe(true);
    expect(intent.body.amountPaise).toBe(0);
    expect(intent.body.walletAppliedPaise).toBe(200_000);

    // The intent alone must NOT settle — the customer has not tapped Pay yet.
    expect(await bookingStatus()).toBe('completed');

    const result = await confirmWallet().expect(200);
    expect(result.body.bookingStatus).toBe('paid');

    expect(await walletBalancePaise()).toBe(50_000);

    await expectNoDrift();
  });

  it('d) wallet-only intent, then the balance drops: confirm 409s and a new intent needs the gateway', async () => {
    await seedWalletWithLedger(
      db,
      { ownerId: userId, ownerType: 'user' as never },
      [{ type: 'adjustment' as never, amount: '2500.00' }],
    );

    const intent = await openIntent().expect(201);
    expect(intent.body.walletOnly).toBe(true);
    expect(intent.body.amountPaise).toBe(0);

    // Spend the wallet out from under the open intent.
    await app.get(LedgerService).post([
      {
        owner: { ownerType: 'user', ownerId: userId },
        type: 'adjustment',
        amountPaise: -100_000,
        reason: 'test: balance drop',
        idempotencyKey: `test:balance-drop:${randomUUID()}`,
      },
    ]);

    await confirmWallet().expect(409);

    const next = await openIntent().expect(201);
    expect(next.body.walletOnly).toBe(false);
    expect(next.body.amountPaise).toBeGreaterThan(0);

    await expectNoDrift();
  });
});
