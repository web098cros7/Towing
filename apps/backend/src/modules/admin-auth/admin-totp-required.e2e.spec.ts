process.env.AUTH_DEV_OTP_ECHO = '1';
process.env.ADMIN_TOTP_REQUIRED = 'true';
// Every request re-reads the admin row, so a spec never waits out the
// per-process cache between "enrolled" and "allowed".
process.env.ADMIN_AUTHZ_TTL_MS = '0';

import type { INestApplication } from '@nestjs/common';
import { adminIdentitySchema, ErrorCodes } from '@towing/api-contracts';
import { eq } from 'drizzle-orm';
import { generate } from 'otplib';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { adminUsers } from '../../db/schema';
import { adminAuthHeaderFor, createTestApp } from '../../test/app';
import { expectMatchesContract } from '../../test/contracts';
import { seedAdmin, setupTestDatabase, truncateAll, type TestDatabase } from '../../test/db';
import { closeTestRedis, flushTestRedis } from '../../test/redis';

type SubRole = 'super_admin' | 'operations' | 'support' | 'finance';

/**
 * ADM-16: Super Admin and Finance must use an authenticator app, not SMS
 * alone. Ehsan's default, 18 Sep.
 *
 * The shape being proven is "signed in, but only to the setup". A 401 or a
 * refused login would lock out the very admins who have to do the enrolling —
 * there is no other way in to reach the enrol screen — so the session is real
 * and every route except identity, own sessions and the 2FA routes answers
 * `totp_enrolment_required` until they finish.
 */
describe('ADM-16 — an authenticator is required for Super Admin and Finance', () => {
  let app: INestApplication;
  let db: TestDatabase;

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
  });

  /**
   * An ordinary admin read that all four sub-roles hold (`user.read`), so a
   * 200 here means the enrolment rule let the request through and a 403
   * cannot be a role refusal in disguise.
   */
  const guardedRead = (auth: string) =>
    request(app.getHttpServer())
      .get('/v1/admin/notes')
      .query({ subjectType: 'driver', subjectId: '00000000-0000-4000-8000-000000000000' })
      .set('Authorization', auth);

  const me = (auth: string) =>
    request(app.getHttpServer()).get('/v1/admin/auth/me').set('Authorization', auth);

  async function enrol(auth: string): Promise<void> {
    const enroll = await request(app.getHttpServer())
      .post('/v1/admin/auth/2fa/enroll')
      .set('Authorization', auth)
      .expect(200);
    const secret = new URL(enroll.body.otpauthUri).searchParams.get('secret')!;
    const code = await generate({ secret, epoch: Math.floor(Date.now() / 1000) });
    await request(app.getHttpServer())
      .post('/v1/admin/auth/2fa/confirm')
      .set('Authorization', auth)
      .send({ code })
      .expect(200);
  }

  it.each<SubRole>(['super_admin', 'finance'])(
    'a %s with no authenticator is refused everything but the setup',
    async (subRole) => {
      const admin = await seedAdmin(db, { subRole });
      const auth = await adminAuthHeaderFor(app, { adminId: admin.id, subRole });

      const refused = await guardedRead(auth).expect(403);
      expect(refused.body.error.code).toBe(ErrorCodes.TOTP_ENROLMENT_REQUIRED);

      // …while the routes the setup screen needs still answer.
      const identity = expectMatchesContract(adminIdentitySchema, (await me(auth).expect(200)).body);
      expect(identity.twofaEnrolmentRequired).toBe(true);
      await request(app.getHttpServer())
        .get('/v1/admin/auth/sessions')
        .set('Authorization', auth)
        .expect(200);
    },
  );

  it.each<SubRole>(['operations', 'support'])('a %s keeps SMS alone', async (subRole) => {
    // The default names two roles, not every admin. Support and Operations
    // are not the accounts that move money or change the rules.
    const admin = await seedAdmin(db, { subRole });
    const auth = await adminAuthHeaderFor(app, { adminId: admin.id, subRole });

    await guardedRead(auth).expect(200);
    expect((await me(auth).expect(200)).body.twofaEnrolmentRequired).toBe(false);
  });

  it('lets the admin through the moment they finish enrolling, on the same token', async () => {
    // No re-login and no refresh: the next request after "confirmed" must work,
    // or the admin concludes the setup failed.
    const admin = await seedAdmin(db, { subRole: 'finance' });
    const auth = await adminAuthHeaderFor(app, { adminId: admin.id, subRole: 'finance' });
    await guardedRead(auth).expect(403);

    await enrol(auth);

    await guardedRead(auth).expect(200);
    expect((await me(auth).expect(200)).body.twofaEnrolmentRequired).toBe(false);
  });

  it('starts requiring it the moment an admin is promoted into a required role', async () => {
    // Read off the admin row, not the token: a Support admin promoted to
    // Finance must not keep an SMS-only session with payout rights until
    // their old token expires.
    const admin = await seedAdmin(db, { subRole: 'support' });
    const supportAuth = await adminAuthHeaderFor(app, { adminId: admin.id, subRole: 'support' });
    await guardedRead(supportAuth).expect(200);

    const promoter = await seedAdmin(db, { subRole: 'super_admin' });
    const promoterAuth = await adminAuthHeaderFor(app, {
      adminId: promoter.id,
      subRole: 'super_admin',
    });
    await enrol(promoterAuth);
    await request(app.getHttpServer())
      .put(`/v1/admin/admins/${admin.id}`)
      .set('Authorization', promoterAuth)
      .send({ subRole: 'finance', reason: 'Joining the finance team' })
      .expect(200);

    // The promotion bumps authz_version, so the old token is stale (A17)…
    await guardedRead(supportAuth).expect(401);
    // …and a freshly minted Finance token lands on the setup, not the console.
    // Minted at the row's CURRENT authz_version, the way a real refresh does.
    const [row] = await db
      .select({ authzVersion: adminUsers.authzVersion })
      .from(adminUsers)
      .where(eq(adminUsers.id, admin.id));
    const financeAuth = await adminAuthHeaderFor(app, {
      adminId: admin.id,
      subRole: 'finance',
      authzVersion: row!.authzVersion,
    });
    const refused = await guardedRead(financeAuth).expect(403);
    expect(refused.body.error.code).toBe(ErrorCodes.TOTP_ENROLMENT_REQUIRED);
  });

  it('never blocks the sign-in itself, so there is always a way to reach the setup', async () => {
    const password = 'AdminPass123!';
    const admin = await seedAdmin(db, { subRole: 'super_admin', password });

    const challenge = await request(app.getHttpServer())
      .post('/v1/admin/auth/login')
      .send({ email: admin.email, password })
      .expect(200);
    expect(challenge.body.method).toBe('sms');

    const { body: otp } = await request(app.getHttpServer())
      .get('/v1/admin/auth/dev/otp')
      .query({ challengeId: challenge.body.challengeId })
      .expect(200);
    const session = await request(app.getHttpServer())
      .post('/v1/admin/auth/verify')
      .send({ challengeId: challenge.body.challengeId, otp: otp.otp })
      .expect(200);

    expect(session.body.admin.twofaEnrolmentRequired).toBe(true);
    await me(`Bearer ${session.body.accessToken}`).expect(200);
  });
});
