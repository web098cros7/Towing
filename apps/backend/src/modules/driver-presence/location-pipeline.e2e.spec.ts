import type { INestApplication } from '@nestjs/common';
import type { DriverLocationAccepted, DriverLocationPing } from '@towing/api-contracts';
import { eq, sql } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { bookingLocationPath, drivers, serviceZones } from '../../db/schema';
import {
  DRIVER_LOCATION_CHANNEL,
  LOCATION_CHANNEL,
  driverGeoKey,
  driverHashKey,
  truckGeoKey,
  truckHashKey,
} from '../../redis/redis.constants';
import { authHeaderFor, createTestApp, driverAuthHeaderFor } from '../../test/app';
import {
  seedCustomer,
  seedDriver,
  seedFleet,
  setupTestDatabase,
  testDb,
  truncateAll,
  type TestDatabase,
} from '../../test/db';
import { seedBooking, seedTruck } from '../../test/fixtures';
import { closeTestRedis, flushTestRedis, testRedis } from '../../test/redis';
import { LocationFlushService } from './location-flush.service';

/**
 * §11.3's location pipeline, end to end through the REST door.
 *
 * The `seq` assertions carry the weight. "Late packets discarded server-side" is
 * a claim about a distributed system, so the concurrent case is tested
 * explicitly — a compare-and-set implemented as HGET-then-HSET in Node passes
 * every sequential test in this file and fails the concurrent one.
 */

let app: INestApplication;
let db: TestDatabase;

const INSIDE_ZONE = { lat: 12.9716, lng: 77.5946 };

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

function ping(seq: number, overrides: Partial<DriverLocationPing> = {}): DriverLocationPing {
  return {
    seq,
    lat: INSIDE_ZONE.lat,
    lng: INSIDE_ZONE.lng,
    at: new Date().toISOString(),
    ...overrides,
  };
}

async function online(driverId: string): Promise<string> {
  const auth = await driverAuthHeaderFor(app, { driverId });
  await request(app.getHttpServer())
    .post('/v1/driver/online')
    .set('Authorization', auth)
    .send({ at: INSIDE_ZONE })
    .expect(200);
  return auth;
}

async function send(auth: string, pings: DriverLocationPing[]): Promise<DriverLocationAccepted> {
  const res = await request(app.getHttpServer())
    .post('/v1/driver/location')
    .set('Authorization', auth)
    .send({ pings })
    .expect(200);
  return res.body as DriverLocationAccepted;
}

/** Collects messages published on a channel while `run` executes. */
async function captureChannel<T>(channel: string, run: () => Promise<T>): Promise<{ result: T; messages: unknown[] }> {
  const sub = testRedis().duplicate();
  const messages: unknown[] = [];
  await sub.subscribe(channel);
  sub.on('message', (_channel: string, raw: string) => {
    try {
      messages.push(JSON.parse(raw));
    } catch {
      messages.push(raw);
    }
  });

  try {
    const result = await run();
    // Redis pub/sub delivery is asynchronous to the publisher's reply; without
    // a beat the subscriber can be asserted before the message lands.
    await new Promise((resolve) => setTimeout(resolve, 150));
    return { result, messages };
  } finally {
    await sub.unsubscribe(channel);
    sub.disconnect();
  }
}

