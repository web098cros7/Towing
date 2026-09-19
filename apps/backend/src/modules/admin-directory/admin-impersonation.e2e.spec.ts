import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  adminAppViewAddressesResponseSchema,
  adminAppViewNotificationsResponseSchema,
  adminAppViewTripsResponseSchema,
  adminAppViewVehiclesResponseSchema,
  adminAppViewWalletResponseSchema,
  adminImpersonationResponseSchema,
} from '@towing/api-contracts';
import { and, desc, eq, gt, isNull } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../../app.module';
import { adminActions, bookings, impersonationSessions } from '../../db/schema';
import { AdminOpsBroadcasterService } from '../../realtime/admin-ops-broadcaster.service';
import { adminAuthHeaderFor, authHeaderFor, customerAuthHeaderFor } from '../../test/app';
import { expectMatchesContract } from '../../test/contracts';
import {
  seedAdmin,
  seedCustomer,
  seedFleet,
  setupTestDatabase,
  truncateAll,
  type TestDatabase,
} from '../../test/db';
import { seedBooking } from '../../test/fixtures';
import { closeTestRedis, flushTestRedis } from '../../test/redis';

/**
 * W6 / G8 — read-only impersonation (§9.4.4).
 *
 * The invariants this pins, in order of how much they cost when broken:
 * 1. NO CREDENTIAL IS EVER MINTED — no app-view response carries a token, and
 *    the session query parameter authorises nothing on its own (the probe at
 *    the bottom: a write route plus a session and no Authorization is a 401).
 * 2. Every read is audited against its session, one row per section.
 * 3. Ended and expired sessions are refused, and a session belongs to exactly
 *    one admin and one subject.
 */
