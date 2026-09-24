import type { INestApplication } from '@nestjs/common';
import type { NearbyDriversResponse } from '@towing/api-contracts';
import { eq, sql } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { dispatchConfig, drivers, serviceZones } from '../../db/schema';
import { driverGeoKey, driverHashKey } from '../../redis/redis.constants';
import { createTestApp, customerAuthHeaderFor, driverAuthHeaderFor } from '../../test/app';
import {
  seedCustomer,
  seedDriver,
  setupTestDatabase,
  testDb,
  truncateAll,
  type TestDatabase,
} from '../../test/db';
import { closeTestRedis, flushTestRedis, testRedis } from '../../test/redis';
import { DispatchConfigRepo } from '../bookings/dispatch-config.repo';

/**
 * `GET /v1/drivers/nearby` (§11.9) and the liveness rule behind it.
 *
 * Two independent things are on trial. The first is what the response does NOT
 * contain: §11.9 forbids identity pre-assignment, and a regression that
 * re-added a name would be invisible to every other test in the repo. The
 * second is the §6.1 liveness rule — supply the customer can see must be supply
 * dispatch would actually consider.
 */

let app: INestApplication;
let db: TestDatabase;

const CENTRE = { lat: 12.9716, lng: 77.5946 };

async function seedZone(): Promise<string> {
  const [row] = await db
    .insert(serviceZones)
    .values({
      name: 'Bengaluru Metro',
      area: 'SRID=4326;POLYGON((77.45 12.80,77.80 12.80,77.80 13.15,77.45 13.15,77.45 12.80))',
    })
    .returning({ id: serviceZones.id });
  return row!.id;
}

/**
 * Puts a driver into the candidate store directly, so a test can control the
 * ping AGE — which is the one thing the real routes deliberately do not let a
 * caller do.
 */
async function placeDriver(params: {
  driverId: string;
  zoneId: string;
  lat: number;
  lng: number;
  ageMs?: number;
}): Promise<void> {
  const at = new Date(Date.now() - (params.ageMs ?? 0)).toISOString();
  await testRedis().hset(driverHashKey(params.driverId), {
    zoneId: params.zoneId,
    fleetId: '',
    truckId: '',
    vehicleClass: 'flatbed',
    longDistance: '0',
    seq: '1',
    lat: String(params.lat),
    lng: String(params.lng),
    headingDeg: '90',
    speedKph: '30',
    accuracyM: '8',
    at,
  });
  await testRedis().geoadd(driverGeoKey(params.zoneId), params.lng, params.lat, params.driverId);
}

async function nearby(auth: string, query = `lat=${CENTRE.lat}&lng=${CENTRE.lng}&radiusKm=5`): Promise<NearbyDriversResponse> {
  const res = await request(app.getHttpServer())
    .get(`/v1/drivers/nearby?${query}`)
    .set('Authorization', auth)
    .expect(200);
  return res.body as NearbyDriversResponse;
}

