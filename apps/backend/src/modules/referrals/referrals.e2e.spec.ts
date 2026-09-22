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
import { seedBooking } from '../../test/fixtures';
import { ledgerInvariants } from '../../db/ledger/invariants';
import { devCheckoutSignature, devPaymentRef } from '../money/dev-payment.adapter';

/**
 * Refer & Earn (Figma 45), end to end.
 *
 * The reward is wired into payment settlement, so the interesting test is the
 * last one: a referee applies a code, pays for their first trip, and BOTH
 * wallets hold the reward afterwards. Everything before it exists to make the
 * preconditions of that test unambiguous — a code that is stable, a redemption
 * that is case-insensitive, and the four ways an apply is refused.
 */
describe('referrals e2e (/v1/me/referral)', () => {
  let app: INestApplication;
  let db: TestDatabase;
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
  });

  const summaryOf = (auth: string) =>
    request(app.getHttpServer()).get('/v1/me/referral').set('Authorization', auth);

  const applyCode = (auth: string, code: string) =>
    request(app.getHttpServer())
      .post('/v1/me/referral/apply')
      .set('Authorization', auth)
      .send({ code });

  const walletBalancePaise = async (userId: string): Promise<number> => {
    const [row] = (await db.execute(sql`
      select balance from wallets
       where owner_type = 'user' and owner_id = ${userId}::uuid
    `)) as unknown as [{ balance: string } | undefined];
    return row ? rupeeStringToPaise(row.balance) : 0;
  };

  const expectNoDrift = async (): Promise<void> => {
    await expect(ledgerInvariants(db)).resolves.toEqual({
      walletDrift: 0,
      bookingDrift: 0,
      ledgerDrift: 0,
      reversalDrift: 0,
      couponDrift: 0,
    });
  };

  describe('summary', () => {
    it('mints a stable code, a share URL, and the default rewards', async () => {
      const userId = await seedCustomer(db, 'Referrer');
      const auth = await customerAuthHeaderFor(app, { userId });

      const first = await summaryOf(auth).expect(200);

      expect(first.body.code).toMatch(/^[A-Z]{1,5}[A-Z2-9]{4}$/);
      expect(first.body.shareUrl).toBe(`https://mitow.in/r/${first.body.code}`);
      expect(first.body.referrerRewardPaise).toBe(10000);
      expect(first.body.refereeRewardPaise).toBe(10000);
      expect(first.body.invitedCount).toBe(0);
      expect(first.body.rewardedCount).toBe(0);
      expect(first.body.earnedPaise).toBe(0);
      expect(first.body.appliedCode).toBeNull();
      expect(first.body.canApplyCode).toBe(true);

      // A second GET must not mint a second code.
      const second = await summaryOf(auth).expect(200);
      expect(second.body.code).toBe(first.body.code);
    });
  });

  describe('apply', () => {
    it('accepts a lower-case code and marks the referee pending', async () => {
      const referrerId = await seedCustomer(db, 'Referrer');
      const referrerAuth = await customerAuthHeaderFor(app, { userId: referrerId });
      const code = (await summaryOf(referrerAuth).expect(200)).body.code as string;

      const refereeId = await seedCustomer(db, 'Referee');
      const refereeAuth = await customerAuthHeaderFor(app, { userId: refereeId });

      const applied = await applyCode(refereeAuth, code.toLowerCase()).expect(200);
      expect(applied.body).toEqual({ status: 'pending', refereeRewardPaise: 10000 });

      const referrerSummary = await summaryOf(referrerAuth).expect(200);
      expect(referrerSummary.body.invitedCount).toBe(1);

      const refereeSummary = await summaryOf(refereeAuth).expect(200);
      expect(refereeSummary.body.appliedCode).toBe(code);
      expect(refereeSummary.body.canApplyCode).toBe(false);
    });

    it('refuses your own code with 422', async () => {
      const userId = await seedCustomer(db, 'Self Referrer');
      const auth = await customerAuthHeaderFor(app, { userId });
      const code = (await summaryOf(auth).expect(200)).body.code as string;

      await applyCode(auth, code).expect(422);
    });

    it('refuses an unknown code with 422', async () => {
      const userId = await seedCustomer(db, 'Referee');
      const auth = await customerAuthHeaderFor(app, { userId });

      await applyCode(auth, 'NOPEZZZZ').expect(422);
    });

    it('refuses a second apply with 409', async () => {
      const referrerId = await seedCustomer(db, 'Referrer');
      const referrerAuth = await customerAuthHeaderFor(app, { userId: referrerId });
      const code = (await summaryOf(referrerAuth).expect(200)).body.code as string;

      const refereeId = await seedCustomer(db, 'Referee');
      const refereeAuth = await customerAuthHeaderFor(app, { userId: refereeId });

      await applyCode(refereeAuth, code).expect(200);
      await applyCode(refereeAuth, code).expect(409);
    });

    it('refuses a customer who already has a booking with 409', async () => {
      const referrerId = await seedCustomer(db, 'Referrer');
      const referrerAuth = await customerAuthHeaderFor(app, { userId: referrerId });
      const code = (await summaryOf(referrerAuth).expect(200)).body.code as string;

      const refereeId = await seedCustomer(db, 'Booked Referee');
      const refereeAuth = await customerAuthHeaderFor(app, { userId: refereeId });
      await seedBooking(db, { userId: refereeId, status: 'completed', total: '500.00' });

      await applyCode(refereeAuth, code).expect(409);
    });
  });

  describe('reward', () => {
    it('credits both wallets once the referee pays for their first trip', async () => {
      const referrerId = await seedCustomer(db, 'Referrer');
      const referrerAuth = await customerAuthHeaderFor(app, { userId: referrerId });
      const code = (await summaryOf(referrerAuth).expect(200)).body.code as string;

      const refereeId = await seedCustomer(db, 'Referee');
      const refereeAuth = await customerAuthHeaderFor(app, { userId: refereeId });

      await applyCode(refereeAuth, code).expect(200);

      // The referee's wallet is empty, so the intent applies no wallet money —
      // the reward arrives AFTER settlement, not as a discount on the trip.
      expect(await walletBalancePaise(refereeId)).toBe(0);

      const driverId = await seedDriver(db, { name: 'Settling Driver' });
      const bookingId = await seedBooking(db, {
        userId: refereeId,
        driverId,
        status: 'completed',
        total: '2000.00',
      });
      await db.execute(sql`
        update bookings set commission_band = 'A', commission_pct = 10
         where id = ${bookingId}::uuid
      `);

      const intent = await request(app.getHttpServer())
        .post(`/v1/payments/${bookingId}/intent`)
        .set('Authorization', refereeAuth)
        .set('Idempotency-Key', randomUUID())
        .send({ purpose: 'booking' })
        .expect(201);

      const orderRef = intent.body.orderRef as string;
      const gatewayRef = devPaymentRef(orderRef);
      const signature = devCheckoutSignature(orderRef, gatewayRef, SECRET);

      await request(app.getHttpServer())
        .post(`/v1/payments/${bookingId}/capture`)
        .set('Authorization', refereeAuth)
        .set('Idempotency-Key', randomUUID())
        .send({ orderRef, gatewayRef, signature })
        .expect(200);

      expect(await walletBalancePaise(referrerId)).toBe(10000);
      expect(await walletBalancePaise(refereeId)).toBe(10000);

      const referrerSummary = await summaryOf(referrerAuth).expect(200);
      expect(referrerSummary.body.rewardedCount).toBe(1);
      expect(referrerSummary.body.earnedPaise).toBe(10000);

      await expectNoDrift();
    });
  });
});