describe('admin impersonation (W6)', () => {
  let app: INestApplication;
  let db: TestDatabase;
  let opsToken: string;
  let opsId: string;
  let supportToken: string;
  let financeToken: string;

  beforeAll(async () => {
    db = await setupTestDatabase();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AdminOpsBroadcasterService)
      .useValue({ onModuleInit: () => undefined, onModuleDestroy: () => undefined })
      .compile();

    const instance = moduleRef.createNestApplication({ logger: false, rawBody: true });
    instance.setGlobalPrefix('v1');
    await instance.init();
    app = instance;
  });

  afterAll(async () => {
    await app.close();
    await closeTestRedis();
  });

  beforeEach(async () => {
    await truncateAll();
    await flushTestRedis();
    const ops = await seedAdmin(db, { subRole: 'operations' });
    opsId = ops.id;
    opsToken = await adminAuthHeaderFor(app, { adminId: ops.id, subRole: 'operations' });
    const support = await seedAdmin(db, { subRole: 'support' });
    supportToken = await adminAuthHeaderFor(app, { adminId: support.id, subRole: 'support' });
    const finance = await seedAdmin(db, { subRole: 'finance' });
    financeToken = await adminAuthHeaderFor(app, { adminId: finance.id, subRole: 'finance' });
  });

  /** A customer with one trip, one vehicle, one address — the five sections. */
  async function seededCustomer(): Promise<string> {
    const userId = await seedCustomer(db);
    await seedBooking(db, { userId, status: 'paid' });
    const customerToken = await customerAuthHeaderFor(app, { userId });
    await request(app.getHttpServer())
      .post('/v1/me/vehicles')
      .set('Authorization', customerToken)
      .send({ type: 'sedan', makeModel: 'Honda City' })
      .expect(201);
    await request(app.getHttpServer())
      .post('/v1/me/addresses')
      .set('Authorization', customerToken)
      .send({ fullAddress: '12 MG Road, Bengaluru', lat: 12.97, lng: 77.59 })
      .expect(201);
    return userId;
  }

  async function startImpersonation(userId: string, token = opsToken): Promise<string> {
    const res = await request(app.getHttpServer())
      .post(`/v1/admin/users/${userId}/impersonate`)
      .set('Authorization', token)
      .send({ reason: 'Investigating a support ticket' })
      .expect(200);
    expectMatchesContract(adminImpersonationResponseSchema, res.body);
    return res.body.session.id as string;
  }

  it('starts a session with an audit row, and reuses it on a second start', async () => {
    const userId = await seededCustomer();
    const sessionId = await startImpersonation(userId);

    const [row] = await db
      .select()
      .from(impersonationSessions)
      .where(eq(impersonationSessions.id, sessionId));
    expect(row).toBeDefined();
    expect(row!.adminId).toBe(opsId);
    expect(row!.subjectId).toBe(userId);
    expect(row!.endedAt).toBeNull();
    expect(row!.expiresAt.getTime()).toBeGreaterThan(Date.now());

    const [startAudit] = await db
      .select()
      .from(adminActions)
      .where(eq(adminActions.action, 'impersonate.start'))
      .orderBy(desc(adminActions.createdAt))
      .limit(1);
    expect(startAudit!.reason).toBe('Investigating a support ticket');

    // A reload reuses the open session: same id, still one audit row.
    const again = await startImpersonation(userId);
    expect(again).toBe(sessionId);
    const starts = await db
      .select()
      .from(adminActions)
      .where(eq(adminActions.action, 'impersonate.start'));
    expect(starts).toHaveLength(1);
  });

  it('requires a reason to start', async () => {
    const userId = await seededCustomer();
    await request(app.getHttpServer())
      .post(`/v1/admin/users/${userId}/impersonate`)
      .set('Authorization', opsToken)
      .send({})
      .expect(422);
  });

  it('serves all five app-view sections, audited per section, with no credential anywhere', async () => {
    const userId = await seededCustomer();
    const sessionId = await startImpersonation(userId);

    const trips = await request(app.getHttpServer())
      .get(`/v1/admin/users/${userId}/app-view/trips?session=${sessionId}`)
      .set('Authorization', opsToken)
      .expect(200);
    expectMatchesContract(adminAppViewTripsResponseSchema, trips.body);
    expect(trips.body.items).toHaveLength(1);

    const wallet = await request(app.getHttpServer())
      .get(`/v1/admin/users/${userId}/app-view/wallet?session=${sessionId}`)
      .set('Authorization', opsToken)
      .expect(200);
    expectMatchesContract(adminAppViewWalletResponseSchema, wallet.body);
    expect(wallet.body.wallet.balancePaise).toBe(0);

    const notifications = await request(app.getHttpServer())
      .get(`/v1/admin/users/${userId}/app-view/notifications?session=${sessionId}`)
      .set('Authorization', opsToken)
      .expect(200);
    expectMatchesContract(adminAppViewNotificationsResponseSchema, notifications.body);

    const vehicles = await request(app.getHttpServer())
      .get(`/v1/admin/users/${userId}/app-view/vehicles?session=${sessionId}`)
      .set('Authorization', opsToken)
      .expect(200);
    expectMatchesContract(adminAppViewVehiclesResponseSchema, vehicles.body);
    expect(vehicles.body.items).toHaveLength(1);

    const addresses = await request(app.getHttpServer())
      .get(`/v1/admin/users/${userId}/app-view/addresses?session=${sessionId}`)
      .set('Authorization', opsToken)
      .expect(200);
    expectMatchesContract(adminAppViewAddressesResponseSchema, addresses.body);
    expect(addresses.body.items).toHaveLength(1);

    // One audit row per section, each naming the session.
    const reads = await db
      .select()
      .from(adminActions)
      .where(eq(adminActions.action, 'impersonate.read'));
    expect(reads.map((row) => (row.after as { section: string }).section).sort()).toEqual([
      'addresses',
      'notifications',
      'trips',
      'vehicles',
      'wallet',
    ]);
    for (const read of reads) {
      expect((read.after as { sessionId: string }).sessionId).toBe(sessionId);
    }

    // The rule that makes the whole design worth it: NO credential is minted.
    for (const body of [trips.body, wallet.body, notifications.body, vehicles.body, addresses.body]) {
      expect(body).not.toHaveProperty('accessToken');
      expect(body).not.toHaveProperty('refreshToken');
      expect(body).not.toHaveProperty('token');
    }
    const [sessionRow] = await db
      .select()
      .from(impersonationSessions)
      .where(eq(impersonationSessions.id, sessionId));
    expect(sessionRow!.endedAt).toBeNull();
  });

  it('refuses an ended session, ending idempotently', async () => {
    const userId = await seededCustomer();
    const sessionId = await startImpersonation(userId);

    const ended = await request(app.getHttpServer())
      .post(`/v1/admin/users/${userId}/impersonate/end`)
      .set('Authorization', opsToken)
      .send({ session: sessionId })
      .expect(200);
    expect(ended.body.session.endedAt).not.toBeNull();

    await request(app.getHttpServer())
      .get(`/v1/admin/users/${userId}/app-view/trips?session=${sessionId}`)
      .set('Authorization', opsToken)
      .expect(403);

    // Ending twice is a no-op with one audit row.
    await request(app.getHttpServer())
      .post(`/v1/admin/users/${userId}/impersonate/end`)
      .set('Authorization', opsToken)
      .send({ session: sessionId })
      .expect(200);
    const ends = await db
      .select()
      .from(adminActions)
      .where(eq(adminActions.action, 'impersonate.end'));
    expect(ends).toHaveLength(1);
  });

  it('refuses an expired session', async () => {
    const userId = await seededCustomer();
    const sessionId = await startImpersonation(userId);
    await db
      .update(impersonationSessions)
      .set({ expiresAt: new Date(Date.now() - 60_000) })
      .where(eq(impersonationSessions.id, sessionId));

    const res = await request(app.getHttpServer())
      .get(`/v1/admin/users/${userId}/app-view/wallet?session=${sessionId}`)
      .set('Authorization', opsToken)
      .expect(403);
    expect(res.body.error.message).toMatch(/expired/i);
  });

  it('binds a session to one admin and one subject', async () => {
    const subject = await seededCustomer();
    const otherUser = await seedCustomer(db);
    const sessionId = await startImpersonation(subject);

    // Same admin, different subject: not found.
    await request(app.getHttpServer())
      .get(`/v1/admin/users/${otherUser}/app-view/trips?session=${sessionId}`)
      .set('Authorization', opsToken)
      .expect(404);

    // Different admin, same subject: not found.
    const otherOps = await seedAdmin(db, { subRole: 'operations' });
    const otherToken = await adminAuthHeaderFor(app, {
      adminId: otherOps.id,
      subRole: 'operations',
    });
    await request(app.getHttpServer())
      .get(`/v1/admin/users/${subject}/app-view/trips?session=${sessionId}`)
      .set('Authorization', otherToken)
      .expect(404);

    // Unknown session id: not found. Missing session: unprocessable.
    await request(app.getHttpServer())
      .get(`/v1/admin/users/${subject}/app-view/trips?session=${randomUUID()}`)
      .set('Authorization', opsToken)
      .expect(404);
    await request(app.getHttpServer())
      .get(`/v1/admin/users/${subject}/app-view/trips`)
      .set('Authorization', opsToken)
      .expect(422);
  });

  it('enforces the role matrix, and the session is never a credential', async () => {
    const userId = await seededCustomer();
    const sessionId = await startImpersonation(userId);

    // support holds impersonate.read; finance does not; fleet/anon are refused.
    const supportSession = await startImpersonation(userId, supportToken);
    expect(supportSession).toBeTruthy();
    await request(app.getHttpServer())
      .get(`/v1/admin/users/${userId}/app-view/trips?session=${supportSession}`)
      .set('Authorization', supportToken)
      .expect(200);

    await request(app.getHttpServer())
      .post(`/v1/admin/users/${userId}/impersonate`)
      .set('Authorization', financeToken)
      .send({ reason: 'Finance may not do this' })
      .expect(403);

    const fleet = await seedFleet(db, 'Impersonation Fleet');
    const fleetToken = await authHeaderFor(app, { userId: fleet.ownerId, fleetId: fleet.fleetId });
    await request(app.getHttpServer())
      .get(`/v1/admin/users/${userId}/app-view/trips?session=${sessionId}`)
      .set('Authorization', fleetToken)
      .expect(403);
    await request(app.getHttpServer())
      .get(`/v1/admin/users/${userId}/app-view/trips?session=${sessionId}`)
      .expect(401);

    // THE PROBE: a valid session id is not an authorization. A write route
    // handed the session and nothing else is still a 401.
    await request(app.getHttpServer())
      .post(`/v1/bookings?session=${sessionId}`)
      .send({})
      .expect(401);

    // Sanity: no write row could have checked the session — there is no row.
    const remaining = await db
      .select()
      .from(impersonationSessions)
      .where(and(eq(impersonationSessions.id, sessionId), isNull(impersonationSessions.endedAt), gt(impersonationSessions.expiresAt, new Date())));
    expect(remaining).toHaveLength(1);
  });

  it('registers the app-view tree GET-only', () => {
    // The walk collects GETs; a write smuggled under `app-view/` would be
    // invisible there. This reads the router itself: every layer whose path
    // touches app-view must be a GET, or the read-only claim is a comment.
    const instance = app.getHttpAdapter().getInstance() as {
      router?: {
        stack?: Array<{ route?: { path?: string; methods?: Record<string, boolean> } }>;
      };
    };
    const layers = instance.router?.stack ?? [];
    const appViewRoutes = layers.flatMap((layer) =>
      layer.route?.path?.includes('app-view') ? [layer.route] : [],
    );
    expect(appViewRoutes.length).toBeGreaterThanOrEqual(5);
    for (const route of appViewRoutes) {
      expect(Object.keys(route.methods ?? {})).toEqual(['get']);
    }
  });
});
