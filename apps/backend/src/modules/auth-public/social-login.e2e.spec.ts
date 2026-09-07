import type { INestApplication } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { assertProductionSafety, loadEnv } from '../../config/env';
import { socialIdentities, users } from '../../db/schema';
import { createTestApp } from '../../test/app';
import { setupTestDatabase, truncateAll, type TestDatabase } from '../../test/db';
import { SOCIAL_IDENTITY_PORTS, type SocialIdentityPort } from './social/social-identity.port';

/**
 * `POST /v1/auth/social` — the wiring, not the crypto.
 *
 * Token verification itself is `google-identity.adapter.spec.ts`'s job; here the
 * adapter is replaced with a stub so this file can assert what happens AROUND a
 * successful verification: the binding row, account reuse, and the fact that
 * Apple is registered and refuses.
 */
describe('social login (/v1/auth/social)', () => {
  let app: INestApplication;
  let db: TestDatabase;
  let googleSubject: string;

  beforeAll(async () => {
    db = await setupTestDatabase();
    app = await createTestApp();

    // Replace the Google adapter's verify with a stub. The registry holds the
    // same instances the module wired, so this exercises the real registry,
    // service, repo and controller.
    const ports = app.get<SocialIdentityPort[]>(SOCIAL_IDENTITY_PORTS);
    const google = ports.find((port) => port.provider === 'google')!;
    Object.defineProperty(google, 'enabled', { get: () => true });
    google.verify = async () => ({
      provider: 'google',
      subject: googleSubject,
      email: 'rider@example.com',
      emailVerified: true,
      name: 'Social Rider',
      pictureUrl: null,
    });
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await truncateAll();
    googleSubject = `google-${Math.random().toString(36).slice(2, 10)}`;
  });

  const signIn = (role: 'customer' | 'driver' = 'customer') =>
    request(app.getHttpServer())
      .post('/v1/auth/social')
      .send({ provider: 'google', idToken: 'stubbed', role });

  it('mints a session and records the provider binding', async () => {
    const res = await signIn().expect(200);
    expect(res.body.customer).toMatchObject({ name: 'Social Rider', isNew: true });

    const [binding] = await db.select().from(socialIdentities);
    expect(binding).toMatchObject({
      provider: 'google',
      providerSubject: googleSubject,
      subjectType: 'user',
      emailVerified: true,
    });
    expect(binding!.subjectId).toBe(res.body.customer.id);
  });

  it('returns the same account on a second sign-in, keyed on the provider subject', async () => {
    const first = await signIn().expect(200);
    const second = await signIn().expect(200);

    expect(second.body.customer.id).toBe(first.body.customer.id);
    expect(second.body.customer.isNew).toBe(false);
    expect(await db.select().from(socialIdentities)).toHaveLength(1);
    expect(await db.select().from(users)).toHaveLength(1);
  });

  it('the same Google account in the driver app is a separate driver record', async () => {
    const customer = await signIn('customer').expect(200);
    const driver = await signIn('driver').expect(200);

    expect(driver.body.driver.id).not.toBe(customer.body.customer.id);
    // A fresh driver is `incomplete` however they signed up — the §3.1 gate does
    // not care which button they pressed.
    expect(driver.body.driver.kycStatus).toBe('incomplete');

    const bindings = await db.select().from(socialIdentities);
    expect(bindings.map((b) => b.subjectType).sort()).toEqual(['driver', 'user']);
  });

  it('APPLE IS REGISTERED AND DISABLED (Phase 13 enables it)', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/auth/social')
      .send({ provider: 'apple', idToken: 'anything', role: 'customer' })
      .expect(403);

    expect(res.body.error.message).toMatch(/apple sign-in is not available/i);
    expect(await db.select().from(socialIdentities)).toHaveLength(0);
  });

  it('production refuses to boot with APPLE_LOGIN_ENABLED set', () => {
    // The adapter has never executed against Apple's servers and there are no
    // credentials for it. Enabling it would show users a button that cannot work.
    const env = loadEnv({
      ...process.env,
      NODE_ENV: 'production',
      JWT_ACCESS_SECRET: 'a-real-production-secret-at-least-32-chars',
      PAYOUT_PROVIDER: 'razorpay_route',
      PAYOUT_WEBHOOK_SECRET: 'a-real-webhook-secret',
      PAYMENT_GATEWAY: 'razorpay',
      PAYMENT_WEBHOOK_SECRET: 'a-real-payment-webhook-secret',
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
      AUTH_DEV_OTP_ECHO: '',
      APPLE_LOGIN_ENABLED: '1',
    });

    expect(() => assertProductionSafety(env)).toThrow(/APPLE_LOGIN_ENABLED/);
  });

  it('rejects an unknown provider before reaching any adapter', async () => {
    await request(app.getHttpServer())
      .post('/v1/auth/social')
      .send({ provider: 'facebook', idToken: 'x', role: 'customer' })
      .expect(422);
  });

  it('rejects a social login for a realm that does not use this endpoint', async () => {
    // Fleet owners and admins authenticate with a password; offering them a
    // social path would be a second, weaker way into a privileged realm.
    await request(app.getHttpServer())
      .post('/v1/auth/social')
      .send({ provider: 'google', idToken: 'stubbed', role: 'fleet_owner' })
      .expect(422);
  });

  it('a social account can then refresh through the public route', async () => {
    const session = await signIn().expect(200);

    await request(app.getHttpServer())
      .post('/v1/auth/refresh')
      .send({ refreshToken: session.body.refreshToken })
      .expect(200);
  });

  it('keeps the binding when the provider subject already exists', async () => {
    await signIn().expect(200);
    const [before] = await db
      .select()
      .from(socialIdentities)
      .where(eq(socialIdentities.providerSubject, googleSubject));

    await signIn().expect(200);
    const [after] = await db
      .select()
      .from(socialIdentities)
      .where(eq(socialIdentities.providerSubject, googleSubject));

    expect(after!.id).toBe(before!.id);
    expect(after!.lastLoginAt).not.toBeNull();
  });
});
