process.env.AUTH_DEV_OTP_ECHO = '1';
process.env.ADMIN_AUTHZ_TTL_MS = '0';

import type { INestApplication } from '@nestjs/common';
import { generate } from 'otplib';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { desc, eq } from 'drizzle-orm';
import { adminActions, adminRecoveryCodes, adminUsers } from '../../db/schema';
import {
  adminRecoveryCodesResponseSchema,
  adminTotpEnrollResponseSchema,
  adminTotpStatusSchema,
  ErrorCodes,
} from '@towing/api-contracts';
import { adminAuthHeaderFor, createTestApp } from '../../test/app';
import { expectMatchesContract } from '../../test/contracts';
import { seedAdmin, setupTestDatabase, truncateAll, type TestDatabase } from '../../test/db';
import { closeTestRedis, flushTestRedis } from '../../test/redis';

const PASSWORD = 'AdminPass123!';
const NEW_PASSWORD = 'NewPass456!';

/**
 * Admin TOTP second factor (W2): enrol → confirm → TOTP login, recovery
 * codes, replay refusal, and the forced-change completion route.
 *
 * Time-boundary discipline: adjacent-step codes use ±25 s offsets (always
 * inside the neighbouring step — never ON a boundary), and far codes ±65 s
 * (always ≥2 steps away). Exact-boundary epochs would be flaky by
 * construction, so no test generates one.
 */
