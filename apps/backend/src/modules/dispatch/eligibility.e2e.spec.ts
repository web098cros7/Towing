import type { INestApplication } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { drivers, driverZoneRestrictions, fleets, fleetTrucks } from '../../db/schema';
import { createTestApp } from '../../test/app';
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
import { closeTestRedis, flushTestRedis } from '../../test/redis';
import { DispatchConfigRepo } from '../bookings/dispatch-config.repo';
import { PresenceStore } from '../driver-presence/presence-store';
import { CandidateSelectionService } from './candidate-selection.service';
import { DispatchRepo } from './dispatch.repo';
import {
  evictFromCandidateStore,
  putInCandidateStore,
  seedDispatchConfig,
  seedOnlineDriver,
  seedSearchingBooking,
  seedZone,
  PICKUP,
} from './dispatch-fixtures';

/**
 * §3.2's eligibility filter and §6.2's scorer.
 *
 * THE JOIN POINT FIVE PHASES CONVERGE ON. Each exclusion below is asserted
 * INDEPENDENTLY — one driver who fails exactly one rule, with every other rule
 * satisfied — because a filter tested only in aggregate passes just as happily
 * when two of its clauses are wrong in opposite directions.
 */

let app: INestApplication;
let db: TestDatabase;
let selection: CandidateSelectionService;
let repo: DispatchRepo;

/** Selects for a standard flatbed Band A booking at `PICKUP`. */
async function selectFor(
  bookingId: string,
  radiusKm = 5,
  limit = 3,
): ReturnType<CandidateSelectionService['select']> {
  const booking = await repo.booking(bookingId);
  return selection.select(booking!, radiusKm, limit);
}

