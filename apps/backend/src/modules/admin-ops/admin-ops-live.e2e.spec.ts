import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { adminOpsLiveQuerySchema, adminOpsLiveResponseSchema } from '@towing/api-contracts';
import { eq, sql } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../../app.module';
import { bookings, drivers, serviceZones } from '../../db/schema';
import { driverHashKey } from '../../redis/redis.constants';
import { AdminOpsBroadcasterService } from '../../realtime/admin-ops-broadcaster.service';
import { adminAuthHeaderFor, createTestApp } from '../../test/app';
import {
  seedAdmin,
  seedCustomer,
  seedDriver,
  setupTestDatabase,
  truncateAll,
  type TestDatabase,
} from '../../test/db';
import { seedBooking } from '../../test/fixtures';
import { closeTestRedis, flushTestRedis, testRedis } from '../../test/redis';

/**
 * W4 — `GET /v1/admin/ops/live` (§9.4.6).
 *
 * The snapshot's tenancy rule is the fleet one, inverted: Postgres decides
 * WHICH drivers (online + approved, optionally in a zone) and Redis says WHERE
 * (the hot hash), falling back to the persisted PostGIS column with
 * `degraded: true` when Redis is unreachable — the unit spec covers that
 * branch; this file asserts the real HTTP shape, the zone/status filters and
 * the exclusion of `searching` bookings.
 *
 * The KPI broadcaster is stubbed for the same reason as in the dashboard spec:
 * its 10 s tick writes caches mid-fixture and this file asserts exact arrays.
 */
describe('admin ops live snapshot (W4)', () => {
  let app: INestApplication;
  let db: TestDatabase;
  let token: string;

  async function createLiveApp(): Promise<INestApplication> {
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
    app = await createLiveApp();
  });

  afterAll(async () => {
    await app.close();
    await closeTestRedis();
  });

  beforeEach(async () => {
    await truncateAll();
    await flushTestRedis();
    const admin = await seedAdmin(db, { subRole: 'operations' });
    token = await adminAuthHeaderFor(app, { adminId: admin.id, subRole: 'operations' });
  });

  async function seedZone(name: string): Promise<string> {
    const [row] = await db
      .insert(serviceZones)
      .values({
        name,
        area: 'SRID=4326;POLYGON((77.45 12.80,77.80 12.80,77.80 13.15,77.45 13.15,77.45 12.80))',
        surgeBand: 'standard',
      })
      .returning({ id: serviceZones.id });
    return row!.id;
  }

  async function onlineDriver(zoneId: string, name: string, lat: number, lng: number) {
    const driverId = await seedDriver(db, { name });
    await db.execute(sql`
      update drivers
         set is_online = true,
             current_zone_id = ${zoneId}::uuid,
             last_ping_at = now(),
             current_location = ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography
       where id = ${driverId}::uuid
    `);
    return driverId;
  }

  it('returns drivers and active bookings, filters by zone and status, and excludes searching', async () => {
    const zoneA = await seedZone('Zone A');
    const zoneB = await seedZone('Zone B');
    const customer = await seedCustomer(db);

    const driverA = await onlineDriver(zoneA, 'Driver A', 12.9716, 77.5946);
    const driverB = await onlineDriver(zoneB, 'Driver B', 12.9352, 77.6245);

    // A hot Redis hash for A (Redis wins); B keeps only its PostGIS column
    // (the fallback path, honestly marked).
    await testRedis().hset(driverHashKey(driverA), {
      lat: '12.9716',
      lng: '77.5946',
      at: new Date().toISOString(),
      headingDeg: '92',
      speedKph: '31',
      zoneId: zoneA,
    });

    const bookingA = await seedBooking(db, {
      userId: customer,
      status: 'assigned',
      driverId: driverA,
    });
    await db.update(bookings).set({ zoneId: zoneA }).where(eq(bookings.id, bookingA));

    const bookingB = await seedBooking(db, {
      userId: await seedCustomer(db),
      status: 'en_route',
      driverId: driverB,
    });
    await db.update(bookings).set({ zoneId: zoneB }).where(eq(bookings.id, bookingB));

    // A search has no driver to follow — it must not appear on the map.
    await seedBooking(db, { userId: await seedCustomer(db), status: 'searching' });

    const all = adminOpsLiveResponseSchema.parse(
      (
        await request(app.getHttpServer())
          .get('/v1/admin/ops/live')
          .set('Authorization', token)
          .expect(200)
      ).body,
    );

    expect(all.degraded).toBe(false);
    expect(all.drivers.map((driver) => driver.driverId).sort()).toEqual([driverA, driverB].sort());
    expect(all.drivers.find((driver) => driver.driverId === driverA)).toMatchObject({
      fromFallback: false,
      lat: 12.9716,
      headingDeg: 92,
    });
    expect(all.drivers.find((driver) => driver.driverId === driverB)).toMatchObject({
      fromFallback: true,
      lat: 12.9352,
      headingDeg: null,
    });
    expect(all.bookings.map((booking) => booking.bookingId).sort()).toEqual(
      [bookingA, bookingB].sort(),
    );
    expect(all.zones.map((zone) => zone.id).sort()).toEqual([zoneA, zoneB].sort());

    // Zone filter: drivers by their current zone, bookings by theirs.
    const zoneOnly = adminOpsLiveResponseSchema.parse(
      (
        await request(app.getHttpServer())
          .get(`/v1/admin/ops/live?zoneId=${zoneA}`)
          .set('Authorization', token)
          .expect(200)
      ).body,
    );
    expect(zoneOnly.drivers.map((driver) => driver.driverId)).toEqual([driverA]);
    expect(zoneOnly.bookings.map((booking) => booking.bookingId)).toEqual([bookingA]);

    // Status filter narrows bookings only — the map's drivers stay visible.
    const statusOnly = adminOpsLiveResponseSchema.parse(
      (
        await request(app.getHttpServer())
          .get('/v1/admin/ops/live?status=en_route')
          .set('Authorization', token)
          .expect(200)
      ).body,
    );
    expect(statusOnly.bookings.map((booking) => booking.bookingId)).toEqual([bookingB]);
    expect(statusOnly.drivers).toHaveLength(2);
  });

  it('rejects a status outside the four the map draws', async () => {
    const bad = adminOpsLiveQuerySchema.safeParse({ status: 'paid' });
    expect(bad.success).toBe(false);

    await request(app.getHttpServer())
      .get('/v1/admin/ops/live?status=paid')
      .set('Authorization', token)
      .expect(422);
  });
});
