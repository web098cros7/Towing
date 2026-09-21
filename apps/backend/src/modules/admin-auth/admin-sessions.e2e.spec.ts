process.env.AUTH_DEV_OTP_ECHO = '1';

import type { INestApplication } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { adminActions, refreshTokens } from '../../db/schema';
import { createTestApp, authHeaderFor } from '../../test/app';
import {
  seedAdmin,
  seedFleet,
  setupTestDatabase,
  truncateAll,
  type TestDatabase,
} from '../../test/db';
import { closeTestRedis, flushTestRedis } from '../../test/redis';
import { TokenService } from '../auth/token.service';

const PASSWORD = 'AdminPass123!';

/**
 * W1 §3.6 — the admin session policy: 30-minute idle, 12-hour absolute (G15),
 * plus the self-service session list and revoke routes.
 *
 * The windows are exercised by AGEING THE ROWS, not by fake timers: the
 * enforcement lives in a SQL predicate on `refresh_tokens.updated_at` /
 * `created_at`, so moving the clock with `vi.useFakeTimers` would test a
 * different system than the one production runs. `Date.now()` in the service
 * and the row timestamps the test writes share the same clock.
 */
describe('admin sessions (/v1/admin/auth/sessions, §3.6)', () => {
  let app: INestApplication;
  let db: TestDatabase;
  let tokens: TokenService;

  beforeAll(async () => {
    db = await setupTestDatabase();
    app = await createTestApp();
    tokens = app.get(TokenService);
  });

  afterAll(async () => {
    await app.close();
    await closeTestRedis();
  });

  beforeEach(async () => {
    await truncateAll();
    await flushTestRedis();
  });

  async function login(email: string) {
    const challenge = await request(app.getHttpServer())
      .post('/v1/admin/auth/login')
      .send({ email, password: PASSWORD })
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

  /** Ages the family's one ACTIVE row — the row a rotation would claim. */
  async function ageActiveRow(
    subjectId: string,
    age: { idleMs?: number; absoluteMs?: number },
  ): Promise<void> {
    const now = Date.now();
    await db
      .update(refreshTokens)
      .set({
        ...(age.idleMs ? { updatedAt: new Date(now - age.idleMs) } : {}),
        ...(age.absoluteMs ? { createdAt: new Date(now - age.absoluteMs) } : {}),
      })
      .where(
        and(
          eq(refreshTokens.subjectId, subjectId),
          eq(refreshTokens.realm, 'admin'),
          isNull(refreshTokens.rotatedAt),
        ),
      );
  }

  it('refuses a refresh after 30 minutes idle and burns the family', async () => {
    const admin = await seedAdmin(db, { password: PASSWORD });
    const session = await login(admin.email);

    await ageActiveRow(admin.id, { idleMs: 31 * 60_000 });

    const res = await request(app.getHttpServer())
      .post('/v1/admin/auth/refresh')
      .send({ refreshToken: session.refreshToken })
      .expect(401);

    expect(res.body.error.message).toContain('30 minutes');

    const [row] = await db
      .select()
      .from(refreshTokens)
      .where(and(eq(refreshTokens.subjectId, admin.id), isNull(refreshTokens.rotatedAt)));
    // Revoked, not merely refused: a row left claimable could be raced
    // forever, and a reactivated admin would resurrect it.
    expect(row!.revokedAt).not.toBeNull();
    expect(row!.revokedReason).toBe('idle_timeout');
  });

  it('refuses a refresh after 12 hours even while active, and burns the family', async () => {
    const admin = await seedAdmin(db, { password: PASSWORD });
    const session = await login(admin.email);

    // Active NOW (idle window satisfied) but minted 13 hours ago.
    await ageActiveRow(admin.id, { absoluteMs: 13 * 60 * 60_000 });

    const res = await request(app.getHttpServer())
      .post('/v1/admin/auth/refresh')
      .send({ refreshToken: session.refreshToken })
      .expect(401);

    expect(res.body.error.message).toContain('12-hour');

    const [row] = await db
      .select()
      .from(refreshTokens)
      .where(and(eq(refreshTokens.subjectId, admin.id), isNull(refreshTokens.rotatedAt)));
    expect(row!.revokedAt).not.toBeNull();
    expect(row!.revokedReason).toBe('absolute_timeout');
  });

  it('leaves other realms alone — a fleet token older than both windows still rotates', async () => {
    const fleet = await seedFleet(db, 'Sessions Fleet');
    const issued = await tokens.issueSession({
      subjectId: fleet.ownerId,
      realm: 'fleet',
      fleetId: fleet.fleetId,
    });

    // Same ageing that kills an admin session, applied to a fleet family.
    await db
      .update(refreshTokens)
      .set({
        updatedAt: new Date(Date.now() - 31 * 60_000),
        createdAt: new Date(Date.now() - 13 * 60 * 60_000),
      })
      .where(and(eq(refreshTokens.subjectId, fleet.ownerId), eq(refreshTokens.realm, 'fleet')));

    await request(app.getHttpServer())
      .post('/v1/fleet/auth/refresh')
      .send({ refreshToken: issued.refreshToken })
      .expect(200);
  });

  it('lists the caller’s own sessions and revokes one — with an audit row', async () => {
    const admin = await seedAdmin(db, { subRole: 'support', password: PASSWORD });
    const session = await login(admin.email);

    const list = await request(app.getHttpServer())
      .get('/v1/admin/auth/sessions')
      .set('Authorization', `Bearer ${session.accessToken}`)
      .expect(200);

    expect(list.body.sessions).toHaveLength(1);
    expect(list.body.sessions[0].id).toBeTruthy();

    await request(app.getHttpServer())
      .delete(`/v1/admin/auth/sessions/${list.body.sessions[0].id}`)
      .set('Authorization', `Bearer ${session.accessToken}`)
      .expect(204);

    // The refresh token is dead…
    await request(app.getHttpServer())
      .post('/v1/admin/auth/refresh')
      .send({ refreshToken: session.refreshToken })
      .expect(401);

    // …the list is empty…
    const after = await request(app.getHttpServer())
      .get('/v1/admin/auth/sessions')
      .set('Authorization', `Bearer ${session.accessToken}`)
      .expect(200);
    expect(after.body.sessions).toHaveLength(0);

    // …and the self-service kill is itself audited (§20.4, rule 5).
    const auditRows = await db
      .select()
      .from(adminActions)
      .where(eq(adminActions.action, 'admin.session_revoke'));
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]!.adminId).toBe(admin.id);
    expect(auditRows[0]!.subjectId).toBe(admin.id);
  });

  it('cannot see or revoke another admin’s session — one indistinguishable 404', async () => {
    const victim = await seedAdmin(db, { subRole: 'operations', password: PASSWORD });
    const attacker = await seedAdmin(db, { subRole: 'operations', password: PASSWORD });
    const victimSession = await login(victim.email);

    const victimList = await request(app.getHttpServer())
      .get('/v1/admin/auth/sessions')
      .set('Authorization', `Bearer ${victimSession.accessToken}`)
      .expect(200);
    const victimSessionId = victimList.body.sessions[0].id;

    const attackerSession = await login(attacker.email);

    // The attacker's own list does not mention the victim's session at all.
    const attackerList = await request(app.getHttpServer())
      .get('/v1/admin/auth/sessions')
      .set('Authorization', `Bearer ${attackerSession.accessToken}`)
      .expect(200);
    expect(attackerList.body.sessions).toHaveLength(1);
    expect(attackerList.body.sessions[0].id).not.toBe(victimSessionId);

    // Revoking it is a 404 — the same answer a made-up id gets, so the route
    // cannot be used to probe whether another admin's session exists.
    await request(app.getHttpServer())
      .delete(`/v1/admin/auth/sessions/${victimSessionId}`)
      .set('Authorization', `Bearer ${attackerSession.accessToken}`)
      .expect(404);

    await request(app.getHttpServer())
      .delete(`/v1/admin/auth/sessions/00000000-0000-4000-8000-000000000000`)
      .set('Authorization', `Bearer ${attackerSession.accessToken}`)
      .expect(404);

    // The victim's session survives both attempts.
    await request(app.getHttpServer())
      .post('/v1/admin/auth/refresh')
      .send({ refreshToken: victimSession.refreshToken })
      .expect(200);
  });

  it('is closed to other realms and to no token at all', async () => {
    const fleet = await seedFleet(db, 'Sessions Fleet');
    const fleetAuth = await authHeaderFor(app, { userId: fleet.ownerId, fleetId: fleet.fleetId });

    await request(app.getHttpServer())
      .get('/v1/admin/auth/sessions')
      .set('Authorization', fleetAuth)
      .expect(403);

    await request(app.getHttpServer()).get('/v1/admin/auth/sessions').expect(401);
  });
});
