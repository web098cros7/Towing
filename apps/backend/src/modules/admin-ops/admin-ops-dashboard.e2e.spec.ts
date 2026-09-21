import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  adminOpsActivityResponseSchema,
  adminOpsBadgesResponseSchema,
  adminOpsDashboardResponseSchema,
} from '@towing/api-contracts';
import { eq, inArray } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../../app.module';
import {
  adminActions,
  bookingStatusHistory,
  bookings,
  deletionRequests,
  dispatchAttempts,
  drivers,
  payouts,
  serviceZones,
  sosAlerts,
} from '../../db/schema';
import { adminOpsActivityKey, driverGeoKey } from '../../redis/redis.constants';
import { AdminOpsBroadcasterService } from '../../realtime/admin-ops-broadcaster.service';
import { adminAuthHeaderFor, authHeaderFor } from '../../test/app';
import {
  seedAdmin,
  seedCustomer,
  seedDriver,
  seedFleet,
  setupTestDatabase,
  truncateAll,
  type TestDatabase,
} from '../../test/db';
import { seedBooking } from '../../test/fixtures';
import { closeTestRedis, flushTestRedis, testRedis } from '../../test/redis';

/**
 * W3 — `GET /v1/admin/ops/{dashboard,activity,badges}` (§9.4.2, §3.2).
 *
 * The dashboard's whole reason to exist is numbers that match reality, so every
 * assertion here is an EXACT number against a hand-built day: 2 paid, 1
 * cancelled-while-searching, 1 no-drivers, 1 live search, 1 dormant scheduled
 * booking, one online driver and one stale one. Fill rate is asserted at 50 %
 * from those four resolutions — it is the KPI everybody gets wrong (a
 * still-searching booking must count on neither side), and the second test
 * proves the other half: a cancellation AFTER assignment counts as matched.
 *
 * The KPI broadcaster is replaced with an inert stub IN THIS FILE ONLY: its 10 s
 * tick can cache a partially-seeded day between `truncateAll` and the seeds,
 * which would make exact-value assertions flaky. Its own behaviour — the
 * `ops:metrics`/`ops:badges` frames and the activity append — is covered
 * end-to-end in `admin-ops-broadcaster.e2e.spec.ts`.
 */
