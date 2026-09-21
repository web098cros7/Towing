import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  adminDriverBookingsResponseSchema,
  adminDirectoryZonesResponseSchema,
  adminDriverDirectoryDetailSchema,
  adminDriverZonesResponseSchema,
  adminDriversDirectoryResponseSchema,
  adminPendingDriversResponseSchema,
} from '@towing/api-contracts';
import { desc, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../../app.module';
import { adminActions, drivers, serviceZones, suspensionRequests } from '../../db/schema';
import { AdminOpsBroadcasterService } from '../../realtime/admin-ops-broadcaster.service';
import { adminAuthHeaderFor, authHeaderFor } from '../../test/app';
import { expectMatchesContract } from '../../test/contracts';
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
import { closeTestRedis, flushTestRedis } from '../../test/redis';
import { seedPricingFixtures } from '../pricing/pricing.e2e.spec';

/**
 * W6 — the drivers directory (§9.4.4): search/detail/trips, A14's suspend
 * routes on the one suspension service, and §6.10's zone editor.
 *
 * Three things here are acceptance, not coverage:
 * - `GET /v1/admin/drivers/pending` still returns the KYC QUEUE even though a
 *   second `admin/drivers` controller now declares `:id` — registration order
 *   decides, and this pins it;
 * - support's suspend attempt 403s AND leaves a `driver`-subject request row
 *   that ops can approve through the generic inbox;
 * - a zone edit writes `driver_zone_restrictions`, audits the diff, and a
 *   same-set save is a no-op (no second audit row).
 */
describe('admin directory drivers (W6)', () => {
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
    await seedPricingFixtures(db);
    const ops = await seedAdmin(db, { subRole: 'operations' });
    opsId = ops.id;
    opsToken = await adminAuthHeaderFor(app, { adminId: ops.id, subRole: 'operations' });
    const support = await seedAdmin(db, { subRole: 'support' });
    supportToken = await adminAuthHeaderFor(app, { adminId: support.id, subRole: 'support' });
    const finance = await seedAdmin(db, { subRole: 'finance' });
    financeToken = await adminAuthHeaderFor(app, { adminId: finance.id, subRole: 'finance' });
  });

  async function namedDriver(name: string, options: { fleetId?: string } = {}): Promise<string> {
    return seedDriver(db, { name, ...options });
  }

  async function seedZone(name: string): Promise<string> {
    const [zone] = await db
      .insert(serviceZones)
      .values({
        name,
        area: 'SRID=4326;POLYGON((77.45 12.80,77.80 12.80,77.80 13.15,77.45 13.15,77.45 12.80))',
        surgeBand: 'standard',
      })
      .returning({ id: serviceZones.id });
    return zone!.id;
  }

  it('finds drivers by partial name, exact mobile and id prefix', async () => {
    const ravi = await namedDriver('Rajaraman Iyer');
    await namedDriver('Suresh Nair');
    const [row] = await db
      .select({ mobile: drivers.mobile })
      .from(drivers)
      .where(eq(drivers.id, ravi));

    const byName = await request(app.getHttpServer())
      .get('/v1/admin/drivers?q=raja')
      .set('Authorization', opsToken)
      .expect(200);
    expectMatchesContract(adminDriversDirectoryResponseSchema, byName.body);
    expect(byName.body.items.map((item: { id: string }) => item.id)).toEqual([ravi]);

    const byMobile = await request(app.getHttpServer())
      .get(`/v1/admin/drivers?q=${encodeURIComponent(row!.mobile)}`)
      .set('Authorization', opsToken)
      .expect(200);
    expect(byMobile.body.items.map((item: { id: string }) => item.id)).toEqual([ravi]);

    const byPrefix = await request(app.getHttpServer())
      .get(`/v1/admin/drivers?q=${ravi.slice(0, 8)}`)
      .set('Authorization', opsToken)
      .expect(200);
    expect(byPrefix.body.items.map((item: { id: string }) => item.id)).toEqual([ravi]);
  });

  it('filters by kyc status, online, fleet, class, long-distance and rating', async () => {
    const fleet = await seedFleet(db, 'Directory Fleet');
    const online = await namedDriver('Online Flatbed', { fleetId: fleet.fleetId });
    await db
      .update(drivers)
      .set({ isOnline: true, vehicleClass: 'flatbed', longDistanceEnabled: true, rating: '4.5' })
      .where(eq(drivers.id, online));
    const offline = await namedDriver('Offline Wheel', { fleetId: fleet.fleetId });
    await db
      .update(drivers)
      .set({ isOnline: false, vehicleClass: 'wheel_lift', longDistanceEnabled: false })
      .where(eq(drivers.id, offline));

    const onlineOnly = await request(app.getHttpServer())
      .get('/v1/admin/drivers?online=true')
      .set('Authorization', opsToken)
      .expect(200);
    expect(onlineOnly.body.items.map((item: { id: string }) => item.id)).toEqual([online]);

    const flatbedOnly = await request(app.getHttpServer())
      .get('/v1/admin/drivers?vehicleClass=flatbed&longDistance=true')
      .set('Authorization', opsToken)
      .expect(200);
    expect(flatbedOnly.body.items.map((item: { id: string }) => item.id)).toEqual([online]);

    const byFleet = await request(app.getHttpServer())
      .get(`/v1/admin/drivers?fleetId=${fleet.fleetId}`)
      .set('Authorization', opsToken)
      .expect(200);
    expect(byFleet.body.items.map((item: { id: string }) => item.id).sort()).toEqual(
      [online, offline].sort(),
    );

    const byRating = await request(app.getHttpServer())
      .get('/v1/admin/drivers?minRating=4')
      .set('Authorization', opsToken)
      .expect(200);
    expect(byRating.body.items.map((item: { id: string }) => item.id)).toEqual([online]);

    const pending = await request(app.getHttpServer())
      .get('/v1/admin/drivers?kycStatus=pending')
      .set('Authorization', opsToken)
      .expect(200);
    expect(pending.body.items).toEqual([]);

    // A boolean filter that is neither true nor false is a 422, not a guess
    // (the house's validation status — see ApiException.validation).
    await request(app.getHttpServer())
      .get('/v1/admin/drivers?online=1')
      .set('Authorization', opsToken)
      .expect(422);
  });

  it('lists zones for the directory pickers (C9)', async () => {
    const south = await seedZone('South Zone');
    await seedZone('North Zone');

    const res = await request(app.getHttpServer())
      .get('/v1/admin/directory/zones')
      .set('Authorization', opsToken)
      .expect(200);
    expectMatchesContract(adminDirectoryZonesResponseSchema, res.body);
    const ids = res.body.items.map((zone: { id: string }) => zone.id);
    expect(ids).toContain(south);
    expect(res.body.items.every((zone: { isActive: boolean }) => zone.isActive)).toBe(true);
  });

  it('keeps GET /v1/admin/drivers/pending on the KYC queue, not the :id route', async () => {
    // The regression the second `admin/drivers` controller could break:
    // `pending` must be matched by the module registered first.
    await seedDriver(db, { name: 'Queued Driver', kycStatus: 'pending' });

    const res = await request(app.getHttpServer())
      .get('/v1/admin/drivers/pending')
      .set('Authorization', opsToken)
      .expect(200);
    expectMatchesContract(adminPendingDriversResponseSchema, res.body);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].name).toBe('Queued Driver');
  });

  it('serves detail and trips, and 404s an unknown driver', async () => {
    const driverId = await namedDriver('Detail Driver');
    const userId = await seedCustomer(db);
    await seedBooking(db, { userId, driverId, status: 'paid' });

    const detail = await request(app.getHttpServer())
      .get(`/v1/admin/drivers/${driverId}`)
      .set('Authorization', opsToken)
      .expect(200);
    expectMatchesContract(adminDriverDirectoryDetailSchema, detail.body);
    expect(detail.body.bookingsCount).toBe(1);
    expect(detail.body.zoneRestrictions).toEqual([]);

    const trips = await request(app.getHttpServer())
      .get(`/v1/admin/drivers/${driverId}/bookings`)
      .set('Authorization', opsToken)
      .expect(200);
    expectMatchesContract(adminDriverBookingsResponseSchema, trips.body);
    expect(trips.body.total).toBe(1);

    await request(app.getHttpServer())
      .get(`/v1/admin/drivers/${randomUUID()}`)
      .set('Authorization', opsToken)
      .expect(404);
  });

  it('writes zone restrictions, audits the diff, and skips a same-set save', async () => {
    const driverId = await namedDriver('Zoned Driver');
    const south = await seedZone('South Zone');
    const north = await seedZone('North Zone');

    const updated = await request(app.getHttpServer())
      .put(`/v1/admin/drivers/${driverId}/zones`)
      .set('Authorization', opsToken)
      .send({ zoneIds: [south, north] })
      .expect(200);
    expectMatchesContract(adminDriverZonesResponseSchema, updated.body);
    expect(
      updated.body.zoneRestrictions.map((zone: { zoneId: string }) => zone.zoneId).sort(),
    ).toEqual([south, north].sort());

    const [audit] = await db
      .select()
      .from(adminActions)
      .where(eq(adminActions.action, 'driver.zones.update'))
      .orderBy(desc(adminActions.createdAt))
      .limit(1);
    expect(audit).toBeDefined();
    expect(audit!.adminId).toBe(opsId);
    expect((audit!.after as { zoneIds: string[] }).zoneIds.sort()).toEqual([south, north].sort());

    // Saving the same set again is a no-op: no second audit row.
    await request(app.getHttpServer())
      .put(`/v1/admin/drivers/${driverId}/zones`)
      .set('Authorization', opsToken)
      .send({ zoneIds: [north, south] })
      .expect(200);
    const audits = await db
      .select()
      .from(adminActions)
      .where(eq(adminActions.action, 'driver.zones.update'));
    expect(audits).toHaveLength(1);

    // Full replacement: the empty set clears the restrictions.
    await request(app.getHttpServer())
      .put(`/v1/admin/drivers/${driverId}/zones`)
      .set('Authorization', opsToken)
      .send({ zoneIds: [] })
      .expect(200)
      .expect({ driverId, zoneRestrictions: [] });

    // Unknown zone ids and unknown drivers are 404s, not FK 500s.
    await request(app.getHttpServer())
      .put(`/v1/admin/drivers/${driverId}/zones`)
      .set('Authorization', opsToken)
      .send({ zoneIds: [randomUUID()] })
      .expect(404);
    await request(app.getHttpServer())
      .put(`/v1/admin/drivers/${randomUUID()}/zones`)
      .set('Authorization', opsToken)
      .send({ zoneIds: [] })
      .expect(404);
  });

  it('suspends and reactivates through A14, with the audit trail', async () => {
    const driverId = await namedDriver('Suspendable Driver');

    const suspended = await request(app.getHttpServer())
      .post(`/v1/admin/drivers/${driverId}/suspend`)
      .set('Authorization', opsToken)
      .send({ reason: 'Repeated policy violations' })
      .expect(200);
    expect(suspended.body).toMatchObject({
      driverId,
      kycStatus: 'suspended',
      suspensionPending: false,
    });

    const [row] = await db.select().from(drivers).where(eq(drivers.id, driverId));
    expect(row!.kycStatus).toBe('suspended');
    expect(row!.suspensionReason).toBe('Repeated policy violations');
    const [audit] = await db
      .select()
      .from(adminActions)
      .where(eq(adminActions.action, 'driver.kyc.suspend'))
      .limit(1);
    expect(audit).toBeDefined();

    const reactivated = await request(app.getHttpServer())
      .post(`/v1/admin/drivers/${driverId}/reactivate`)
      .set('Authorization', opsToken)
      .expect(200);
    // A14: reactivation returns the driver to `pending` (re-approval), not
    // straight back to `approved`.
    expect(reactivated.body).toMatchObject({ driverId, kycStatus: 'pending' });
  });

  it("support's suspend files a driver request that ops can approve", async () => {
    const driverId = await namedDriver('Requested Driver');

    const refused = await request(app.getHttpServer())
      .post(`/v1/admin/drivers/${driverId}/suspend`)
      .set('Authorization', supportToken)
      .send({ reason: 'Customer complaints pile up' })
      .expect(403);
    expect(refused.body.error.details.requestId).toBeTruthy();

    const [requestRow] = await db
      .select()
      .from(suspensionRequests)
      .where(eq(suspensionRequests.subjectId, driverId));
    expect(requestRow).toBeDefined();
    expect(requestRow!.subjectType).toBe('driver');
    expect(requestRow!.status).toBe('open');

    // The generic inbox executes it through the same one suspension service.
    await request(app.getHttpServer())
      .post(`/v1/admin/suspension-requests/${requestRow!.id}/approve`)
      .set('Authorization', opsToken)
      .send({ note: 'Approved after review' })
      .expect(200);

    const [row] = await db.select().from(drivers).where(eq(drivers.id, driverId));
    expect(row!.kycStatus).toBe('suspended');
  });

  it('enforces the role matrix on reads and writes', async () => {
    const driverId = await namedDriver('Matrix Driver');
    const fleet = await seedFleet(db, 'Matrix Fleet');
    const fleetToken = await authHeaderFor(app, { userId: fleet.ownerId, fleetId: fleet.fleetId });

    // reads: support and finance hold user.read; fleet and anon do not pass.
    for (const token of [supportToken, financeToken]) {
      await request(app.getHttpServer())
        .get('/v1/admin/drivers')
        .set('Authorization', token)
        .expect(200);
      await request(app.getHttpServer())
        .get(`/v1/admin/drivers/${driverId}`)
        .set('Authorization', token)
        .expect(200);
    }
    await request(app.getHttpServer())
      .get('/v1/admin/drivers')
      .set('Authorization', fleetToken)
      .expect(403);
    await request(app.getHttpServer()).get('/v1/admin/drivers').expect(401);

    // writes: finance holds neither permission; support cannot run the zone
    // editor (driver.capabilities) or reactivate. Finance's suspend attempt is
    // a GUARD 403 — no request row, unlike support's handler-level refusal.
    await request(app.getHttpServer())
      .post(`/v1/admin/drivers/${driverId}/suspend`)
      .set('Authorization', financeToken)
      .send({ reason: 'Not allowed to do this' })
      .expect(403);
    await request(app.getHttpServer())
      .put(`/v1/admin/drivers/${driverId}/zones`)
      .set('Authorization', supportToken)
      .send({ zoneIds: [] })
      .expect(403);
    await request(app.getHttpServer())
      .post(`/v1/admin/drivers/${driverId}/reactivate`)
      .set('Authorization', supportToken)
      .expect(403);
    await request(app.getHttpServer())
      .post(`/v1/admin/drivers/${driverId}/suspend`)
      .send({ reason: 'No session at all' })
      .expect(401);

    const financeRequests = await db
      .select()
      .from(suspensionRequests)
      .where(eq(suspensionRequests.subjectId, driverId));
    expect(financeRequests).toHaveLength(0);
  });
});
