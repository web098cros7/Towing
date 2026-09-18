process.env.AUTH_DEV_OTP_ECHO = '1';
process.env.ADMIN_AUTHZ_TTL_MS = '0';

import type { INestApplication } from '@nestjs/common';
import {
  adminAdminDetailSchema,
  adminAdminsListResponseSchema,
  ErrorCodes,
} from '@towing/api-contracts';
import { desc, eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { adminActions, adminUsers } from '../../db/schema';
import { ADMIN_REVOKE_CHANNEL } from '../../redis/redis.constants';
import { adminAuthHeaderFor, createTestApp, customerAuthHeaderFor } from '../../test/app';
import { expectMatchesContract } from '../../test/contracts';
import {
  seedAdmin,
  seedCustomer,
  setupTestDatabase,
  truncateAll,
  type TestDatabase,
} from '../../test/db';
import { closeTestRedis, flushTestRedis, testRedis } from '../../test/redis';
import { redactAdminForAudit } from './admin-users.service';

const PASSWORD = 'AdminPass123!';
const REASON = 'test reason for the audit trail';

/**
 * Admin user management (W2, spec §4.2 "Manage admins & roles").
 *
 * The assertions that matter: the role matrix on every route (only
 * super_admin holds `admin.manage`), the redacted audit projection (no
 * credential material, key by key), the last-super-admin refusal (audited),
 * and the demote/deactivate authority chain — trigger-bumped version 401s
 * the next request (M0-F10: demotion never touches `authz_version` by hand)
 * while the revoked family refuses refresh outright.
 */
describe('admin users (/v1/admin/admins)', () => {
  let app: INestApplication;
  let db: TestDatabase;
  let superId: string;
  let superAuth: () => Promise<string>;

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
    // Two super_admins: most tests need a second one standing so the
    // last-super-admin guard does not trip by accident.
    const first = await seedAdmin(db, { subRole: 'super_admin' });
    await seedAdmin(db, { subRole: 'super_admin' });
    superId = first.id;
    superAuth = () => adminAuthHeaderFor(app, { adminId: first.id, subRole: 'super_admin' });
  });

  async function login(email: string, password: string) {
    const challenge = await request(app.getHttpServer())
      .post('/v1/admin/auth/login')
      .send({ email, password })
      .expect(200);

    const { otp } = (
      await request(app.getHttpServer())
        .get('/v1/admin/auth/dev/otp')
        .query({ challengeId: challenge.body.challengeId })
        .expect(200)
    ).body;

    const session = await request(app.getHttpServer())
      .post('/v1/admin/auth/verify')
      .send({ challengeId: challenge.body.challengeId, otp })
      .expect(200);

    return session.body as { accessToken: string; refreshToken: string; admin: { id: string } };
  }

  /** Collects messages published on a channel while `run` executes. */
  async function captureChannel<T>(
    run: () => Promise<T>,
  ): Promise<{ result: T; messages: Array<Record<string, unknown>> }> {
    const sub = testRedis().duplicate();
    const messages: Array<Record<string, unknown>> = [];
    await sub.subscribe(ADMIN_REVOKE_CHANNEL);
    sub.on('message', (_channel: string, raw: string) => {
      try {
        messages.push(JSON.parse(raw) as Record<string, unknown>);
      } catch {
        messages.push({ raw });
      }
    });

    try {
      const result = await run();
      await new Promise((resolve) => setTimeout(resolve, 150));
      return { result, messages };
    } finally {
      await sub.unsubscribe(ADMIN_REVOKE_CHANNEL);
      sub.disconnect();
    }
  }

  async function latestAudit(action: string) {
    const [row] = await db
      .select()
      .from(adminActions)
      .where(eq(adminActions.action, action))
      .orderBy(desc(adminActions.createdAt))
      .limit(1);
    return row;
  }

  describe('RBAC (§4.2 — only super_admin holds admin.manage)', () => {
    it('GET /v1/admin/admins: super_admin 200 · other admin sub-roles 403 · other realm 403 · anon 401', async () => {
      const server = app.getHttpServer();
      await request(server).get('/v1/admin/admins').set('Authorization', await superAuth()).expect(200);

      for (const subRole of ['operations', 'support', 'finance'] as const) {
        const other = await seedAdmin(db, { subRole });
        await request(server)
          .get('/v1/admin/admins')
          .set('Authorization', await adminAuthHeaderFor(app, { adminId: other.id, subRole }))
          .expect(403);
      }

      const customerAuth = await customerAuthHeaderFor(app, { userId: await seedCustomer(db) });
      await request(server).get('/v1/admin/admins').set('Authorization', customerAuth).expect(403);
      await request(server).get('/v1/admin/admins').expect(401);
    });

    it('write routes refuse non-super admins (create, update, deactivate, reactivate, reset)', async () => {
      const ops = await seedAdmin(db, { subRole: 'operations' });
      const opsAuth = await adminAuthHeaderFor(app, { adminId: ops.id, subRole: 'operations' });
      const target = await seedAdmin(db, { subRole: 'support' });
      const server = app.getHttpServer();

      await request(server)
        .post('/v1/admin/admins')
        .set('Authorization', opsAuth)
        .send({ name: 'Nope', email: 'nope@towing.test', mobile: '+910000000001', subRole: 'support' })
        .expect(403);
      await request(server)
        .put(`/v1/admin/admins/${target.id}`)
        .set('Authorization', opsAuth)
        .send({ name: 'Nope', reason: REASON })
        .expect(403);
      await request(server)
        .post(`/v1/admin/admins/${target.id}/deactivate`)
        .set('Authorization', opsAuth)
        .send({ reason: REASON })
        .expect(403);
      await request(server)
        .post(`/v1/admin/admins/${target.id}/reactivate`)
        .set('Authorization', opsAuth)
        .send({ reason: REASON })
        .expect(403);
      await request(server)
        .post(`/v1/admin/admins/${target.id}/reset-password`)
        .set('Authorization', opsAuth)
        .expect(403);
    });
  });

  describe('contracts', () => {
    it('GET /v1/admin/admins matches its contract (non-empty: the seeds)', async () => {
      const res = await request(app.getHttpServer())
        .get('/v1/admin/admins')
        .set('Authorization', await superAuth())
        .expect(200);

      expectMatchesContract(adminAdminsListResponseSchema, res.body);
      expect(res.body.total).toBeGreaterThanOrEqual(2);
    });

    it('GET /v1/admin/admins/:id matches its contract (SA 200 · ops 403 · anon 401)', async () => {
      const server = app.getHttpServer();
      const res = await request(server)
        .get(`/v1/admin/admins/${superId}`)
        .set('Authorization', await superAuth())
        .expect(200);

      expectMatchesContract(adminAdminDetailSchema, res.body);

      const ops = await seedAdmin(db, { subRole: 'operations' });
      await request(server)
        .get(`/v1/admin/admins/${superId}`)
        .set('Authorization', await adminAuthHeaderFor(app, { adminId: ops.id, subRole: 'operations' }))
        .expect(403);
      await request(server).get(`/v1/admin/admins/${superId}`).expect(401);
    });
  });

  describe('create', () => {
    it('creates an admin, audits redacted, and the temp password logs in', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/admin/admins')
        .set('Authorization', await superAuth())
        .send({
          name: 'New Ops',
          email: 'newops@towing.test',
          mobile: '+919845991001',
          subRole: 'operations',
          receivesOpsAlerts: true,
        })
        .expect(200);

      expectMatchesContract(adminAdminDetailSchema, res.body.admin);
      expect(typeof res.body.temporaryPassword).toBe('string');

      const audit = await latestAudit('admin.create');
      expect(audit).toBeDefined();
      for (const key of ['passwordHash', 'password_hash', 'twofaSecretEnc', 'twofa_secret_enc', 'twofaSecret', 'twofa_secret']) {
        expect(JSON.stringify(audit!.after)).not.toContain(key);
      }

      // The temp password is a real credential: a full login works with it.
      const session = await login('newops@towing.test', res.body.temporaryPassword as string);
      expect(session.admin.id).toBe(res.body.admin.id);
    });

    it('refuses a duplicate email or mobile with 409', async () => {
      const existing = await seedAdmin(db, { subRole: 'support' });
      const [row] = await db.select().from(adminUsers).where(eq(adminUsers.id, existing.id));

      await request(app.getHttpServer())
        .post('/v1/admin/admins')
        .set('Authorization', await superAuth())
        .send({ name: 'Dup', email: row!.email, mobile: '+919845992002', subRole: 'support' })
        .expect(409);
      await request(app.getHttpServer())
        .post('/v1/admin/admins')
        .set('Authorization', await superAuth())
        .send({ name: 'Dup', email: 'dup@towing.test', mobile: row!.mobile, subRole: 'support' })
        .expect(409);
    });
  });

  describe('demote and deactivate', () => {
    it('demoting an admin 401s their next request without a manual version bump, kills refresh, and publishes admin:revoke', async () => {
      const ops = await seedAdmin(db, { subRole: 'operations', password: PASSWORD });
      const session = await login(ops.email, PASSWORD);
      const opsAccess = `Bearer ${session.accessToken}`;

      const { messages } = await captureChannel(async () =>
        request(app.getHttpServer())
          .put(`/v1/admin/admins/${ops.id}`)
          .set('Authorization', await superAuth())
          .send({ subRole: 'support', reason: REASON })
          .expect(200),
      );

      expect(messages).toHaveLength(1);
      expect(messages[0]).toMatchObject({ adminId: ops.id, reason: 'sub_role_changed' });

      // A17 guard via the 0019 trigger: the row is newer than the token, and
      // nobody touched authz_version by hand to make it so.
      await request(app.getHttpServer())
        .get('/v1/admin/auth/me')
        .set('Authorization', opsAccess)
        .expect(401);

      // The family is revoked outright — no refresh, a fresh login instead.
      await request(app.getHttpServer())
        .post('/v1/admin/auth/refresh')
        .send({ refreshToken: session.refreshToken })
        .expect(401);

      const reduced = await login(ops.email, PASSWORD);
      await request(app.getHttpServer())
        .get('/v1/admin/auth/me')
        .set('Authorization', `Bearer ${reduced.accessToken}`)
        .expect(200);
      await request(app.getHttpServer())
        .get('/v1/admin/admins')
        .set('Authorization', `Bearer ${reduced.accessToken}`)
        .expect(403);
    });

    it('deactivating an admin 401s their live access token (guard reads status)', async () => {
      const ops = await seedAdmin(db, { subRole: 'operations', password: PASSWORD });
      const session = await login(ops.email, PASSWORD);

      await request(app.getHttpServer())
        .post(`/v1/admin/admins/${ops.id}/deactivate`)
        .set('Authorization', await superAuth())
        .send({ reason: REASON })
        .expect(200);

      await request(app.getHttpServer())
        .get('/v1/admin/auth/me')
        .set('Authorization', `Bearer ${session.accessToken}`)
        .expect(401);

      // ...and reactivation restores access with a fresh login.
      await request(app.getHttpServer())
        .post(`/v1/admin/admins/${ops.id}/reactivate`)
        .set('Authorization', await superAuth())
        .send({ reason: REASON })
        .expect(200);
      const again = await login(ops.email, PASSWORD);
      await request(app.getHttpServer())
        .get('/v1/admin/auth/me')
        .set('Authorization', `Bearer ${again.accessToken}`)
        .expect(200);
    });

    it('refuses to deactivate the last active super_admin with 409, and audits the refusal', async () => {
      // Leave exactly one standing.
      const [second] = await db
        .select({ id: adminUsers.id })
        .from(adminUsers)
        .where(eq(adminUsers.subRole, 'super_admin'));
      const lastId = second!.id;
      const others = await db.select({ id: adminUsers.id }).from(adminUsers);
      for (const row of others) {
        if (row.id !== lastId) {
          await db.delete(adminUsers).where(eq(adminUsers.id, row.id));
        }
      }
      const lastAuth = await adminAuthHeaderFor(app, { adminId: lastId, subRole: 'super_admin' });

      const res = await request(app.getHttpServer())
        .post(`/v1/admin/admins/${lastId}/deactivate`)
        .set('Authorization', lastAuth)
        .send({ reason: REASON })
        .expect(409);

      expect(res.body.error.code).toBe(ErrorCodes.LAST_SUPER_ADMIN);

      const refusal = await latestAudit('admin.deactivate.refused');
      expect(refusal).toBeDefined();
      expect(refusal!.subjectId).toBe(lastId);

      // Same for demoting away rather than deactivating.
      await request(app.getHttpServer())
        .put(`/v1/admin/admins/${lastId}`)
        .set('Authorization', lastAuth)
        .send({ subRole: 'operations', reason: REASON })
        .expect(409);
    });
  });

  describe('reset-password', () => {
    it('issues a temp password, forces the change flag, and revokes sessions', async () => {
      const ops = await seedAdmin(db, { subRole: 'operations', password: PASSWORD });
      const session = await login(ops.email, PASSWORD);

      const res = await request(app.getHttpServer())
        .post(`/v1/admin/admins/${ops.id}/reset-password`)
        .set('Authorization', await superAuth())
        .expect(200);

      expect(typeof res.body.temporaryPassword).toBe('string');

      const [row] = await db.select().from(adminUsers).where(eq(adminUsers.id, ops.id));
      expect(row!.mustChangePassword).toBe(true);

      // Old sessions are dead: the temp password travels out of band, and
      // nothing live may coexist with it.
      await request(app.getHttpServer())
        .get('/v1/admin/auth/me')
        .set('Authorization', `Bearer ${session.accessToken}`)
        .expect(401);

      // The temp password opens a challenge but mints no session until the
      // forced change completes (proven end to end in admin-totp.e2e.spec.ts).
      const challenge = await request(app.getHttpServer())
        .post('/v1/admin/auth/login')
        .send({ email: ops.email, password: res.body.temporaryPassword as string })
        .expect(200);
      await request(app.getHttpServer())
        .post('/v1/admin/auth/verify')
        .send({ challengeId: challenge.body.challengeId, otp: '000000' })
        .expect(403);
    });
  });

  describe('redactAdminForAudit', () => {
    it('strips every credential key and keeps the rest', () => {
      const redacted = redactAdminForAudit({
        id: 'x',
        email: 'a@b.c',
        passwordHash: 'scrypt$secret',
        twofaSecretEnc: 'enc:secret',
        twofaSecret: 'legacy',
        subRole: 'support',
      });

      expect(redacted).toEqual({ id: 'x', email: 'a@b.c', subRole: 'support' });
    });
  });
});