describe('admin ops dashboard (W3)', () => {
  let app: INestApplication;
  let db: TestDatabase;

  async function createKpiApp(): Promise<INestApplication> {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AdminOpsBroadcasterService)
      .useValue({ onModuleInit: () => undefined, onModuleDestroy: () => undefined })
      .compile();

    const instance = moduleRef.createNestApplication({ logger: false, rawBody: true });
    instance.setGlobalPrefix('v1');
    await instance.init();
    return instance;
  }

  beforeAll(async () => {
    db = await setupTestDatabase();
    app = await createKpiApp();
  });

  afterAll(async () => {
    await app.close();
    await closeTestRedis();
  });

  beforeEach(async () => {
    await truncateAll();
    await flushTestRedis();
  });

  async function get(path: string, token: string): Promise<Record<string, unknown>> {
    const res = await request(app.getHttpServer()).get(path).set('Authorization', token);
    if (res.status !== 200) {
      // Surfacing the envelope makes a 500 debuggable without an app logger.
      throw new Error(`GET ${path} → ${res.status}: ${JSON.stringify(res.body)}`);
    }
    return res.body as Record<string, unknown>;
  }

  it('computes every KPI exactly against a hand-checked seeded day', async () => {
    const admin = await seedAdmin(db, { subRole: 'operations' });
    const token = await adminAuthHeaderFor(app, { adminId: admin.id, subRole: 'operations' });

    // Drivers: one fresh, one stale (outside the 60 s window), one pending KYC.
    const onlineDriver = await seedDriver(db, { name: 'Online Driver' });
    await db
      .update(drivers)
      .set({ isOnline: true, lastPingAt: new Date(Date.now() - 10_000) })
      .where(eq(drivers.id, onlineDriver));
    const staleDriver = await seedDriver(db, { name: 'Stale Driver' });
    await db
      .update(drivers)
      .set({ isOnline: true, lastPingAt: new Date(Date.now() - 5 * 60_000) })
      .where(eq(drivers.id, staleDriver));
    await seedDriver(db, { kycStatus: 'pending', name: 'Pending Driver' });

    // An active zone plus one dispatchable member — the Redis sub-count.
    const [zone] = await db
      .insert(serviceZones)
      .values({
        name: 'KPI Zone',
        area: 'SRID=4326;POLYGON((77.45 12.80,77.80 12.80,77.80 13.15,77.45 13.15,77.45 12.80))',
        surgeBand: 'standard',
      })
      .returning({ id: serviceZones.id });
    await testRedis().geoadd(driverGeoKey(zone!.id), 77.5946, 12.9716, onlineDriver);

    // 2 paid, created 2 minutes ago so the accepted-attempt delta is provable.
    const paidA = await seedBooking(db, {
      userId: await seedCustomer(db),
      status: 'paid',
      driverId: onlineDriver,
      total: '100.00',
      commissionAmount: '20.00',
      createdAt: new Date(Date.now() - 120_000),
    });
    const paidB = await seedBooking(db, {
      userId: await seedCustomer(db),
      status: 'paid',
      driverId: onlineDriver,
      total: '250.00',
      commissionAmount: '50.00',
    });
    await db
      .update(bookings)
      .set({ paidAt: new Date() })
      .where(inArray(bookings.id, [paidA, paidB]));

    // 1 cancelled WHILE SEARCHING — no `assigned` in history, so it lands in the
    // denominator's third term rather than in `matched`.
    const cancelled = await seedBooking(db, {
      userId: await seedCustomer(db),
      status: 'cancelled',
    });
    // 1 no-drivers.
    const noDrivers = await seedBooking(db, {
      userId: await seedCustomer(db),
      status: 'no_drivers_found',
    });
    // 1 live search — counts on neither side of the fill rate.
    const searching = await seedBooking(db, {
      userId: await seedCustomer(db),
      status: 'searching',
    });
    // 1 dormant scheduled booking — sits in `searching` but must not count as one.
    const scheduled = await seedBooking(db, {
      userId: await seedCustomer(db),
      status: 'searching',
    });
    await db
      .update(bookings)
      .set({ scheduledAt: new Date(Date.now() + 3_600_000) })
      .where(eq(bookings.id, scheduled));

    await db.insert(bookingStatusHistory).values([
      { bookingId: paidA, status: 'searching' },
      { bookingId: paidA, status: 'assigned' },
      { bookingId: paidB, status: 'searching' },
      { bookingId: paidB, status: 'assigned' },
      { bookingId: cancelled, status: 'searching' },
      { bookingId: cancelled, status: 'cancelled' },
      { bookingId: noDrivers, status: 'searching' },
      { bookingId: noDrivers, status: 'no_drivers_found' },
      { bookingId: searching, status: 'searching' },
      { bookingId: scheduled, status: 'searching' },
    ]);

    // The one accepted offer: 60 s after creation.
    await db.insert(dispatchAttempts).values({
      bookingId: paidA,
      wave: 1,
      radiusKm: '2.00',
      driverId: onlineDriver,
      outcome: 'accepted',
      respondedAt: new Date(Date.now() - 60_000),
    });

    await db.insert(payouts).values({
      ownerId: onlineDriver,
      ownerType: 'driver',
      amount: '500.00',
      status: 'requested',
      approvalState: 'pending_approval',
      idempotencyKey: `kpi-day-payout-${randomUUID()}`,
      provider: 'dev',
    });
    await db.insert(deletionRequests).values({
      subjectId: await seedCustomer(db),
      subjectType: 'user',
      status: 'requested',
    });

    const body = await get('/v1/admin/ops/dashboard', token);

    // Every value exact — the whole point of hand-seeding the day.
    expect(adminOpsDashboardResponseSchema.parse(body)).toMatchObject({
      kpis: {
        activeRides: 0,
        searching: 1,
        onlineDrivers: 1,
        dispatchableNow: 1,
        todayGmvPaise: 35_000,
        todayCommissionPaise: 7_000,
        pendingKyc: 1,
        pendingPayouts: 1,
        // 2 matched ÷ (2 matched + 1 no-drivers + 1 cancelled-while-searching).
        fillRatePct: 50,
        cancelledToday: 1,
        completedUnpaid: 0,
        timeToMatchP50Seconds: 60,
        timeToMatchP90Seconds: 60,
      },
      degraded: false,
    });
  });

  it('counts a cancellation after assignment as matched, not as a search failure', async () => {
    const admin = await seedAdmin(db, { subRole: 'operations' });
    const token = await adminAuthHeaderFor(app, { adminId: admin.id, subRole: 'operations' });

    const bookingId = await seedBooking(db, {
      userId: await seedCustomer(db),
      status: 'cancelled',
    });
    await db.insert(bookingStatusHistory).values([
      { bookingId, status: 'searching' },
      { bookingId, status: 'assigned' },
      { bookingId, status: 'cancelled' },
    ]);

    const body = await get('/v1/admin/ops/dashboard', token);
    const kpis = (body.kpis ?? {}) as Record<string, unknown>;
    // matched 1, nothing else resolved → 100 %, and the cancellation is still a
    // cancellation for the other tile.
    expect(kpis.fillRatePct).toBe(100);
    expect(kpis.cancelledToday).toBe(1);
  });

  it('refuses the ops surface to every other role and realm (§4.2, `ops.live`)', async () => {
    const operations = await seedAdmin(db, { subRole: 'operations' });
    const support = await seedAdmin(db, { subRole: 'support' });
    const finance = await seedAdmin(db, { subRole: 'finance' });
    const fleet = await seedFleet(db, 'RBAC Fleet');

    const operationsToken = await adminAuthHeaderFor(app, {
      adminId: operations.id,
      subRole: 'operations',
    });
    const supportToken = await adminAuthHeaderFor(app, { adminId: support.id, subRole: 'support' });
    const financeToken = await adminAuthHeaderFor(app, { adminId: finance.id, subRole: 'finance' });
    const fleetToken = await authHeaderFor(app, {
      userId: fleet.ownerId,
      fleetId: fleet.fleetId,
    });

    for (const path of [
      '/v1/admin/ops/dashboard',
      '/v1/admin/ops/activity',
      '/v1/admin/ops/badges',
      '/v1/admin/ops/live',
    ]) {
      await request(app.getHttpServer()).get(path).expect(401);
      await request(app.getHttpServer()).get(path).set('Authorization', fleetToken).expect(403);
      await request(app.getHttpServer()).get(path).set('Authorization', financeToken).expect(403);
      await request(app.getHttpServer()).get(path).set('Authorization', supportToken).expect(200);
      await request(app.getHttpServer())
        .get(path)
        .set('Authorization', operationsToken)
        .expect(200);
    }
  });

  it('reports badge counts from every source that exists, zero only where no table does', async () => {
    const admin = await seedAdmin(db, { subRole: 'operations' });
    const token = await adminAuthHeaderFor(app, { adminId: admin.id, subRole: 'operations' });

    const driver = await seedDriver(db, { kycStatus: 'pending' });
    await db.insert(payouts).values({
      ownerId: driver,
      ownerType: 'driver',
      amount: '100.00',
      status: 'requested',
      approvalState: 'pending_approval',
      idempotencyKey: `badge-payout-${randomUUID()}`,
      provider: 'dev',
    });
    await db.insert(deletionRequests).values({
      subjectId: await seedCustomer(db),
      subjectType: 'user',
      status: 'requested',
    });
    await db.insert(sosAlerts).values({
      subjectType: 'user',
      subjectId: await seedCustomer(db, 'Badge SOS'),
      lat: 12.97,
      lng: 77.59,
      source: 'app',
      status: 'triggered',
    });

    const body = await get('/v1/admin/ops/badges', token);
    expect(adminOpsBadgesResponseSchema.parse(body)).toMatchObject({
      badges: {
        pendingKyc: 1,
        pendingPayouts: 1,
        // W14's SOS badge is real now; W15's tickets are the last tableless
        // count, and this line is where that changes when tickets land.
        openSos: 1,
        openDisputes: 0,
        openTickets: 0,
        suspensionRequests: 0,
        deletionRequests: 1,
      },
    });
  });

  it('counts open SOS alerts and reports the acknowledge percentiles (W14)', async () => {
    const admin = await seedAdmin(db, { subRole: 'operations' });
    const token = await adminAuthHeaderFor(app, { adminId: admin.id, subRole: 'operations' });
    const customerId = await seedCustomer(db);

    const createdAt = new Date(Date.now() - 60 * 60_000);
    const ackedAt = (seconds: number) => new Date(createdAt.getTime() + seconds * 1_000);

    await db.insert(sosAlerts).values([
      // Two acknowledged samples: 10 s and 30 s → p50 exactly 20 s.
      {
        subjectType: 'user',
        subjectId: customerId,
        lat: 12.97,
        lng: 77.59,
        source: 'app',
        status: 'acknowledged',
        acknowledgedBy: admin.id,
        acknowledgedAt: ackedAt(10),
        createdAt,
      },
      {
        subjectType: 'user',
        subjectId: await seedCustomer(db, 'Second'),
        lat: 12.97,
        lng: 77.59,
        source: 'ops',
        status: 'acknowledged',
        acknowledgedBy: admin.id,
        acknowledgedAt: ackedAt(30),
        createdAt,
      },
      // One still open — the badge, the KPI's `open`, and none of the samples.
      {
        subjectType: 'driver',
        subjectId: await seedDriver(db),
        lat: 12.97,
        lng: 77.59,
        source: 'app',
        status: 'triggered',
        createdAt,
      },
    ]);

    const body = await get('/v1/admin/ops/dashboard', token);
    const parsed = adminOpsDashboardResponseSchema.parse(body);
    // "Open" is triggered + acknowledged — an acknowledged incident is still
    // an incident until somebody resolves it, which is the same set the
    // `openSos` badge and the console's default tab show.
    expect(parsed.kpis.sos.open).toBe(3);
    // percentile_cont(0.5) of {10, 30} = 20; percentile_cont(0.95) = 29.
    expect(parsed.kpis.sos.ackP50Seconds).toBe(20);
    expect(parsed.kpis.sos.ackP95Seconds).toBe(29);

    const badges = await get('/v1/admin/ops/badges', token);
    expect(adminOpsBadgesResponseSchema.parse(badges).badges.openSos).toBe(3);
  });

  it('serves the live activity list when it has entries and backfills from history otherwise', async () => {
    const admin = await seedAdmin(db, { subRole: 'operations' });
    const token = await adminAuthHeaderFor(app, { adminId: admin.id, subRole: 'operations' });

    const bookingId = await seedBooking(db, { userId: await seedCustomer(db), status: 'assigned' });
    await db.insert(bookingStatusHistory).values([
      { bookingId, status: 'searching' },
      { bookingId, status: 'assigned' },
    ]);
    await db.insert(adminActions).values({
      adminId: admin.id,
      action: 'driver.kyc.approve',
      subjectType: 'driver',
      subjectId: await seedDriver(db),
      reason: 'activity-feed seed',
    });

    // Redis list empty → the DB union answers, flagged as backfilled.
    const backfilled = adminOpsActivityResponseSchema.parse(
      await get('/v1/admin/ops/activity', token),
    );
    expect(backfilled.backfilled).toBe(true);
    expect(backfilled.items).toHaveLength(3);
    const kinds = backfilled.items.map((item) => item.kind).sort();
    expect(kinds).toEqual(['admin_action', 'booking_created', 'booking_status']);

    // Once the live list exists (as the bridge writes it), it wins. The probe
    // carries `sosStatus` because the bridge does since W14 — the reader
    // parses the list strictly, so a hand-rolled row must match the writer.
    await testRedis().lpush(
      adminOpsActivityKey,
      JSON.stringify({
        id: 'booking_status:live-probe:1',
        kind: 'booking_status',
        at: new Date().toISOString(),
        bookingId: randomUUID(),
        zoneId: null,
        status: 'assigned',
        sosStatus: null,
        scheduledAt: null,
        action: null,
        subjectType: null,
        subjectId: null,
        adminId: null,
      }),
    );

    const live = adminOpsActivityResponseSchema.parse(await get('/v1/admin/ops/activity', token));
    expect(live.backfilled).toBe(false);
    expect(live.items).toHaveLength(1);
    expect(live.items[0]?.id).toBe('booking_status:live-probe:1');
  });
});