describe('GET /v1/drivers/nearby', () => {
  let auth: string;

  beforeAll(async () => {
    await setupTestDatabase();
    db = testDb();
    app = await createTestApp();
  });

  beforeEach(async () => {
    await truncateAll();
    await flushTestRedis();
    auth = await customerAuthHeaderFor(app, { userId: await seedCustomer(db) });
    // The config repo caches for 5 minutes; a spec that changes the threshold
    // between cases would otherwise read the previous case's value.
    await app.get(DispatchConfigRepo).invalidate();
  });

  afterAll(async () => {
    await app.close();
    await closeTestRedis();
  });

  describe('§11.9 — no identity before assignment', () => {
    it('returns coarsened points and a count, and nothing that identifies anyone', async () => {
      const zoneId = await seedZone();
      const driverId = await seedDriver(db, { kycStatus: 'approved', name: 'Suresh Kumar' });
      await placeDriver({ driverId, zoneId, lat: 12.9720, lng: 77.5950 });

      const body = await nearby(auth);

      expect(body.count).toBe(1);
      expect(body.points).toHaveLength(1);
      expect(body.coarsenedToMeters).toBe(100);

      // Asserted over the WHOLE serialized response, not field by field: a
      // future field that leaked a name would pass a `toMatchObject` check and
      // fail this one.
      const serialized = JSON.stringify(body);
      expect(serialized).not.toContain('Suresh');
      expect(serialized).not.toContain(driverId);
      expect(Object.keys(body.points[0]!).sort()).toEqual(['lat', 'lng']);

      // The map's trucks: the same coarse point, which way it faces and what
      // kind of truck, and still nothing more.
      expect(body.vehicles).toEqual([
        { ...body.points[0]!, headingDeg: 90, vehicleClass: 'flatbed' },
      ]);
      expect(Object.keys(body.vehicles[0]!).sort()).toEqual([
        'headingDeg',
        'lat',
        'lng',
        'vehicleClass',
      ]);
    });

    it('snaps positions onto a grid rather than returning the true point', async () => {
      const zoneId = await seedZone();
      const driverId = await seedDriver(db, { kycStatus: 'approved' });
      const truth = { lat: 12.97231, lng: 77.59487 };
      await placeDriver({ driverId, zoneId, ...truth });

      const body = await nearby(auth);

      const point = body.points[0]!;
      expect(point.lat).not.toBe(truth.lat);
      expect(point.lng).not.toBe(truth.lng);
      // Within the cell, but not AT the true point.
      expect(point.lat).toBeCloseTo(truth.lat, 2);
      expect(point.lng).toBeCloseTo(truth.lng, 2);
    });

    it('returns the SAME coarse point on repeated reads — the snap does not resample', async () => {
      // The property that distinguishes snapping from jitter. A jittered
      // response re-rolls per request, so a client polling every few seconds
      // averages the noise away and recovers the true position; a grid snap adds
      // no information no matter how long anyone watches.
      const zoneId = await seedZone();
      const driverId = await seedDriver(db, { kycStatus: 'approved' });
      await placeDriver({ driverId, zoneId, lat: 12.97231, lng: 77.59487 });

      const reads = await Promise.all([nearby(auth), nearby(auth), nearby(auth), nearby(auth)]);
      const distinct = new Set(reads.map((r) => JSON.stringify(r.points)));

      expect(distinct.size).toBe(1);
    });

    it('counts co-located drivers honestly while drawing one marker', async () => {
      const zoneId = await seedZone();
      // Three drivers within a few metres — one cell, three units of supply.
      for (const offset of [0, 0.00002, 0.00004]) {
        const driverId = await seedDriver(db, { kycStatus: 'approved' });
        await placeDriver({ driverId, zoneId, lat: 12.9716 + offset, lng: 77.5946 + offset });
      }

      const body = await nearby(auth);

      // "How much supply is there" is the question that decides whether the
      // customer books, and it is answered before coarsening collapses markers.
      expect(body.count).toBe(3);
      expect(body.points).toHaveLength(1);
    });
  });

  describe('§6.1 — liveness is ping freshness', () => {
    it('excludes a driver whose last ping is older than the configured threshold', async () => {
      const zoneId = await seedZone();
      const fresh = await seedDriver(db, { kycStatus: 'approved' });
      const stale = await seedDriver(db, { kycStatus: 'approved' });

      await placeDriver({ driverId: fresh, zoneId, lat: 12.9720, lng: 77.5950, ageMs: 2_000 });
      // Past the 15s default. This driver's phone stopped reporting; offering
      // them a job would ring nothing and burn a whole 20-second wave.
      await placeDriver({ driverId: stale, zoneId, lat: 12.9721, lng: 77.5951, ageMs: 30_000 });

      const body = await nearby(auth);

      expect(body.count).toBe(1);
    });

    it('honours an ADMIN-WIDENED threshold from dispatch_config', async () => {
      // §6.7 makes this tunable so an operator can widen it during a network
      // incident rather than watching supply evaporate. A hard-coded 15s would
      // pass the test above and fail this one.
      const zoneId = await seedZone();
      await db.insert(dispatchConfig).values({ stalePingSeconds: 120 });
      await app.get(DispatchConfigRepo).invalidate();

      const driverId = await seedDriver(db, { kycStatus: 'approved' });
      await placeDriver({ driverId, zoneId, lat: 12.9720, lng: 77.5950, ageMs: 60_000 });

      expect((await nearby(auth)).count).toBe(1);
    });

    it('drops a GEO member whose hash has expired, and repairs the set', async () => {
      const zoneId = await seedZone();
      const driverId = await seedDriver(db, { kycStatus: 'approved' });
      // The state a switched-off handset leaves: member alive (GEO members carry
      // no TTL), hash gone.
      await testRedis().geoadd(driverGeoKey(zoneId), 77.5950, 12.9720, driverId);

      expect((await nearby(auth)).count).toBe(0);

      // Read-repair — otherwise the set grows without bound over a launch.
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(await testRedis().zcard(driverGeoKey(zoneId))).toBe(0);
    });
  });

  describe('geography', () => {
    it('excludes a driver outside the requested radius', async () => {
      const zoneId = await seedZone();
      const near = await seedDriver(db, { kycStatus: 'approved' });
      const far = await seedDriver(db, { kycStatus: 'approved' });

      await placeDriver({ driverId: near, zoneId, lat: 12.9750, lng: 77.5980 });
      // ~11 km north, inside the same zone polygon but outside a 5 km viewport.
      await placeDriver({ driverId: far, zoneId, lat: 13.0700, lng: 77.5946 });

      expect((await nearby(auth)).count).toBe(1);
      expect((await nearby(auth, `lat=${CENTRE.lat}&lng=${CENTRE.lng}&radiusKm=20`)).count).toBe(2);
    });

    it('answers "no drivers" rather than 422 for a viewport outside every zone', async () => {
      // Panning the map over open country is not an error the way a BOOKING
      // outside the service area is — the customer is exploring, not committing.
      await seedZone();
      const body = await nearby(auth, 'lat=13.0827&lng=80.2707&radiusKm=5');
      expect(body.count).toBe(0);
    });

    it('rejects a radius past the cap so this cannot become a supply census', async () => {
      await request(app.getHttpServer())
        .get(`/v1/drivers/nearby?lat=${CENTRE.lat}&lng=${CENTRE.lng}&radiusKm=500`)
        .set('Authorization', auth)
        .expect(422);
    });

    it('422s a malformed coordinate', async () => {
      await request(app.getHttpServer())
        .get('/v1/drivers/nearby?lat=91&lng=77.6')
        .set('Authorization', auth)
        .expect(422);
    });
  });

  describe('§19.2 — the degraded rung', () => {
    it('answers from PostGIS when the zone has no GEO set, and says so', async () => {
      // The viewport resolves to no zone, so there is no Redis partition to
      // search — the same code path a Redis outage takes.
      await seedZone();
      const driverId = await seedDriver(db, { kycStatus: 'approved' });
      await db
        .update(drivers)
        .set({
          isOnline: true,
          currentLocation: { lat: 13.0830, lng: 80.2710 },
          lastPingAt: new Date(),
        })
        .where(eq(drivers.id, driverId));

      const body = await nearby(auth, 'lat=13.0827&lng=80.2707&radiusKm=5');

      expect(body.count).toBe(1);
      // A ladder is only honest if the client can see which rung answered.
      expect(body.degraded).toBe(true);
    });

    it('excludes an un-approved or offline driver from the degraded read too', async () => {
      await seedZone();
      const suspended = await seedDriver(db, { kycStatus: 'suspended' });
      const offline = await seedDriver(db, { kycStatus: 'approved' });

      await db
        .update(drivers)
        .set({ isOnline: true, currentLocation: { lat: 13.0830, lng: 80.2710 }, lastPingAt: new Date() })
        .where(eq(drivers.id, suspended));
      await db
        .update(drivers)
        .set({ isOnline: false, currentLocation: { lat: 13.0830, lng: 80.2710 }, lastPingAt: new Date() })
        .where(eq(drivers.id, offline));

      expect((await nearby(auth, 'lat=13.0827&lng=80.2707&radiusKm=5')).count).toBe(0);
    });

    it('applies the freshness bound on the degraded read as well', async () => {
      await seedZone();
      const driverId = await seedDriver(db, { kycStatus: 'approved' });
      await db
        .update(drivers)
        .set({
          isOnline: true,
          currentLocation: { lat: 13.0830, lng: 80.2710 },
          lastPingAt: sql`now() - interval '10 minutes'`,
        })
        .where(eq(drivers.id, driverId));

      expect((await nearby(auth, 'lat=13.0827&lng=80.2707&radiusKm=5')).count).toBe(0);
    });

    it('reports degraded:false when Redis answered', async () => {
      const zoneId = await seedZone();
      const driverId = await seedDriver(db, { kycStatus: 'approved' });
      await placeDriver({ driverId, zoneId, lat: 12.9720, lng: 77.5950 });

      expect((await nearby(auth)).degraded).toBe(false);
    });
  });

  describe('access', () => {
    it('401s without a token', async () => {
      await request(app.getHttpServer())
        .get(`/v1/drivers/nearby?lat=${CENTRE.lat}&lng=${CENTRE.lng}`)
        .expect(401);
    });

    it('403s a driver token — this is a customer surface', async () => {
      const driverId = await seedDriver(db, { kycStatus: 'approved' });
      await request(app.getHttpServer())
        .get(`/v1/drivers/nearby?lat=${CENTRE.lat}&lng=${CENTRE.lng}`)
        .set('Authorization', await driverAuthHeaderFor(app, { driverId }))
        .expect(403);
    });
  });
});
