import type { INestApplication } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { bookings } from '../../db/schema';
import { createTestApp, customerAuthHeaderFor, driverAuthHeaderFor } from '../../test/app';
import {
  seedCustomer,
  setupTestDatabase,
  testDb,
  truncateAll,
  type TestDatabase,
} from '../../test/db';
import { closeTestRedis, flushTestRedis } from '../../test/redis';
import { BookingOtpService } from '../bookings/booking-otp.service';
import {
  PICKUP,
  seedOnlineDriver,
  seedSearchingBooking,
  seedZone,
} from '../dispatch/dispatch-fixtures';
import { OfferService } from '../dispatch/offer.service';
import { DispatchRepo } from '../dispatch/dispatch.repo';
import { InTransitWatcher } from './in-transit.watcher';
import { JobExecutionService } from './job-execution.service';

/**
 * Screen 25's "In transit" time: `bookings.in_transit_at`, recorded from the
 * driver's pings the first time an `in_progress` tow is 150 m from its pickup.
 * Before this, the live app showed the pickup time (`started_at`) for both
 * "Picked up" and "In transit".
 */

/** About 50 m and about 220 m north of the pickup. */
const NEAR = { lat: PICKUP.lat + 0.00045, lng: PICKUP.lng };
const AWAY = { lat: PICKUP.lat + 0.002, lng: PICKUP.lng };

let app: INestApplication;
let db: TestDatabase;
let watcher: InTransitWatcher;

async function inTransitAt(bookingId: string): Promise<Date | null> {
  const [row] = await db
    .select({ inTransitAt: bookings.inTransitAt })
    .from(bookings)
    .where(eq(bookings.id, bookingId));
  return row!.inTransitAt;
}

describe('in_transit_at (screen 25)', () => {
  let userId: string;
  let driverId: string;
  let bookingId: string;

  beforeAll(async () => {
    await setupTestDatabase();
    db = testDb();
    app = await createTestApp();
    watcher = app.get(InTransitWatcher);
  });

  afterAll(async () => {
    await app.close();
    await closeTestRedis();
  });

  /** Assigned, arrived and started with the real code: `in_progress` at the pickup. */
  async function startTrip(options: { roadside?: boolean } = {}): Promise<void> {
    if (options.roadside) {
      await db
        .update(bookings)
        .set({ serviceType: 'battery', dropLat: null, dropLng: null, dropAddress: null })
        .where(eq(bookings.id, bookingId));
    }
    const repo = app.get(DispatchRepo);
    const booking = await repo.booking(bookingId);
    const offers = app.get(OfferService);
    await offers.offer(
      booking!,
      {
        driverId,
        distanceMeters: 500,
        score: 50,
        terms: { proximity: 0.5, rating: 0.5, acceptance: 0.5, completion: 0.5 },
        fleetId: null,
        truckId: null,
      },
      1,
      2,
      20,
    );
    await offers.accept(bookingId, driverId);
    await app.get(JobExecutionService).arrived(bookingId, driverId);
    const { code } = await app.get(BookingOtpService).issue(db, bookingId);
    await request(app.getHttpServer())
      .post(`/v1/jobs/${bookingId}/start`)
      .set('authorization', await driverAuthHeaderFor(app, { driverId }))
      .send({ otp: code })
      .expect(200);
  }

  beforeEach(async () => {
    await truncateAll();
    await flushTestRedis();
    const zoneId = await seedZone(db);
    userId = await seedCustomer(db);
    driverId = await seedOnlineDriver(db, { zoneId });
    bookingId = await seedSearchingBooking(db, { userId, zoneId });
  });

  it('is not set while the truck is still at the pickup, loading', async () => {
    await startTrip();
    expect(await watcher.onPing(driverId, NEAR)).toBe(false);
    expect(await inTransitAt(bookingId)).toBeNull();
  });

  it('is set once the truck is 150 m out, and never moves after that', async () => {
    await startTrip();
    expect(await watcher.onPing(driverId, NEAR)).toBe(false);

    expect(await watcher.onPing(driverId, AWAY)).toBe(true);
    const first = await inTransitAt(bookingId);
    expect(first).not.toBeNull();

    expect(await watcher.onPing(driverId, { lat: AWAY.lat + 0.01, lng: AWAY.lng })).toBe(false);
    expect(await inTransitAt(bookingId)).toEqual(first);
  });

  it('is on the customer tracking payload', async () => {
    await startTrip();
    await watcher.onPing(driverId, AWAY);

    const res = await request(app.getHttpServer())
      .get(`/v1/bookings/${bookingId}/tracking`)
      .set('authorization', await customerAuthHeaderFor(app, { userId }))
      .expect(200);
    expect(res.body.inTransitAt).toBe((await inTransitAt(bookingId))!.toISOString());
    expect(res.body.startedAt).not.toBe(res.body.inTransitAt);
  });

  it('is never set before the trip starts, when the driver is only on the way', async () => {
    const repo = app.get(DispatchRepo);
    const booking = await repo.booking(bookingId);
    await app.get(OfferService).offer(
      booking!,
      {
        driverId,
        distanceMeters: 500,
        score: 50,
        terms: { proximity: 0.5, rating: 0.5, acceptance: 0.5, completion: 0.5 },
        fleetId: null,
        truckId: null,
      },
      1,
      2,
      20,
    );
    await app.get(OfferService).accept(bookingId, driverId);

    expect(await watcher.onPing(driverId, AWAY)).toBe(false);
    expect(await inTransitAt(bookingId)).toBeNull();
  });

  it('is never set for a roadside job, which has nothing to carry away', async () => {
    await startTrip({ roadside: true });
    expect(await watcher.onPing(driverId, AWAY)).toBe(false);
    expect(await inTransitAt(bookingId)).toBeNull();
  });
});
