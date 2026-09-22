import type { INestApplication } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { bookings, dispatchAttempts, drivers } from '../../db/schema';
import { createTestApp, driverAuthHeaderFor } from '../../test/app';
import {
  seedCustomer,
  setupTestDatabase,
  testDb,
  truncateAll,
  type TestDatabase,
} from '../../test/db';
import { closeTestRedis, flushTestRedis } from '../../test/redis';
import { DispatchConfigRepo } from '../bookings/dispatch-config.repo';
import { PresenceStore } from '../driver-presence/presence-store';
import { DispatchRepo } from './dispatch.repo';
import { DispatchService } from './dispatch.service';
import { OfferService } from './offer.service';
import { seedOnlineDriver, seedSearchingBooking, seedZone } from './dispatch-fixtures';

/**
 * §6.3's offer lifecycle and the accept transaction.
 *
 * THE CONCURRENCY CASES CARRY THE WEIGHT. Two drivers against one fare-locked
 * booking does not degrade the experience — it corrupts the ledger, because
 * both would later be credited against one customer payment. Everything else in
 * this file is bookkeeping by comparison.
 */

let app: INestApplication;
let db: TestDatabase;
let offers: OfferService;
let dispatch: DispatchService;
let repo: DispatchRepo;
let presence: PresenceStore;

/** Puts one driver on one booking with a live offer, the way a wave would. */
async function offerTo(bookingId: string, driverId: string, wave = 1): Promise<void> {
  const booking = await repo.booking(bookingId);
  await offers.offer(
    booking!,
    {
      driverId,
      distanceMeters: 500,
      score: 50,
      // W5 fixture: the offer path never runs the scorer, so the terms are
      // placeholders — nothing asserts on them here.
      terms: { proximity: 0.5, rating: 0.5, acceptance: 0.5, completion: 0.5 },
      fleetId: null,
      truckId: null,
    },
    wave,
    2,
    20,
  );
}

async function outcomeOf(bookingId: string, driverId: string): Promise<string | undefined> {
  const [row] = await db
    .select({ outcome: dispatchAttempts.outcome })
    .from(dispatchAttempts)
    .where(and(eq(dispatchAttempts.bookingId, bookingId), eq(dispatchAttempts.driverId, driverId)));
  return row?.outcome;
}