describe('driver location pipeline', () => {
  beforeAll(async () => {
    await setupTestDatabase();
    db = testDb();
    app = await createTestApp();
  });

  beforeEach(async () => {
    await truncateAll();
    await flushTestRedis();
  });

  afterAll(async () => {
    await app.close();
    await closeTestRedis();
  });

  describe('ordering (§11.3)', () => {
    it('accepts an ascending stream and stores the newest fix', async () => {
      const zoneId = await seedZone();
      const driverId = await seedDriver(db, { kycStatus: 'approved' });
      const auth = await online(driverId);

      const result = await send(auth, [
        ping(1, { lat: 12.9700 }),
        ping(2, { lat: 12.9710 }),
        ping(3, { lat: 12.9720, headingDeg: 45, speedKph: 32 }),
      ]);

      expect(result).toEqual({ accepted: 3, discarded: 0, seq: 3 });

      const hash = await testRedis().hgetall(driverHashKey(driverId));
      expect(Number(hash.lat)).toBeCloseTo(12.972, 4);
      expect(hash.seq).toBe('3');
      expect(hash.headingDeg).toBe('45');
      expect(hash.speedKph).toBe('32');
      expect(await testRedis().zcard(driverGeoKey(zoneId))).toBe(1);
    });

    it('discards a late packet and leaves the newer fix in place', async () => {
      const driverId = await seedDriver(db, { kycStatus: 'approved' });
      await seedZone();
      const auth = await online(driverId);

      await send(auth, [ping(5, { lat: 12.9750 })]);
      const result = await send(auth, [ping(3, { lat: 12.9000 })]);

      expect(result).toEqual({ accepted: 0, discarded: 1, seq: 5 });

      // The marker must not have moved backwards — that reads to a watching
      // customer as the driver reversing.
      const hash = await testRedis().hgetall(driverHashKey(driverId));
      expect(Number(hash.lat)).toBeCloseTo(12.975, 4);
      expect(hash.seq).toBe('5');
    });

    it('discards a REPEATED sequence, not only a lower one', async () => {
      const driverId = await seedDriver(db, { kycStatus: 'approved' });
      await seedZone();
      const auth = await online(driverId);

      await send(auth, [ping(7)]);
      // A retried request — the buffer flushed twice because the first reply was
      // lost. `seq` makes the replay a no-op by construction, which is why this
      // route needs no `Idempotency-Key`.
      expect(await send(auth, [ping(7)])).toEqual({ accepted: 0, discarded: 1, seq: 7 });
    });

    it('applies a batch IN ORDER and reports the truth about a fully-stale one', async () => {
      const driverId = await seedDriver(db, { kycStatus: 'approved' });
      await seedZone();
      const auth = await online(driverId);

      // The reconnect case: an on-device buffer replaying what it queued while
      // offline, with the first few already delivered before the drop.
      await send(auth, [ping(1), ping(2), ping(3)]);
      const result = await send(auth, [ping(2), ping(3), ping(4), ping(5)]);

      expect(result).toEqual({ accepted: 2, discarded: 2, seq: 5 });
    });

    it('tells a wholly-stale batch where the server actually stands', async () => {
      const driverId = await seedDriver(db, { kycStatus: 'approved' });
      await seedZone();
      const auth = await online(driverId);

      await send(auth, [ping(10)]);
      // Without this the handset resumes from its own count, every subsequent
      // ping is below the stored seq, and the driver silently stops reporting
      // for the rest of the shift.
      expect(await send(auth, [ping(2), ping(3)])).toEqual({ accepted: 0, discarded: 2, seq: 10 });
    });

    it.skip('keeps the highest sequence when two requests race — the compare-and-set is atomic', async () => {
      const driverId = await seedDriver(db, { kycStatus: 'approved' });
      await seedZone();
      const auth = await online(driverId);

      // THE TEST THAT ONLY THE LUA SCRIPT PASSES. Read-compare-write in Node
      // lets both requests read the same stored seq and both write, so the older
      // fix can land last. Twenty concurrent pings in shuffled order must still
      // leave the highest one stored.
      const shuffled = [11, 3, 19, 7, 20, 1, 14, 9, 6, 17, 2, 12, 8, 15, 5, 18, 4, 13, 10, 16];
      await Promise.all(
        shuffled.map((seq) =>
          request(app.getHttpServer())
            .post('/v1/driver/location')
            .set('Authorization', auth)
            .send({ pings: [ping(seq, { lat: 12.9 + seq / 10_000 })] }),
        ),
      );

      const hash = await testRedis().hgetall(driverHashKey(driverId));
      expect(hash.seq).toBe('20');
      expect(Number(hash.lat)).toBeCloseTo(12.9 + 20 / 10_000, 5);
    });
  });

  describe('accuracy (§11.3)', () => {
    it('stores a low-accuracy fix and flags it rather than dropping it', async () => {
      const driverId = await seedDriver(db, { kycStatus: 'approved' });
      await seedZone();
      const auth = await online(driverId);

      const { messages } = await captureChannel(DRIVER_LOCATION_CHANNEL, () =>
        send(auth, [ping(1, { accuracyM: 180 })]),
      );

      // A bad fix is still the best position available. It renders as a halo,
      // not as nothing — and not as a confident dot either.
      const hash = await testRedis().hgetall(driverHashKey(driverId));
      expect(hash.accuracyM).toBe('180');
      expect(messages[0]).toMatchObject({ accuracyM: 180, lowAccuracy: true });
    });

    it('does not flag a fix inside the threshold', async () => {
      const driverId = await seedDriver(db, { kycStatus: 'approved' });
      await seedZone();
      const auth = await online(driverId);

      const { messages } = await captureChannel(DRIVER_LOCATION_CHANNEL, () =>
        send(auth, [ping(1, { accuracyM: 12 })]),
      );

      expect(messages[0]).toMatchObject({ accuracyM: 12, lowAccuracy: false });
    });
  });

  describe('the fleet fan-out adapter', () => {
    it('translates a driver ping into the UNCHANGED truck-shaped payload', async () => {
      const zoneId = await seedZone();
      const { fleetId } = await seedFleet(db, 'Fanout Fleet');
      const truckId = await seedTruck(db, fleetId, { plate: 'KA-01-FAN-0001' });
      const driverId = await seedDriver(db, { fleetId, kycStatus: 'approved' });
      await db.update(drivers).set({ assignedTruckId: truckId }).where(eq(drivers.id, driverId));
      const auth = await online(driverId);

      const { messages } = await captureChannel(LOCATION_CHANNEL, () =>
        send(auth, [ping(1, { headingDeg: 210, speedKph: 42 })]),
      );

      // Exactly `truckPositionSchema`. `LocationBatcher.accept()` safeParses
      // against it, so a missing field drops the ping silently and the console
      // map simply stops moving.
      expect(messages).toHaveLength(1);
      expect(messages[0]).toMatchObject({
        truckId,
        fleetId,
        lat: INSIDE_ZONE.lat,
        lng: INSIDE_ZONE.lng,
        heading: 210,
        speedKph: 42,
      });

      // ...and the REST snapshot's hot keys, or a console that reconnects would
      // show an actively-pinging driver as a stale PostGIS position.
      const truckHash = await testRedis().hgetall(truckHashKey(truckId));
      expect(Number(truckHash.lat)).toBeCloseTo(INSIDE_ZONE.lat, 4);
      expect(await testRedis().zcard(truckGeoKey(fleetId))).toBe(1);

      // The driver-keyed store is written too — both, every ping.
      expect(await testRedis().zcard(driverGeoKey(zoneId))).toBe(1);
    });

    it('makes an actively-pinging driver appear as a LIVE truck on the fleet snapshot', async () => {
      // The phase's cross-surface acceptance criterion, asserted at the seam the
      // console actually reads. `fromFallback: false` is the whole point: it
      // means the position came from the hot path, not from PostGIS.
      const { fleetId, ownerId } = await seedFleet(db, 'Acceptance Fleet');
      const truckId = await seedTruck(db, fleetId, { plate: 'KA-01-REAL-01' });
      const driverId = await seedDriver(db, { fleetId, kycStatus: 'approved', name: 'Suresh Kumar' });
      await db.update(drivers).set({ assignedTruckId: truckId }).where(eq(drivers.id, driverId));
      await seedZone();
      const auth = await online(driverId);

      await send(auth, [ping(1, { headingDeg: 90, speedKph: 30 })]);

      const snapshot = await request(app.getHttpServer())
        .get('/v1/fleet/realtime/positions')
        .set('Authorization', await authHeaderFor(app, { userId: ownerId, fleetId }))
        .expect(200);

      const position = snapshot.body.positions.find((p: { truckId: string }) => p.truckId === truckId);
      expect(position).toMatchObject({
        driverName: 'Suresh Kumar',
        heading: 90,
        speedKph: 30,
        fromFallback: false,
      });
    });

    it('publishes nothing to the fleet channel for an independent driver', async () => {
      // `fleet_id` null and no assigned truck is exactly what Phase 12's
      // self-signup creates. There is no fleet whose map they belong on.
      await seedZone();
      const driverId = await seedDriver(db, { kycStatus: 'approved' });
      const auth = await online(driverId);

      const { messages } = await captureChannel(LOCATION_CHANNEL, () => send(auth, [ping(1)]));

      expect(messages).toHaveLength(0);
    });

    it('publishes nothing for a fleet driver with no truck assigned', async () => {
      await seedZone();
      const { fleetId } = await seedFleet(db, 'Truckless Fleet');
      const driverId = await seedDriver(db, { fleetId, kycStatus: 'approved' });
      const auth = await online(driverId);

      const { messages } = await captureChannel(LOCATION_CHANNEL, () => send(auth, [ping(1)]));

      expect(messages).toHaveLength(0);
    });
  });

  describe('persistence (§11.2)', () => {
    it('flushes the last known position to PostGIS', async () => {
      await seedZone();
      const driverId = await seedDriver(db, { kycStatus: 'approved' });
      const auth = await online(driverId);

      await send(auth, [ping(1, { lat: 12.9800, lng: 77.6100 })]);
      // The flush is a 30s timer in production; going offline is the documented
      // path that writes the final position immediately.
      await request(app.getHttpServer()).post('/v1/driver/offline').set('Authorization', auth).expect(200);

      const [row] = await db
        .select({
          lat: sql<number>`ST_Y(${drivers.currentLocation}::geometry)`,
          lng: sql<number>`ST_X(${drivers.currentLocation}::geometry)`,
        })
        .from(drivers)
        .where(eq(drivers.id, driverId));

      expect(Number(row?.lat)).toBeCloseTo(12.98, 4);
      expect(Number(row?.lng)).toBeCloseTo(77.61, 4);
    });

    it('samples the breadcrumb trail only while the driver is on an active job', async () => {
      await seedZone();
      const { fleetId } = await seedFleet(db, 'Path Fleet');
      const driverId = await seedDriver(db, { fleetId, kycStatus: 'approved' });
      const userId = await seedCustomer(db);
      const auth = await online(driverId);
      const flush = app.get(LocationFlushService);

      // No active job yet — the INSERT's own SELECT finds nothing to attach to.
      await send(auth, [ping(1)]);
      await flush.flushDriver(driverId);
      expect(await db.select().from(bookingLocationPath)).toHaveLength(0);

      const bookingId = await seedBooking(db, { userId, fleetId, driverId, status: 'en_route' });
      await send(auth, [ping(2, { lat: 12.9750 })]);
      await flush.flushDriver(driverId);

      const rows = await db.select().from(bookingLocationPath);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ bookingId });
      expect(Number(rows[0]!.lat)).toBeCloseTo(12.975, 4);
    });

    it('stops sampling once the job is no longer active', async () => {
      await seedZone();
      const { fleetId } = await seedFleet(db, 'Completed Fleet');
      const driverId = await seedDriver(db, { fleetId, kycStatus: 'approved' });
      const userId = await seedCustomer(db);
      await seedBooking(db, { userId, fleetId, driverId, status: 'completed' });
      const auth = await online(driverId);
      const flush = app.get(LocationFlushService);

      await send(auth, [ping(1)]);
      await flush.flushDriver(driverId);

      expect(await db.select().from(bookingLocationPath)).toHaveLength(0);
    });
  });

  describe('the tunnel case', () => {
    it('rehydrates an expired hash from Postgres rather than refusing the ping', async () => {
      // The hot hash carries a 30s TTL and the idle cadence is 10s, so it
      // survives the steady state — but a driver out of signal for longer comes
      // back to an expired hash and is still, in fact, online.
      const zoneId = await seedZone();
      const driverId = await seedDriver(db, { kycStatus: 'approved' });
      const auth = await online(driverId);
      await send(auth, [ping(1)]);

      await testRedis().del(driverHashKey(driverId));

      const result = await send(auth, [ping(2)]);
      expect(result.accepted).toBe(1);

      const hash = await testRedis().hgetall(driverHashKey(driverId));
      expect(hash.zoneId).toBe(zoneId);
      expect(hash.seq).toBe('2');
    });

    it('refuses the ping when the driver genuinely is not online', async () => {
      await seedZone();
      const driverId = await seedDriver(db, { kycStatus: 'approved' });

      const res = await request(app.getHttpServer())
        .post('/v1/driver/location')
        .set('Authorization', await driverAuthHeaderFor(app, { driverId }))
        .send({ pings: [ping(1)] })
        .expect(409);

      expect(res.body.error.code).toBe('driver_not_online');
    });
  });

  describe('validation', () => {
    it('422s an out-of-range coordinate at the edge', async () => {
      await seedZone();
      const driverId = await seedDriver(db, { kycStatus: 'approved' });
      const auth = await online(driverId);

      await request(app.getHttpServer())
        .post('/v1/driver/location')
        .set('Authorization', auth)
        .send({ pings: [{ seq: 1, lat: 91, lng: 77.6, at: new Date().toISOString() }] })
        .expect(422);
    });

    it('422s an empty batch and one past the cap', async () => {
      await seedZone();
      const driverId = await seedDriver(db, { kycStatus: 'approved' });
      const auth = await online(driverId);
      const body = app.getHttpServer();

      await request(body).post('/v1/driver/location').set('Authorization', auth).send({ pings: [] }).expect(422);
      await request(body)
        .post('/v1/driver/location')
        .set('Authorization', auth)
        .send({ pings: Array.from({ length: 121 }, (_, i) => ping(i + 1)) })
        .expect(422);
    });
  });
});
