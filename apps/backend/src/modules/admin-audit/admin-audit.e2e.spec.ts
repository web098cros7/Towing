import type { INestApplication } from '@nestjs/common';
import { adminAuditDetailSchema, adminAuditListResponseSchema } from '@towing/api-contracts';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { adminActions } from '../../db/schema';
import { adminAuthHeaderFor, authHeaderFor, createTestApp } from '../../test/app';
import { expectMatchesContract } from '../../test/contracts';
import { seedAdmin, seedFleet, setupTestDatabase, truncateAll, type TestDatabase } from '../../test/db';
import { closeTestRedis, flushTestRedis } from '../../test/redis';

/**
 * W1 §3.5 — the audit viewer.
 *
 * Visibility is the interesting half: every sub-role may REACH the route
 * (`audit.read` is in all four lists), and this spec pins the endpoint-level
 * limitation — own rows, plus rows on subjects you may read, or everything for
 * a super admin. The 404-not-403 rule on detail is asserted here too, because
 * "does this admin action exist" is itself something the trail should not leak.
 */
describe('admin audit viewer (/v1/admin/audit, §3.5)', () => {
  let app: INestApplication;
  let db: TestDatabase;

  // Fixed instants, spaced a minute apart: key ordering is by (created_at, id),
  // so a spec that used `now()` per row would order by timing luck.
  const T0 = new Date('2026-09-01T10:00:00.000Z');
  const T1 = new Date('2026-09-01T10:01:00.000Z');
  const T2 = new Date('2026-09-01T10:02:00.000Z');
  const T3 = new Date('2026-09-01T10:03:00.000Z');

  let superAuth: string;
  let opsAuth: string;
  let supportAuth: string;
  let financeAuth: string;
  let driverId1: string;
  let driverId2: string;
  let payoutId: string;
  let opsId: string;
  let supportId: string;
  let kycApproveId: string;
  let kycRejectId: string;

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

    const superAdmin = await seedAdmin(db, { subRole: 'super_admin' });
    const ops = await seedAdmin(db, { subRole: 'operations' });
    const support = await seedAdmin(db, { subRole: 'support' });
    const finance = await seedAdmin(db, { subRole: 'finance' });
    opsId = ops.id;
    supportId = support.id;

    superAuth = await adminAuthHeaderFor(app, { adminId: superAdmin.id, subRole: 'super_admin' });
    opsAuth = await adminAuthHeaderFor(app, { adminId: ops.id, subRole: 'operations' });
    supportAuth = await adminAuthHeaderFor(app, { adminId: support.id, subRole: 'support' });
    financeAuth = await adminAuthHeaderFor(app, { adminId: finance.id, subRole: 'finance' });

    driverId1 = '11111111-1111-4111-8111-111111111111';
    driverId2 = '22222222-2222-4222-8222-222222222222';
    payoutId = '33333333-3333-4333-8333-333333333333';

    const inserted = await db
      .insert(adminActions)
      .values([
        {
          adminId: ops.id,
          action: 'driver.kyc.approve',
          subjectType: 'driver',
          subjectId: driverId1,
          before: { kycStatus: 'pending' },
          after: { kycStatus: 'approved' },
          reason: 'documents in order',
          ip: '10.0.0.1',
          createdAt: T0,
        },
        {
          adminId: ops.id,
          action: 'driver.kyc.reject',
          subjectType: 'driver',
          subjectId: driverId2,
          before: { kycStatus: 'pending' },
          after: { kycStatus: 'rejected' },
          createdAt: T1,
        },
        {
          adminId: finance.id,
          action: 'payout.approve',
          subjectType: 'payout',
          subjectId: payoutId,
          before: { approvalState: 'pending_approval' },
          after: { approvalState: 'approved' },
          createdAt: T2,
        },
        {
          adminId: support.id,
          action: 'admin.session_revoke',
          subjectType: 'admin',
          subjectId: support.id,
          createdAt: T3,
        },
      ])
      .returning({ id: adminActions.id, action: adminActions.action });

    kycApproveId = inserted.find((row) => row.action === 'driver.kyc.approve')!.id;
    kycRejectId = inserted.find((row) => row.action === 'driver.kyc.reject')!.id;
  });

  it('shows a super admin every row, newest first, matching the contract', async () => {
    const res = await request(app.getHttpServer())
      .get('/v1/admin/audit')
      .set('Authorization', superAuth)
      .expect(200);

    const body = expectMatchesContract(adminAuditListResponseSchema, res.body);
    expect(body.entries.map((entry) => entry.action)).toEqual([
      'admin.session_revoke',
      'payout.approve',
      'driver.kyc.reject',
      'driver.kyc.approve',
    ]);
    expect(body.nextCursor).toBeNull();
  });

  it('paginates with an opaque keyset cursor — no gaps, no repeats', async () => {
    const first = await request(app.getHttpServer())
      .get('/v1/admin/audit')
      .query({ limit: 2 })
      .set('Authorization', superAuth)
      .expect(200);

    expect(first.body.entries).toHaveLength(2);
    expect(first.body.nextCursor).toBeTruthy();

    const second = await request(app.getHttpServer())
      .get('/v1/admin/audit')
      .query({ limit: 2, cursor: first.body.nextCursor })
      .set('Authorization', superAuth)
      .expect(200);

    expect(second.body.entries).toHaveLength(2);
    expect(second.body.nextCursor).toBeNull();

    const ids = [...first.body.entries, ...second.body.entries].map((entry: { id: string }) => entry.id);
    expect(new Set(ids).size).toBe(4);

    // A malformed cursor is a 422, never a silent restart at page one.
    const bad = await request(app.getHttpServer())
      .get('/v1/admin/audit')
      .query({ cursor: 'not-a-cursor' })
      .set('Authorization', superAuth)
      .expect(422);
    expect(bad.body.error.code).toBe('validation_failed');
  });

  it('narrows a non-super admin to their OWN rows when unscoped', async () => {
    const res = await request(app.getHttpServer())
      .get('/v1/admin/audit')
      .set('Authorization', opsAuth)
      .expect(200);

    expect(res.body.entries.map((entry: { action: string }) => entry.action)).toEqual([
      'driver.kyc.reject',
      'driver.kyc.approve',
    ]);
  });

  it('unlocks subject rows only through the subject’s own read permission', async () => {
    // Support holds `user.read`, so the driver's audit timeline is readable
    // even though ops wrote the rows.
    const scoped = await request(app.getHttpServer())
      .get('/v1/admin/audit')
      .query({ subjectType: 'driver', subjectId: driverId1 })
      .set('Authorization', supportAuth)
      .expect(200);

    expect(scoped.body.entries.map((entry: { id: string }) => entry.id)).toContain(kycApproveId);

    // Ops does NOT hold `finance.read`, so the payout's timeline stays closed…
    const payout = await request(app.getHttpServer())
      .get('/v1/admin/audit')
      .query({ subjectType: 'payout', subjectId: payoutId })
      .set('Authorization', opsAuth)
      .expect(200);
    expect(payout.body.entries).toEqual([]);

    // …and finance does hold it.
    const payoutForFinance = await request(app.getHttpServer())
      .get('/v1/admin/audit')
      .query({ subjectType: 'payout', subjectId: payoutId })
      .set('Authorization', financeAuth)
      .expect(200);
    expect(payoutForFinance.body.entries).toHaveLength(1);
  });

  it('filters by action prefix, actor, subject and window', async () => {
    const prefix = await request(app.getHttpServer())
      .get('/v1/admin/audit')
      .query({ action: 'driver.kyc' })
      .set('Authorization', superAuth)
      .expect(200);
    expect(prefix.body.entries).toHaveLength(2);

    const byActor = await request(app.getHttpServer())
      .get('/v1/admin/audit')
      .query({ adminId: opsId })
      .set('Authorization', superAuth)
      .expect(200);
    expect(byActor.body.entries.map((entry: { id: string }) => entry.id)).toEqual([
      kycRejectId,
      kycApproveId,
    ]);

    const bySubject = await request(app.getHttpServer())
      .get('/v1/admin/audit')
      .query({ subjectType: 'driver', subjectId: driverId2 })
      .set('Authorization', superAuth)
      .expect(200);
    expect(bySubject.body.entries.map((entry: { id: string }) => entry.id)).toEqual([kycRejectId]);

    const windowed = await request(app.getHttpServer())
      .get('/v1/admin/audit')
      .query({ from: T1.toISOString(), to: T2.toISOString() })
      .set('Authorization', superAuth)
      .expect(200);
    expect(windowed.body.entries.map((entry: { action: string }) => entry.action)).toEqual([
      'payout.approve',
      'driver.kyc.reject',
    ]);
  });

  it('returns before/after on detail — and a 404 for rows the viewer may not read', async () => {
    const detail = await request(app.getHttpServer())
      .get(`/v1/admin/audit/${kycApproveId}`)
      .set('Authorization', superAuth)
      .expect(200);

    const body = expectMatchesContract(adminAuditDetailSchema, detail.body);
    expect(body.before).toEqual({ kycStatus: 'pending' });
    expect(body.after).toEqual({ kycStatus: 'approved' });

    // Support may read driver subjects → 200 on the same row.
    await request(app.getHttpServer())
      .get(`/v1/admin/audit/${kycApproveId}`)
      .set('Authorization', supportAuth)
      .expect(200);

    // Finance may NOT read admin subjects (`admin.manage` is super-admin
    // only) and did not write the session_revoke row → indistinguishable 404.
    const revoked = await db
      .select({ id: adminActions.id })
      .from(adminActions)
      .where(eq(adminActions.action, 'admin.session_revoke'));
    await request(app.getHttpServer())
      .get(`/v1/admin/audit/${revoked[0]!.id}`)
      .set('Authorization', financeAuth)
      .expect(404);
  });

  it('is closed to other realms and to no token at all', async () => {
    const fleet = await seedFleet(db, 'Audit Fleet');
    const fleetAuth = await authHeaderFor(app, { userId: fleet.ownerId, fleetId: fleet.fleetId });

    await request(app.getHttpServer())
      .get('/v1/admin/audit')
      .set('Authorization', fleetAuth)
      .expect(403);

    await request(app.getHttpServer()).get('/v1/admin/audit').expect(401);
  });
});