describe('dispatch offers (§6.3)', () => {
  let zoneId: string;
  let userId: string;
  let bookingId: string;

  beforeAll(async () => {
    await setupTestDatabase();
    db = testDb();
    app = await createTestApp();
    offers = app.get(OfferService);
    dispatch = app.get(DispatchService);
    repo = app.get(DispatchRepo);
    presence = app.get(PresenceStore);
  });

  beforeEach(async () => {
    await truncateAll();
    await flushTestRedis();
    await app.get(DispatchConfigRepo).invalidate();
    zoneId = await seedZone(db);
    userId = await seedCustomer(db);
    bookingId = await seedSearchingBooking(db, { userId, zoneId });
  });

  afterAll(async () => {
    await app.close();
    await closeTestRedis();
  });

  describe('making an offer', () => {
    it('locks the driver, records the attempt, and reports the net figure', async () => {
      const driverId = await seedOnlineDriver(db, { zoneId });

      await offerTo(bookingId, driverId);

      expect(await outcomeOf(bookingId, driverId)).toBe('offered');
      // A locked driver is invisible to every other search — the lock IS the
      // mechanism, so its presence is the assertion.
      expect(await presence.takeOfferLock(driverId, 1_000)).toBe(false);

      const offer = await offers.currentOffer(driverId);
      // Gross 1200, commission 120, net 1080 — the LOCKED values from §3.4's
      // confirm, not a recomputation from live config.
      expect(offer?.earnings).toMatchObject({
        grossPaise: 120_000,
        commissionPaise: 12_000,
        netPaise: 108_000,
        band: 'A',
        commissionPct: 10,
      });
    });

    it('refuses to offer to a driver another search already locked', async () => {
      const driverId = await seedOnlineDriver(db, { zoneId });
      await presence.takeOfferLock(driverId, 20_000);

      const booking = await repo.booking(bookingId);
      const made = await offers.offer(
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

      expect(made).toBe(false);
      // No phantom row: an attempt written for an offer that was never made
      // would enter the exclusion set and lock the driver out of this booking
      // permanently, for nothing.
      expect(await outcomeOf(bookingId, driverId)).toBeUndefined();
    });

    it('gives the offer an ABSOLUTE expiry on the server clock', async () => {
      const driverId = await seedOnlineDriver(db, { zoneId });
      await offerTo(bookingId, driverId);

      const offer = await offers.currentOffer(driverId);
      const remainingMs = new Date(offer!.expiresAt).getTime() - Date.now();

      // A relative countdown would be extended by every second of latency, and
      // two drivers would end up believing they hold the same booking.
      expect(remainingMs).toBeGreaterThan(15_000);
      expect(remainingMs).toBeLessThanOrEqual(20_000);
    });

    it('carries no customer phone number — identity is earned by assignment', async () => {
      const driverId = await seedOnlineDriver(db, { zoneId });
      await offerTo(bookingId, driverId);

      const offer = await offers.currentOffer(driverId);
      expect(JSON.stringify(offer)).not.toContain('+9198');
      expect(Object.keys(offer!)).not.toContain('customerMobile');
    });
  });

  describe('accept — the transaction', () => {
    it('assigns the driver and moves the booking', async () => {
      const driverId = await seedOnlineDriver(db, { zoneId });
      await offerTo(bookingId, driverId);

      const job = await offers.accept(bookingId, driverId);

      expect(job.bookingId).toBe(bookingId);
      expect(job.status).toBe('assigned');
      expect(await outcomeOf(bookingId, driverId)).toBe('accepted');

      const [row] = await db
        .select({ status: bookings.status, driverId: bookings.driverId })
        .from(bookings)
        .where(eq(bookings.id, bookingId));
      expect(row).toMatchObject({ status: 'assigned', driverId });
    });

    it('EXACTLY ONE of two simultaneous accepts wins', async () => {
      /**
       * The assertion this whole design exists for.
       *
       * Both drivers hold a live offer on the same booking and accept in the
       * same tick. `BookingStateMachineService.transition` takes
       * `SELECT … FOR UPDATE`, so they serialise — one commits, the other finds
       * the booking already `assigned` and is refused.
       */
      const first = await seedOnlineDriver(db, { zoneId, metersAway: 300 });
      const second = await seedOnlineDriver(db, { zoneId, metersAway: 400 });
      await offerTo(bookingId, first);
      await offerTo(bookingId, second);

      const results = await Promise.allSettled([
        offers.accept(bookingId, first),
        offers.accept(bookingId, second),
      ]);

      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);

      // And the loser gets a graceful conflict, not a 500 — two drivers racing
      // is the system working, not an error either of them made.
      const error = (rejected[0] as PromiseRejectedResult).reason as {
        getStatus?: () => number;
        code?: string;
      };
      expect(error.getStatus?.()).toBe(409);

      const [row] = await db
        .select({ driverId: bookings.driverId })
        .from(bookings)
        .where(eq(bookings.id, bookingId));
      expect([first, second]).toContain(row?.driverId);
    });

    it('revokes every other outstanding offer and releases those drivers', async () => {
      const winner = await seedOnlineDriver(db, { zoneId, metersAway: 300 });
      const loser = await seedOnlineDriver(db, { zoneId, metersAway: 400 });
      await offerTo(bookingId, winner);
      await offerTo(bookingId, loser);

      await offers.accept(bookingId, winner);

      expect(await outcomeOf(bookingId, loser)).toBe('revoked');
      // Released immediately rather than left to time out — a driver whose
      // offer is dead must be available for the next search now, not in fifteen
      // seconds.
      expect(await presence.takeOfferLock(loser, 1_000)).toBe(true);
    });

    it('refuses a driver who never held an offer', async () => {
      // Not merely unranked — refused. An accept is only reachable through an
      // offer, and `dispatch_attempts` is the arbiter.
      const outsider = await seedOnlineDriver(db, { zoneId });

      await expect(offers.accept(bookingId, outsider)).rejects.toMatchObject({
        response: { error: { code: 'offer_no_longer_available' } },
      });
    });

    it('refuses a driver who was suspended inside the twenty seconds', async () => {
      /**
       * §3.1's DATABASE layer, and the reason it is re-checked inside the
       * transaction rather than trusted from the offer: approval, online state
       * and truck compliance can all change while the driver is deciding, and
       * the offer was made against a twenty-second-old read.
       */
      const driverId = await seedOnlineDriver(db, { zoneId });
      await offerTo(bookingId, driverId);
      await db.update(drivers).set({ kycStatus: 'suspended' }).where(eq(drivers.id, driverId));

      await expect(offers.accept(bookingId, driverId)).rejects.toMatchObject({
        response: { error: { code: 'driver_not_eligible' } },
      });

      // The booking is untouched and still searchable.
      const [row] = await db
        .select({ status: bookings.status, driverId: bookings.driverId })
        .from(bookings)
        .where(eq(bookings.id, bookingId));
      expect(row).toMatchObject({ status: 'searching', driverId: null });
    });

    it('refuses a driver who went offline inside the twenty seconds', async () => {
      const driverId = await seedOnlineDriver(db, { zoneId });
      await offerTo(bookingId, driverId);
      await db.update(drivers).set({ isOnline: false }).where(eq(drivers.id, driverId));

      await expect(offers.accept(bookingId, driverId)).rejects.toMatchObject({
        response: { error: { code: 'driver_not_eligible' } },
      });
    });

    it('refuses an accept on a booking the customer already cancelled', async () => {
      const driverId = await seedOnlineDriver(db, { zoneId });
      await offerTo(bookingId, driverId);
      await db.update(bookings).set({ status: 'cancelled' }).where(eq(bookings.id, bookingId));

      await expect(offers.accept(bookingId, driverId)).rejects.toMatchObject({
        response: { error: { code: 'offer_no_longer_available' } },
      });
    });

    it('is idempotent under a double tap — the second is a conflict, not a second job', async () => {
      const driverId = await seedOnlineDriver(db, { zoneId });
      await offerTo(bookingId, driverId);

      await offers.accept(bookingId, driverId);
      await expect(offers.accept(bookingId, driverId)).rejects.toMatchObject({
        response: { error: { code: 'offer_no_longer_available' } },
      });

      const attempts = await db
        .select()
        .from(dispatchAttempts)
        .where(eq(dispatchAttempts.bookingId, bookingId));
      expect(attempts).toHaveLength(1);
    });
  });

  describe('reject and expire', () => {
    it('records a decline and frees the driver immediately', async () => {
      const driverId = await seedOnlineDriver(db, { zoneId });
      await offerTo(bookingId, driverId);

      await offers.reject(bookingId, driverId, 'Too far');

      expect(await outcomeOf(bookingId, driverId)).toBe('rejected');
      expect(await presence.takeOfferLock(driverId, 1_000)).toBe(true);
    });

    it('records silence as an expiry', async () => {
      const driverId = await seedOnlineDriver(db, { zoneId });
      await offerTo(bookingId, driverId);

      await dispatch.expireOffer(bookingId, driverId);

      expect(await outcomeOf(bookingId, driverId)).toBe('expired');
    });

    it('an expiry that fires AFTER an accept is a no-op', async () => {
      /**
       * The idempotency that makes a durable delayed job safe. The timer was
       * scheduled when the offer was made and fires regardless; without the
       * `outcome = 'offered'` predicate it would overwrite `accepted` with
       * `expired` and un-assign a live job twenty seconds after it started.
       */
      const driverId = await seedOnlineDriver(db, { zoneId });
      await offerTo(bookingId, driverId);
      await offers.accept(bookingId, driverId);

      await dispatch.expireOffer(bookingId, driverId);

      expect(await outcomeOf(bookingId, driverId)).toBe('accepted');
      const [row] = await db
        .select({ status: bookings.status })
        .from(bookings)
        .where(eq(bookings.id, bookingId));
      expect(row?.status).toBe('assigned');
    });

    it('a duplicate expiry is a no-op', async () => {
      const driverId = await seedOnlineDriver(db, { zoneId });
      await offerTo(bookingId, driverId);

      await dispatch.expireOffer(bookingId, driverId);
      await dispatch.expireOffer(bookingId, driverId);

      expect(await outcomeOf(bookingId, driverId)).toBe('expired');
    });
  });

  describe('§6.2 acceptance rate — its first writer', () => {
    it('is null with no resolved offers, not zero', async () => {
      // Scoring a new driver as 0 would rank them last forever — the cold-start
      // trap. Null means "no signal" and the scorer treats it as neutral.
      const driverId = await seedOnlineDriver(db, { zoneId, acceptanceRate: null });

      expect(await repo.recomputeAcceptanceRate(driverId)).toBeNull();
    });

    it('counts accepts, declines and silence — and moves after each', async () => {
      const driverId = await seedOnlineDriver(db, { zoneId, acceptanceRate: null });

      // Accept one.
      await offerTo(bookingId, driverId);
      await offers.accept(bookingId, driverId);
      expect(await storedRate(driverId)).toBe(100);

      // Decline one: 1 of 2.
      const second = await seedSearchingBooking(db, { userId: await seedCustomer(db), zoneId });
      await offerTo(second, driverId);
      await offers.reject(second, driverId);
      expect(await storedRate(driverId)).toBe(50);

      // Ignore one: 1 of 3. Silence counts exactly as a decline does — from the
      // customer's side they are the same event.
      const third = await seedSearchingBooking(db, { userId: await seedCustomer(db), zoneId });
      await offerTo(third, driverId);
      await dispatch.expireOffer(third, driverId);
      expect(await storedRate(driverId)).toBeCloseTo(33.33, 1);
    });

    it('does NOT count a revoked offer against the driver', async () => {
      /**
       * The driver did nothing wrong — somebody else accepted first. Counting it
       * would penalise drivers for working in busy areas, where offers resolve
       * fastest and revocations are most common.
       */
      const winner = await seedOnlineDriver(db, { zoneId, metersAway: 300 });
      const loser = await seedOnlineDriver(db, { zoneId, metersAway: 400, acceptanceRate: null });
      await offerTo(bookingId, winner);
      await offerTo(bookingId, loser);

      await offers.accept(bookingId, winner);

      expect(await outcomeOf(bookingId, loser)).toBe('revoked');
      // No resolved offers in the denominator ⇒ still no signal.
      expect(await storedRate(loser)).toBeNull();
    });
  });

  describe('the driver routes', () => {
    it('accept and reject are reachable, and reject is never an error', async () => {
      const driverId = await seedOnlineDriver(db, { zoneId });
      await offerTo(bookingId, driverId);
      const auth = await driverAuthHeaderFor(app, { driverId });

      await request(app.getHttpServer())
        .get('/v1/driver/offers/current')
        .set('Authorization', auth)
        .expect(200)
        .expect((res) => expect(res.body.offer.bookingId).toBe(bookingId));

      await request(app.getHttpServer())
        .post(`/v1/jobs/${bookingId}/accept`)
        .set('Authorization', auth)
        .expect(200)
        .expect((res) => expect(res.body.job.status).toBe('assigned'));

      await request(app.getHttpServer())
        .get('/v1/driver/jobs/current')
        .set('Authorization', auth)
        .expect(200)
        .expect((res) => expect(res.body.job.bookingId).toBe(bookingId));
    });

    it('declining an already-expired offer is still a 204', async () => {
      const driverId = await seedOnlineDriver(db, { zoneId });
      await offerTo(bookingId, driverId);
      await dispatch.expireOffer(bookingId, driverId);

      await request(app.getHttpServer())
        .post(`/v1/jobs/${bookingId}/reject`)
        .set('Authorization', await driverAuthHeaderFor(app, { driverId }))
        .send({})
        .expect(204);
    });

    it('403s a driver who is not approved', async () => {
      const driverId = await seedOnlineDriver(db, { zoneId, kycStatus: 'suspended' });

      await request(app.getHttpServer())
        .post(`/v1/jobs/${bookingId}/accept`)
        .set('Authorization', await driverAuthHeaderFor(app, { driverId, kycStatus: 'suspended' }))
        .expect(403);
    });

    it('reports no offer and no job for an idle driver', async () => {
      const driverId = await seedOnlineDriver(db, { zoneId });
      const auth = await driverAuthHeaderFor(app, { driverId });

      await request(app.getHttpServer())
        .get('/v1/driver/offers/current')
        .set('Authorization', auth)
        .expect(200)
        .expect((res) => expect(res.body.offer).toBeNull());

      await request(app.getHttpServer())
        .get('/v1/driver/jobs/current')
        .set('Authorization', auth)
        .expect(200)
        .expect((res) => expect(res.body.job).toBeNull());
    });
  });
});

async function storedRate(driverId: string): Promise<number | null> {
  const [row] = await testDb()
    .select({ rate: drivers.acceptanceRate })
    .from(drivers)
    .where(eq(drivers.id, driverId));
  return row?.rate === null || row?.rate === undefined ? null : Number(row.rate);
}