describe('dispatch eligibility (§3.2) and scoring (§6.2)', () => {
  let zoneId: string;
  let userId: string;
  let bookingId: string;

  beforeAll(async () => {
    await setupTestDatabase();
    db = testDb();
    app = await createTestApp();
    selection = app.get(CandidateSelectionService);
    repo = app.get(DispatchRepo);
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

  it('offers an eligible driver', async () => {
    const driverId = await seedOnlineDriver(db, { zoneId });

    const result = await selectFor(bookingId);

    expect(result.candidates.map((c) => c.driverId)).toEqual([driverId]);
    expect(result.degraded).toBe(false);
  });

  describe('each §3.2 rule, in isolation', () => {
    it('excludes a driver whose KYC is not approved', async () => {
      // §3.1 layer 4. Redis said approved when they went online; an admin may
      // have suspended them since, and the hot hash outlives that by 30 s.
      const driverId = await seedOnlineDriver(db, { zoneId, kycStatus: 'suspended' });
      // The hash is written by `seedOnlineDriver` regardless, which is exactly
      // the state this rule exists to catch.
      expect((await selectFor(bookingId)).candidates).toEqual([]);
      expect((await selectFor(bookingId)).excluded.not_approved?.count).toBe(1);
      expect(driverId).toBeTruthy();
    });

    it('excludes a driver who has gone offline', async () => {
      await seedOnlineDriver(db, { zoneId, isOnline: false });
      expect((await selectFor(bookingId)).excluded.offline?.count).toBe(1);
    });

    it('excludes a suspended fleet\'s drivers, whatever they look like', async () => {
      // A15: the fleet counterpart of `not_approved`. Approved, online, right
      // class — excluded on the fleet row alone.
      const fleet = await seedFleet(db, 'Suspended Fleet');
      await seedOnlineDriver(db, { zoneId, fleetId: fleet.fleetId });
      await db.update(fleets).set({ status: 'suspended' }).where(eq(fleets.id, fleet.fleetId));

      expect((await selectFor(bookingId)).candidates).toEqual([]);
      expect((await selectFor(bookingId)).excluded.fleet_suspended?.count).toBe(1);
    });

    it('excludes a driver whose vehicle class cannot take the job', async () => {
      // A wheel-lift cannot carry a flatbed job. The class decides the
      // equipment, and equipment is not a preference.
      await seedOnlineDriver(db, { zoneId, vehicleClass: 'wheel_lift' });
      expect((await selectFor(bookingId)).excluded.wrong_vehicle_class?.count).toBe(1);
    });

    it('excludes a driver who has not opted in to Band C', async () => {
      // §3.2: a long haul needs a WILLING driver, not a pricier plan.
      const longHaul = await seedSearchingBooking(db, {
        userId: await seedCustomer(db),
        zoneId,
        commissionBand: 'C',
      });
      await seedOnlineDriver(db, { zoneId, longDistance: false });

      expect((await selectFor(longHaul)).excluded.no_long_distance?.count).toBe(1);
    });

    it('offers a Band C job to a driver who HAS opted in', async () => {
      const longHaul = await seedSearchingBooking(db, {
        userId: await seedCustomer(db),
        zoneId,
        commissionBand: 'C',
      });
      const driverId = await seedOnlineDriver(db, { zoneId, longDistance: true });

      expect((await selectFor(longHaul)).candidates.map((c) => c.driverId)).toEqual([driverId]);
    });

    it('excludes a driver blocked from the booking zone (W6 §6.10)', async () => {
      // Restrictions are a DENYLIST: a row for (driver, zone) is "no offers in
      // this zone". The driver is otherwise fully eligible — this filter is the
      // only place the block bites, and the live map keeps drawing them.
      const driverId = await seedOnlineDriver(db, { zoneId });
      await db.insert(driverZoneRestrictions).values({ driverId, zoneId });

      expect((await selectFor(bookingId)).candidates).toEqual([]);
      expect((await selectFor(bookingId)).excluded.zone_restricted?.count).toBe(1);
    });

    it('offers that same driver a booking in a zone they are not blocked from', async () => {
      // The block is scoped to its zone, not to the driver: a row for another
      // zone must not leak into this booking's decision.
      const driverId = await seedOnlineDriver(db, { zoneId });
      const otherZone = await seedZone(db);
      await db.insert(driverZoneRestrictions).values({ driverId, zoneId: otherZone });

      expect((await selectFor(bookingId)).candidates.map((c) => c.driverId)).toEqual([driverId]);
    });

    it('excludes a driver whose truck is non_compliant', async () => {
      // Phase 4's exclusion status, reached for the first time by dispatch.
      const { fleetId } = await seedFleet(db, 'Compliance Fleet');
      const truckId = await seedTruck(db, fleetId);
      await db
        .update(fleetTrucks)
        .set({ status: 'non_compliant' })
        .where(eq(fleetTrucks.id, truckId));

      await seedOnlineDriver(db, { zoneId, fleetId, truckId });

      expect((await selectFor(bookingId)).excluded.truck_non_compliant?.count).toBe(1);
    });

    it('does NOT exclude an independent driver, who has no truck to be compliant', async () => {
      // `fleet_id` null and no `assigned_truck_id` is exactly what Phase 12's
      // self-signup creates. A LEFT join makes `truckStatus` null, and null must
      // pass rather than fail for having nothing to check.
      const driverId = await seedOnlineDriver(db, { zoneId, fleetId: null, truckId: null });
      expect((await selectFor(bookingId)).candidates.map((c) => c.driverId)).toEqual([driverId]);
    });

    it('excludes a driver already on an active job', async () => {
      const driverId = await seedOnlineDriver(db, { zoneId });
      await seedBooking(db, {
        userId: await seedCustomer(db),
        driverId,
        status: 'en_route',
      });

      expect((await selectFor(bookingId)).excluded.already_on_job?.count).toBe(1);
    });

    it('does not exclude a driver whose only job is finished', async () => {
      const driverId = await seedOnlineDriver(db, { zoneId });
      await seedBooking(db, { userId: await seedCustomer(db), driverId, status: 'paid' });

      expect((await selectFor(bookingId)).candidates.map((c) => c.driverId)).toEqual([driverId]);
    });

    it('excludes a driver already offered THIS booking (§6.5)', async () => {
      // Silence is not a reason to ask again three minutes later on a wider
      // radius — it is a reason to stop asking. Re-offering costs another
      // twenty seconds of the customer's deadline for the same silence.
      const driverId = await seedOnlineDriver(db, { zoneId });
      await repo.recordOffer({ bookingId, driverId, wave: 1, radiusKm: 2 });

      expect((await selectFor(bookingId)).excluded.already_offered?.count).toBe(1);
    });

    it('excludes a driver holding an offer on a DIFFERENT booking', async () => {
      // The offer lock. One driver, two countdowns, two customers is the state
      // it exists to make impossible.
      const driverId = await seedOnlineDriver(db, { zoneId });
      // Taken through the store the engine itself uses, so the fixture and the
      // production path cannot disagree about the key.
      await app.get(PresenceStore).takeOfferLock(driverId, 20_000);

      expect((await selectFor(bookingId)).excluded.holds_offer?.count).toBe(1);
    });

    it('excludes a driver outside the radius', async () => {
      await seedOnlineDriver(db, { zoneId, metersAway: 9_000 });
      expect((await selectFor(bookingId, 5)).candidates).toEqual([]);
      // ...and includes them once the ladder widens far enough to reach.
      expect((await selectFor(bookingId, 15)).candidates).toHaveLength(1);
    });

    it('excludes a driver whose ping has gone stale (§6.1)', async () => {
      // The liveness rule Phase 16 built. A frozen GPS dot must never receive a
      // job — offering to it burns a whole twenty-second wave on silence.
      await seedOnlineDriver(db, { zoneId, pingAgeMs: 60_000 });
      expect((await selectFor(bookingId)).candidates).toEqual([]);
    });
  });

  describe('§6.2 scoring', () => {
    it('ranks the nearer driver first, all else equal', async () => {
      const near = await seedOnlineDriver(db, { zoneId, metersAway: 400 });
      const far = await seedOnlineDriver(db, { zoneId, metersAway: 4_000 });

      const result = await selectFor(bookingId);

      expect(result.candidates.map((c) => c.driverId)).toEqual([near, far]);
    });

    it('lets a better-rated driver beat a nearer one when the weights say so', async () => {
      // Proximity is 60 % by default and would win. Flipping the weights proves
      // the scorer READS them rather than hard-coding the §6.2 defaults — which
      // is the whole reason Phase 14 created the table a phase early.
      await seedDispatchConfig(db, {
        weightProximity: '10.00',
        weightRating: '70.00',
        weightAcceptance: '10.00',
        weightCompletion: '10.00',
      });
      await app.get(DispatchConfigRepo).invalidate();

      const nearButPoor = await seedOnlineDriver(db, {
        zoneId,
        metersAway: 300,
        rating: '2.0',
        acceptanceRate: '50.00',
        completionRate: '50.00',
      });
      const farButGreat = await seedOnlineDriver(db, {
        zoneId,
        metersAway: 3_000,
        rating: '5.0',
        acceptanceRate: '50.00',
        completionRate: '50.00',
      });

      const result = await selectFor(bookingId);

      expect(result.candidates[0]?.driverId).toBe(farButGreat);
      expect(result.candidates[1]?.driverId).toBe(nearButPoor);
    });

    it('treats an absent signal as neutral, not as zero', async () => {
      // The cold-start trap: scoring a null rating as 0 would rank every new
      // driver last forever and make the marketplace impossible to join.
      await seedDispatchConfig(db, {
        weightProximity: '0.00',
        weightRating: '100.00',
        weightAcceptance: '0.00',
        weightCompletion: '0.00',
      });
      await app.get(DispatchConfigRepo).invalidate();

      const brandNew = await seedOnlineDriver(db, { zoneId, metersAway: 300, rating: null });
      const poorlyRated = await seedOnlineDriver(db, { zoneId, metersAway: 300, rating: '1.0' });

      const result = await selectFor(bookingId);

      // Neutral (0.5) beats 1.0/5 = 0.2.
      expect(result.candidates[0]?.driverId).toBe(brandNew);
      expect(result.candidates[1]?.driverId).toBe(poorlyRated);
    });

    it('honours the wave size — never offers to more drivers than configured', async () => {
      for (let i = 0; i < 6; i += 1) {
        await seedOnlineDriver(db, { zoneId, metersAway: 300 + i * 100 });
      }

      expect((await selectFor(bookingId, 5, 3)).candidates).toHaveLength(3);
    });
  });

  describe('§19.2 — the PostGIS rung', () => {
    it('finds the same driver through PostGIS when Redis has nothing', async () => {
      const driverId = await seedOnlineDriver(db, { zoneId, metersAway: 600 });
      // Redis emptied, Postgres intact — a flushed cache, or an outage.
      await evictFromCandidateStore(driverId, zoneId);

      const booking = await repo.booking(bookingId);
      // `zoneId: null` is how the ladder reaches PostGIS: with no zone there is
      // no GEO set to search, which is the same code path a Redis failure takes.
      const result = await selection.select({ ...booking!, zoneId: null }, 5, 3);

      expect(result.degraded).toBe(true);
      expect(result.candidates.map((c) => c.driverId)).toEqual([driverId]);
    });

    it('applies the SAME eligibility rules on the degraded rung', async () => {
      /**
       * Asserted on VEHICLE CLASS specifically, and the choice matters.
       *
       * `candidatesNear` pre-filters approval, online state and ping freshness
       * in its own WHERE — so a suspended driver never comes back from PostGIS
       * at all, and asserting on `not_approved` would pass without the
       * eligibility filter running even once. Vehicle class is NOT in that SQL,
       * so it can only be excluded by the shared filter — which is exactly the
       * property this test exists to prove.
       */
      const wrongClass = await seedOnlineDriver(db, { zoneId, vehicleClass: 'wheel_lift' });
      await evictFromCandidateStore(wrongClass, zoneId);

      const booking = await repo.booking(bookingId);
      const result = await selection.select({ ...booking!, zoneId: null }, 5, 3);

      expect(result.degraded).toBe(true);
      expect(result.candidates).toEqual([]);
      expect(result.excluded.wrong_vehicle_class?.count).toBe(1);
    });

    it('never surfaces an unapproved driver on the degraded rung either', async () => {
      // The other half: the PostGIS query's own WHERE is the §3.1 gate on this
      // rung, so the driver is not merely unranked — they are never returned.
      const suspended = await seedOnlineDriver(db, { zoneId, kycStatus: 'suspended' });
      await evictFromCandidateStore(suspended, zoneId);

      const booking = await repo.booking(bookingId);
      const result = await selection.select({ ...booking!, zoneId: null }, 5, 3);

      expect(result.candidates).toEqual([]);
      expect(result.considered).toBe(0);
    });

    it('applies the freshness bound on the degraded rung too', async () => {
      const stale = await seedOnlineDriver(db, { zoneId, pingAgeMs: 120_000 });
      await evictFromCandidateStore(stale, zoneId);

      const booking = await repo.booking(bookingId);
      const result = await selection.select({ ...booking!, zoneId: null }, 5, 3);

      expect(result.candidates).toEqual([]);
    });
  });

  it('re-admits a driver to the candidate store after a fresh ping', async () => {
    // Guards the fixture itself: a stale driver excluded above must come back
    // once they report again, or the liveness test would pass for the wrong
    // reason (a driver who was never in the store at all).
    const driverId = await seedOnlineDriver(db, { zoneId, pingAgeMs: 60_000 });
    expect((await selectFor(bookingId)).candidates).toEqual([]);

    await putInCandidateStore(driverId, zoneId, PICKUP.lng + 0.004, 0);
    await db.update(drivers).set({ lastPingAt: new Date() }).where(eq(drivers.id, driverId));

    expect((await selectFor(bookingId)).candidates.map((c) => c.driverId)).toEqual([driverId]);
  });
});
