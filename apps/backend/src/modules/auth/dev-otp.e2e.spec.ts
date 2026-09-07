import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assertProductionSafety, loadEnv } from '../../config/env';
import { createTestApp } from '../../test/app';
import { seedFleet, setupTestDatabase, truncateAll, type TestDatabase } from '../../test/db';
import { closeTestRedis, flushTestRedis } from '../../test/redis';
import { hashPassword } from './password';
import { fleetOwnerCredentials } from '../../db/schema';

/**
 * The development-only OTP echo, and the four things that keep it safe.
 *
 * It exists so a mocks-off Playwright run can complete the §16.4 two-step login
 * without scraping the server's log. That is a real convenience with a real
 * hazard attached, so the guard rails are what this file is about — not the
 * happy path.
 */
describe('GET /v1/fleet/auth/dev/otp', () => {
  let app: INestApplication;
  let db: TestDatabase;
  const email = 'devotp@fleet.test';
  const password = 'Password123!';

  beforeAll(async () => {
    db = await setupTestDatabase();
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
    await closeTestRedis();
  });

  async function startLogin(): Promise<string> {
    await truncateAll();
    await flushTestRedis();

    const fleet = await seedFleet(db, 'Dev OTP Fleet');
    await db.insert(fleetOwnerCredentials).values({
      userId: fleet.ownerId,
      email,
      passwordHash: await hashPassword(password),
    });

    const res = await request(app.getHttpServer())
      .post('/v1/fleet/auth/login')
      .send({ email, password })
      .expect(200);

    return res.body.challengeId as string;
  }

  it('is invisible unless AUTH_DEV_OTP_ECHO is set', async () => {
    const challengeId = await startLogin();

    // The default in every environment, including this one. A 404 rather than a
    // 403: an endpoint that must not exist should not confirm that it does.
    await request(app.getHttpServer())
      .get(`/v1/fleet/auth/dev/otp?challengeId=${challengeId}`)
      .expect(404);
  });

  it('completes a real login when enabled', async () => {
    process.env.AUTH_DEV_OTP_ECHO = 'true';
    const enabled = await createTestApp();

    try {
      await truncateAll();
      await flushTestRedis();

      const fleet = await seedFleet(db, 'Dev OTP Fleet');
      await db.insert(fleetOwnerCredentials).values({
        userId: fleet.ownerId,
        email,
        passwordHash: await hashPassword(password),
      });

      const login = await request(enabled.getHttpServer())
        .post('/v1/fleet/auth/login')
        .send({ email, password })
        .expect(200);

      const echoed = await request(enabled.getHttpServer())
        .get(`/v1/fleet/auth/dev/otp?challengeId=${login.body.challengeId}`)
        .expect(200);

      expect(echoed.body.otp).toMatch(/^\d{6}$/);

      // The code is the real one, not a placebo — it completes the login.
      const session = await request(enabled.getHttpServer())
        .post('/v1/fleet/auth/verify')
        .send({ challengeId: login.body.challengeId, otp: echoed.body.otp })
        .expect(200);

      expect(session.body.accessToken).toBeTruthy();
    } finally {
      delete process.env.AUTH_DEV_OTP_ECHO;
      await enabled.close();
    }
  });

  it('cannot be used to harvest a code for an arbitrary account', async () => {
    process.env.AUTH_DEV_OTP_ECHO = 'true';
    const enabled = await createTestApp();

    try {
      // Keyed on a CHALLENGE, which only exists once someone has passed step 1
      // with valid credentials. Without one there is nothing to ask for, so the
      // endpoint can only tell you a code you already earned.
      await request(enabled.getHttpServer())
        .get(`/v1/fleet/auth/dev/otp?challengeId=${randomUUID()}`)
        .expect(404);

      // And it is not a phone-number oracle either.
      await request(enabled.getHttpServer())
        .get('/v1/fleet/auth/dev/otp?challengeId=+919845000001')
        .expect(422);
    } finally {
      delete process.env.AUTH_DEV_OTP_ECHO;
      await enabled.close();
    }
  });

  it('refuses to let production boot with the flag on', () => {
    const env = loadEnv({
      ...process.env,
      NODE_ENV: 'production',
      AUTH_DEV_OTP_ECHO: 'true',
      JWT_ACCESS_SECRET: 'a-real-production-secret-at-least-32-chars',
      PAYOUT_PROVIDER: 'razorpay_route',
      PAYOUT_WEBHOOK_SECRET: 'a-real-production-webhook-secret',
      PAYMENT_GATEWAY: 'razorpay',
      PAYMENT_WEBHOOK_SECRET: 'a-real-production-payment-secret',
      RAZORPAY_KEY_ID: 'rzp_live_x',
      RAZORPAY_KEY_SECRET: 'secret',
      // Phase 18 added two more hard production requirements, and every
      // minimal-prod-env fixture has to satisfy them the way it already
      // satisfies the payout ones: a share link composed against localhost is
      // unrecoverable once somebody has sent it, and the direct-dial telephony
      // adapter publishes personal phone numbers (§20.4).
      PUBLIC_TRACK_BASE_URL: 'https://towing.app',
      TELEPHONY_PROVIDER: 'exotel',
      EXOTEL_SID: 'sid',
      EXOTEL_TOKEN: 'token',
    });

    // The last line of defence, and the one that matters: everything above is a
    // convention, this is the process refusing to start.
    expect(() => assertProductionSafety(env)).toThrow(/AUTH_DEV_OTP_ECHO/);
  });
});