describe('admin TOTP (/v1/admin/auth)', () => {
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

  function secretFromUri(uri: string): string {
    const secret = new URL(uri).searchParams.get('secret');
    expect(secret).toBeTruthy();
    return secret!;
  }

  /**
   * otplib epochs are SECONDS (see `TotpService.verifyCode` — milliseconds
   * silently mint far-future codes and shrink replay detection to 30 ms).
   * Offsets in ms; ±25 s always lands 0–1 steps away, ±65 s always ≥2 away,
   * so no test ever generates an exact-boundary epoch.
   */
  function stepEpoch(offsetMs: number): number {
    return Math.floor(Date.now() / 1000) + Math.floor(offsetMs / 1000);
  }

  function startLogin(email: string, password: string) {
    return request(app.getHttpServer()).post('/v1/admin/auth/login').send({ email, password });
  }

  async function enrolAndConfirm(adminId: string, subRole: 'super_admin' | 'operations' | 'support' | 'finance') {
    const auth = await authHeader(adminId, subRole);
    const enroll = await request(app.getHttpServer())
      .post('/v1/admin/auth/2fa/enroll')
      .set('Authorization', auth)
      .expect(200);

    expect(enroll.body.otpauthUri).toContain('otpauth://totp/');
    expectMatchesContract(adminTotpEnrollResponseSchema, enroll.body);

    const secret = secretFromUri(enroll.body.otpauthUri);
    const code = await generate({ secret, epoch: stepEpoch(0) });
    const confirmed = await request(app.getHttpServer())
      .post('/v1/admin/auth/2fa/confirm')
      .set('Authorization', auth)
      .send({ code });
    expect(confirmed.status).toBe(200);
    const status = expectMatchesContract(adminTotpStatusSchema, confirmed.body);
    expect(status.enabled).toBe(true);

    return { auth, secret };
  }

  async function authHeader(adminId: string, subRole: 'super_admin' | 'operations' | 'support' | 'finance') {
    return adminAuthHeaderFor(app, { adminId, subRole });
  }

  async function totpLogin(email: string, password: string, code: string) {
    const challenge = await startLogin(email, password).expect(200);
    expect(challenge.body.method).toBe('totp');
    return request(app.getHttpServer())
      .post('/v1/admin/auth/verify')
      .send({ challengeId: challenge.body.challengeId, otp: code });
  }

  describe('enrolment', () => {
    it('enrols with an otpauth URI and confirms by proving possession', async () => {
      const admin = await seedAdmin(db, { subRole: 'operations', password: PASSWORD });
      const { secret } = await enrolAndConfirm(admin.id, 'operations');

      const [row] = await db.select().from(adminUsers).where(eq(adminUsers.id, admin.id));
      expect(row!.twofaEnabled).toBe(true);
      expect(row!.twofaSecretEnc).not.toContain(secret);
      expect(row!.twofaConfirmedAt).not.toBeNull();
      // The replay counter tracks authentications, not the enrolment proof —
      // a first login in the same 30 s window must succeed, not 401 as replay.
      expect(row!.twofaLastCounter).toBeNull();

      const [audit] = await db
        .select()
        .from(adminActions)
        .where(eq(adminActions.action, 'admin.2fa_confirm'))
        .orderBy(desc(adminActions.createdAt))
        .limit(1);
      expect(audit).toBeDefined();
      expect(JSON.stringify(audit!.after)).not.toContain(secret);
    });

    it('refuses confirm without enrolment (409) and a wrong code (401)', async () => {
      const admin = await seedAdmin(db, { subRole: 'operations', password: PASSWORD });
      const auth = await authHeader(admin.id, 'operations');

      await request(app.getHttpServer())
        .post('/v1/admin/auth/2fa/confirm')
        .set('Authorization', auth)
        .send({ code: '000000' })
        .expect(409);

      await request(app.getHttpServer())
        .post('/v1/admin/auth/2fa/enroll')
        .set('Authorization', auth)
        .expect(200);
      await request(app.getHttpServer())
        .post('/v1/admin/auth/2fa/confirm')
        .set('Authorization', auth)
        .send({ code: '000000' })
        .expect(401);
    });

    it('refuses a second enrolment while enabled (409)', async () => {
      const admin = await seedAdmin(db, { subRole: 'operations', password: PASSWORD });
      const { auth } = await enrolAndConfirm(admin.id, 'operations');

      const res = await request(app.getHttpServer())
        .post('/v1/admin/auth/2fa/enroll')
        .set('Authorization', auth)
        .expect(409);
      expect(res.body.error.code).toBe(ErrorCodes.TOTP_ALREADY_ENABLED);
    });

    it('a support admin can enrol for themselves (self-service, not admin.manage)', async () => {
      const admin = await seedAdmin(db, { subRole: 'support', password: PASSWORD });
      await enrolAndConfirm(admin.id, 'support');
    });
  });

  describe('TOTP login', () => {
    it('SMS admins get method sms; TOTP admins get method totp and no SMS is minted', async () => {
      const sms = await seedAdmin(db, { subRole: 'operations', password: PASSWORD });
      const smsChallenge = await startLogin(sms.email, PASSWORD).expect(200);
      expect(smsChallenge.body.method).toBe('sms');

      const totp = await seedAdmin(db, { subRole: 'operations', password: PASSWORD });
      await enrolAndConfirm(totp.id, 'operations');

      const challenge = await startLogin(totp.email, PASSWORD).expect(200);
      expect(challenge.body.method).toBe('totp');

      // Nothing was sent to the mobile: the dev echo has nothing to echo.
      await request(app.getHttpServer())
        .get('/v1/admin/auth/dev/otp')
        .query({ challengeId: challenge.body.challengeId })
        .expect(404);
    });

    it('accepts the current code end to end', async () => {
      const admin = await seedAdmin(db, { subRole: 'operations', password: PASSWORD });
      const { secret } = await enrolAndConfirm(admin.id, 'operations');

      const code = await generate({ secret, epoch: stepEpoch(0) });
      const session = await totpLogin(admin.email, PASSWORD, code);
      expect(session.status).toBe(200);
      expect(session.body.admin.id).toBe(admin.id);
    });

    it('accepts ±1 step and refuses ±2 steps', async () => {
      const admin = await seedAdmin(db, { subRole: 'operations', password: PASSWORD });
      const { secret } = await enrolAndConfirm(admin.id, 'operations');

      for (const offset of [-25_000, 25_000]) {
        const code = await generate({ secret, epoch: stepEpoch(offset) });
        expect((await totpLogin(admin.email, PASSWORD, code)).status).toBe(200);
      }
      for (const offset of [-65_000, 65_000]) {
        const code = await generate({ secret, epoch: stepEpoch(offset) });
        expect((await totpLogin(admin.email, PASSWORD, code)).status).toBe(401);
      }
    });

    it('refuses a replayed code with the same message as a wrong code', async () => {
      const admin = await seedAdmin(db, { subRole: 'operations', password: PASSWORD });
      const { secret } = await enrolAndConfirm(admin.id, 'operations');

      const code = await generate({ secret, epoch: stepEpoch(0) });
      const first = await totpLogin(admin.email, PASSWORD, code);
      expect(first.status).toBe(200);

      const replay = await totpLogin(admin.email, PASSWORD, code);
      expect(replay.status).toBe(401);
      const wrong = await totpLogin(admin.email, PASSWORD, '000000');
      expect(wrong.status).toBe(401);
      expect(replay.body.error.message).toBe(wrong.body.error.message);
      expect(first.body.admin.id).toBe(admin.id);
    });
  });

  describe('recovery codes', () => {
    it('a code logs in once; reuse is refused', async () => {
      const admin = await seedAdmin(db, { subRole: 'operations', password: PASSWORD });
      const { auth } = await enrolAndConfirm(admin.id, 'operations');

      const issued = await request(app.getHttpServer())
        .post('/v1/admin/auth/2fa/recovery-codes')
        .set('Authorization', auth)
        .expect(200);
      expectMatchesContract(adminRecoveryCodesResponseSchema, issued.body);
      expect(issued.body.codes).toHaveLength(10);

      const [stored] = await db
        .select()
        .from(adminRecoveryCodes)
        .where(eq(adminRecoveryCodes.adminId, admin.id));
      expect(stored).toBeDefined();
      expect(JSON.stringify(stored)).not.toContain(issued.body.codes[0] as string);

      const challenge = await startLogin(admin.email, PASSWORD).expect(200);
      await request(app.getHttpServer())
        .post('/v1/admin/auth/verify')
        .send({ challengeId: challenge.body.challengeId, otp: issued.body.codes[0] as string })
        .expect(200);

      const challenge2 = await startLogin(admin.email, PASSWORD).expect(200);
      // Reuse is indistinguishable from a wrong code: naming it would tell
      // an attacker holding an intercepted code that it was once valid.
      const replay = await request(app.getHttpServer())
        .post('/v1/admin/auth/verify')
        .send({ challengeId: challenge2.body.challengeId, otp: issued.body.codes[0] as string })
        .expect(401);
      expect(replay.body.error.message).toBe('That code is not correct');
    });

    it('rotation kills the old sheet', async () => {
      const admin = await seedAdmin(db, { subRole: 'operations', password: PASSWORD });
      const { auth } = await enrolAndConfirm(admin.id, 'operations');

      const first = await request(app.getHttpServer())
        .post('/v1/admin/auth/2fa/recovery-codes')
        .set('Authorization', auth)
        .expect(200);
      await request(app.getHttpServer())
        .post('/v1/admin/auth/2fa/recovery-codes')
        .set('Authorization', auth)
        .expect(200);

      const challenge = await startLogin(admin.email, PASSWORD).expect(200);
      await request(app.getHttpServer())
        .post('/v1/admin/auth/verify')
        .send({ challengeId: challenge.body.challengeId, otp: first.body.codes[0] as string })
        .expect(401);
    });
  });

  describe('disable', () => {
    it('disables with a reason, burns codes, and falls back to SMS', async () => {
      const admin = await seedAdmin(db, { subRole: 'operations', password: PASSWORD });
      const { auth } = await enrolAndConfirm(admin.id, 'operations');

      await request(app.getHttpServer())
        .post('/v1/admin/auth/2fa/recovery-codes')
        .set('Authorization', auth)
        .expect(200);

      const disabled = await request(app.getHttpServer())
        .post('/v1/admin/auth/2fa/disable')
        .set('Authorization', auth)
        .send({ reason: 'lost authenticator device' })
        .expect(200);
      const disabledStatus = expectMatchesContract(adminTotpStatusSchema, disabled.body);
      expect(disabledStatus.enabled).toBe(false);

      const [row] = await db.select().from(adminUsers).where(eq(adminUsers.id, admin.id));
      expect(row!.twofaEnabled).toBe(false);
      expect(row!.twofaSecretEnc).toBeNull();
      const codes = await db
        .select()
        .from(adminRecoveryCodes)
        .where(eq(adminRecoveryCodes.adminId, admin.id));
      expect(codes).toHaveLength(0);

      // Back to SMS: a fresh login mints a real code again.
      const challenge = await startLogin(admin.email, PASSWORD).expect(200);
      expect(challenge.body.method).toBe('sms');
      const { otp } = (
        await request(app.getHttpServer())
          .get('/v1/admin/auth/dev/otp')
          .query({ challengeId: challenge.body.challengeId })
          .expect(200)
      ).body;
      await request(app.getHttpServer())
        .post('/v1/admin/auth/verify')
        .send({ challengeId: challenge.body.challengeId, otp })
        .expect(200);
    });
  });

  describe('forced password change', () => {
    it('verify refuses with PASSWORD_CHANGE_REQUIRED; completion mints the session and retires the temp', async () => {
      const sa = await seedAdmin(db, { subRole: 'super_admin' });
      const saAuth = await authHeader(sa.id, 'super_admin');
      const ops = await seedAdmin(db, { subRole: 'operations', password: PASSWORD });

      const reset = await request(app.getHttpServer())
        .post(`/v1/admin/admins/${ops.id}/reset-password`)
        .set('Authorization', saAuth)
        .expect(200);
      const temp = reset.body.temporaryPassword as string;

      const challenge = await startLogin(ops.email, temp).expect(200);
      const refused = await request(app.getHttpServer())
        .post('/v1/admin/auth/verify')
        .send({ challengeId: challenge.body.challengeId, otp: '000000' })
        .expect(403);
      expect(refused.body.error.code).toBe(ErrorCodes.PASSWORD_CHANGE_REQUIRED);

      const done = await request(app.getHttpServer())
        .post('/v1/admin/auth/password/complete')
        .send({ challengeId: challenge.body.challengeId, newPassword: NEW_PASSWORD })
        .expect(200);
      expect(done.body.admin.id).toBe(ops.id);
      expect(done.body.accessToken).toBeTruthy();

      // The temp password is dead; the new one works through the full flow.
      await startLogin(ops.email, temp).expect(401);
      const challenge2 = await startLogin(ops.email, NEW_PASSWORD).expect(200);
      expect(challenge2.body.method).toBe('sms');
    });

    it('completion rejects a weak password (422) and an unknown challenge (401)', async () => {
      await request(app.getHttpServer())
        .post('/v1/admin/auth/password/complete')
        .send({ challengeId: '00000000-0000-4000-8000-000000000000', newPassword: 'short' })
        .expect(422);
      await request(app.getHttpServer())
        .post('/v1/admin/auth/password/complete')
        .send({ challengeId: '00000000-0000-4000-8000-000000000000', newPassword: NEW_PASSWORD })
        .expect(401);
    });
  });
});
