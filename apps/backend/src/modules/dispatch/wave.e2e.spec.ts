import type { INestApplication } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { KillSwitchService } from '../../common/killswitch/killswitch.service';
import { QUEUE, type QueuePort } from '../../common/queue/queue.port';
import { bookings, dispatchAttempts, dispatchConfig } from '../../db/schema';
import { createTestApp } from '../../test/app';
import {
  seedCustomer,
  setupTestDatabase,
  testDb,
  truncateAll,
  type TestDatabase,
} from '../../test/db';
import { closeTestRedis, flushTestRedis } from '../../test/redis';
import { BookingStateMachineService } from '../bookings/booking-state-machine.service';
import { BookingsService } from '../bookings/bookings.service';
import { DispatchConfigRepo } from '../bookings/dispatch-config.repo';
import { PresenceStore } from '../driver-presence/presence-store';
import { DispatchRepo } from './dispatch.repo';
import { DispatchService } from './dispatch.service';
import { OfferService } from './offer.service';
import { seedDispatchConfig, seedOnlineDriver, seedSearchingBooking, seedZone } from './dispatch-fixtures';

/**
 * §6.4's progressive-radius wave loop.
 *
 * `runWave` IS CALLED DIRECTLY THROUGHOUT, never through BullMQ — the suite runs
 * with `QUEUE_ENABLED=false` (see `test/setup.ts`), which is exactly why the
 * engine was built as plain methods with one-line workers over them. What is
 * under test here is the LOGIC of advancing a search; `queue.e2e.spec.ts`
 * already proves the delivery semantics separately.
 */

let app: INestApplication;
let db: TestDatabase;
let dispatch: DispatchService;
let repo: DispatchRepo;

async function waveOf(bookingId: string): Promise<number | null> {
  const [row] = await db
    .select({ wave: bookings.searchWave })
    .from(bookings)
    .where(eq(bookings.id, bookingId));
  return row?.wave ?? null;
}

async function statusOf(bookingId: string): Promise<string | undefined> {
  const [row] = await db
    .select({ status: bookings.status })
    .from(bookings)
    .where(eq(bookings.id, bookingId));
  return row?.status;
}

async function attemptsFor(bookingId: string) {
  return db.select().from(dispatchAttempts).where(eq(dispatchAttempts.bookingId, bookingId));
}

describe('dispatch waves (§6.4)', () => {
  let zoneId: string;
  let userId: string;

  beforeAll(async () => {
    await setupTestDatabase();
    db = testDb();
    app = await createTestApp();
    dispatch = app.get(DispatchService);
    repo = app.get(DispatchRepo);
  });

  beforeEach(async () => {
    await truncateAll();
    await flushTestRedis();
    await app.get(DispatchConfigRepo).invalidate();
    userId = await seedCustomer(db);
  });

  afterAll(async () => {
    await app.close();
    await closeTestRedis();
  });

  describe('the ladder', () => {
    it('starts at wave 1 and offers within the first rung', async () => {
      zoneId = await seedZone(db, { dispatchConfig: { radiusLadderKm: [2, 4, 7], offersPerWave: 2 } });
      const bookingId = await seedSearchingBooking(db, { userId, zoneId });
      const near = await seedOnlineDriver(db, { zoneId, metersAway: 800 });

      await dispatch.runWave(bookingId);

      expect(await waveOf(bookingId)).toBe(1);
      const attempts = await attemptsFor(bookingId);
      expect(attempts).toHaveLength(1);
      expect(attempts[0]).toMatchObject({ driverId: near, wave: 1, outcome: 'offered' });
      expect(Number(attempts[0]!.radiusKm)).toBe(2);
    });

    it('widens on the next wave and reaches a driver the first could not', async () => {
      zoneId = await seedZone(db, { dispatchConfig: { radiusLadderKm: [2, 10], offersPerWave: 2 } });
      const bookingId = await seedSearchingBooking(db, { userId, zoneId });
      // 6 km out: outside rung 1, inside rung 2.
      const far = await seedOnlineDriver(db, { zoneId, metersAway: 6_000 });

      await dispatch.runWave(bookingId);
      expect(await attemptsFor(bookingId)).toHaveLength(0);
      expect(await waveOf(bookingId)).toBe(1);

      await dispatch.runWave(bookingId);
      const attempts = await attemptsFor(bookingId);
      expect(attempts).toHaveLength(1);
      expect(attempts[0]).toMatchObject({ driverId: far, wave: 2 });
      expect(Number(attempts[0]!.radiusKm)).toBe(10);
    });

    it('respects offersPerWave', async () => {
      zoneId = await seedZone(db, { dispatchConfig: { radiusLadderKm: [5], offersPerWave: 2 } });
      const bookingId = await seedSearchingBooking(db, { userId, zoneId });
      for (let i = 0; i < 5; i += 1) {
        await seedOnlineDriver(db, { zoneId, metersAway: 300 + i * 100 });
      }

      await dispatch.runWave(bookingId);

      expect(await attemptsFor(bookingId)).toHaveLength(2);
    });

    it('holds at the widest rung rather than giving up when the ladder runs out', async () => {
      // The ladder is a widening schedule, not a budget — the DEADLINE ends a
      // search. Waves past the last rung keep searching at the widest radius.
      zoneId = await seedZone(db, { dispatchConfig: { radiusLadderKm: [2, 4], offersPerWave: 1 } });
      const bookingId = await seedSearchingBooking(db, { userId, zoneId });

      await dispatch.runWave(bookingId);
      await dispatch.runWave(bookingId);
      await dispatch.runWave(bookingId);

      expect(await waveOf(bookingId)).toBe(3);
      expect(await statusOf(bookingId)).toBe('searching');
    });

    it('uses the WIDER Band C ladder for a long-distance booking', async () => {
      // §3.2: few drivers opt in to long hauls, so the search has to reach much
      // further from the first rung.
      zoneId = await seedZone(db, {
        dispatchConfig: { radiusLadderKm: [2], bandCRadiusLadderKm: [20], offersPerWave: 2 },
      });
      const bookingId = await seedSearchingBooking(db, { userId, zoneId, commissionBand: 'C' });
      const far = await seedOnlineDriver(db, { zoneId, metersAway: 12_000, longDistance: true });

      await dispatch.runWave(bookingId);

      const attempts = await attemptsFor(bookingId);
      expect(attempts).toHaveLength(1);
      expect(attempts[0]?.driverId).toBe(far);
      expect(Number(attempts[0]!.radiusKm)).toBe(20);
    });

    it('falls back to Phase 14 defaults for an untuned zone (NULL dispatch_config)', async () => {
      // `resolveDispatchConfig` is the only sanctioned reader of the JSONB, and
      // a NULL column must resolve to the documented defaults rather than to
      // constants inside the matcher.
      zoneId = await seedZone(db, { dispatchConfig: null });
      const bookingId = await seedSearchingBooking(db, { userId, zoneId });
      await seedOnlineDriver(db, { zoneId, metersAway: 800 });

      await dispatch.runWave(bookingId);

      const attempts = await attemptsFor(bookingId);
      // The default ladder's first rung is 2 km.
      expect(Number(attempts[0]!.radiusKm)).toBe(2);
    });
  });

  describe('the deadline', () => {
    it('is stamped once on the first wave and never extended', async () => {
      zoneId = await seedZone(db, { dispatchConfig: { maxSearchSeconds: 180 } });
      const bookingId = await seedSearchingBooking(db, { userId, zoneId });

      await dispatch.runWave(bookingId);
      const [first] = await db
        .select({ deadline: bookings.dispatchDeadlineAt })
        .from(bookings)
        .where(eq(bookings.id, bookingId));

      await dispatch.runWave(bookingId);
      const [second] = await db
        .select({ deadline: bookings.dispatchDeadlineAt })
        .from(bookings)
        .where(eq(bookings.id, bookingId));

      // A deadline that moved on every wave could never be reached — the search
      // would run forever.
      expect(second?.deadline?.getTime()).toBe(first?.deadline?.getTime());
    });

    it('terminates the search, and it binds BEFORE the ladder exhausts', async () => {
      /**
       * The arithmetic the plan asks to be explicit about: 5 rungs × 3 offers ×
       * 20 s is 300 s against a ~180 s deadline. The ladder never gets to run
       * out in the default configuration — the clock is the real terminator.
       */
      zoneId = await seedZone(db, {
        dispatchConfig: { radiusLadderKm: [2, 4, 7, 10, 15], maxSearchSeconds: 180 },
      });
      const bookingId = await seedSearchingBooking(db, { userId, zoneId });

      await dispatch.runWave(bookingId);
      // Wind the clock past the deadline rather than waiting three minutes.
      await db
        .update(bookings)
        .set({ dispatchDeadlineAt: new Date(Date.now() - 1_000) })
        .where(eq(bookings.id, bookingId));

      await dispatch.runWave(bookingId);

      expect(await statusOf(bookingId)).toBe('no_drivers_found');
      // Still on rung 1 of 5 — the deadline, not the ladder, ended it.
      expect(await waveOf(bookingId)).toBe(1);
    });

    it('leaves no_drivers_found non-terminal so §9.1.6 can retry on the same booking', async () => {
      // Re-entering the search on the SAME booking preserves the fare locked at
      // confirm; a new booking would re-quote the customer, possibly at a higher
      // surge, for the platform's own failure to find anyone.
      zoneId = await seedZone(db);
      const bookingId = await seedSearchingBooking(db, { userId, zoneId });
      await dispatch.runWave(bookingId);
      await db
        .update(bookings)
        .set({ dispatchDeadlineAt: new Date(Date.now() - 1_000) })
        .where(eq(bookings.id, bookingId));
      await dispatch.runWave(bookingId);
      expect(await statusOf(bookingId)).toBe('no_drivers_found');

      expect(BookingStateMachineService.isLegal('no_drivers_found', 'searching')).toBe(true);
    });
  });

  describe('durability — §19.7 as a test', () => {
    it('resumes at the stored wave with the stored exclusions after a lost worker', async () => {
      /**
       * §19.7's game day: kill the worker mid-search and assert the search
       * continues at the correct rung with the correct exclusions.
       *
       * A literal worker kill is impossible with `QUEUE_ENABLED=false`, and it
       * would be testing BullMQ rather than this engine. What actually matters
       * is the PROPERTY the kill would expose: all the state a resumed search
       * needs is durable, so a fresh `runWave` on a cold process behaves exactly
       * as the next scheduled one would. That is what this asserts.
       */
      zoneId = await seedZone(db, { dispatchConfig: { radiusLadderKm: [2, 4, 7], offersPerWave: 1 } });
      const bookingId = await seedSearchingBooking(db, { userId, zoneId });
      const first = await seedOnlineDriver(db, { zoneId, metersAway: 500 });
      const second = await seedOnlineDriver(db, { zoneId, metersAway: 900 });

      await dispatch.runWave(bookingId);
      expect(await waveOf(bookingId)).toBe(1);

      // The "crash": nothing in memory survives, and neither does the lock.
      await app.get(PresenceStore).releaseSearchLock(bookingId);

      await dispatch.runWave(bookingId);

      // Resumed at wave 2, not restarted at wave 1...
      expect(await waveOf(bookingId)).toBe(2);
      const attempts = await attemptsFor(bookingId);
      // ...and the wave-1 driver was NOT asked again.
      expect(attempts).toHaveLength(2);
      expect(attempts.map((a) => a.driverId).sort()).toEqual([first, second].sort());
      expect(attempts.map((a) => a.wave).sort()).toEqual([1, 2]);
    });

    it('a second worker running the same wave concurrently is a no-op', async () => {
      // The per-booking search lock. Two workers advancing one search would
      // double its offers and burn the exclusion set twice as fast.
      zoneId = await seedZone(db, { dispatchConfig: { radiusLadderKm: [5], offersPerWave: 3 } });
      const bookingId = await seedSearchingBooking(db, { userId, zoneId });
      for (let i = 0; i < 3; i += 1) {
        await seedOnlineDriver(db, { zoneId, metersAway: 300 + i * 100 });
      }

      await Promise.all([dispatch.runWave(bookingId), dispatch.runWave(bookingId)]);

      expect(await waveOf(bookingId)).toBe(1);
      expect(await attemptsFor(bookingId)).toHaveLength(3);
    });
  });

  describe('states that stop a search', () => {
    it('does nothing for a booking that is no longer searching', async () => {
      // Delayed jobs outlive the state that scheduled them. This is the ordinary
      // way a search stops, not an error.
      zoneId = await seedZone(db);
      const bookingId = await seedSearchingBooking(db, { userId, zoneId });
      await seedOnlineDriver(db, { zoneId });
      await db.update(bookings).set({ status: 'cancelled' }).where(eq(bookings.id, bookingId));

      await dispatch.runWave(bookingId);

      expect(await attemptsFor(bookingId)).toHaveLength(0);
    });

    it('holds a scheduled booking until its pickup time', async () => {
      zoneId = await seedZone(db);
      const bookingId = await seedSearchingBooking(db, {
        userId,
        zoneId,
        scheduledAt: new Date(Date.now() + 3_600_000),
      });
      await seedOnlineDriver(db, { zoneId });

      await dispatch.runWave(bookingId);

      // §9.1.5: still `searching` — §5.1 has no scheduled state — but nobody is
      // offered tomorrow's tow today.
      expect(await attemptsFor(bookingId)).toHaveLength(0);
      expect(await waveOf(bookingId)).toBeNull();
    });

    it('holds a booking whose zone an operator paused (§19.8)', async () => {
      zoneId = await seedZone(db);
      const bookingId = await seedSearchingBooking(db, { userId, zoneId });
      await seedOnlineDriver(db, { zoneId });
      await app.get(KillSwitchService).setPausedZones([zoneId]);

      await dispatch.runWave(bookingId);

      // Held, NOT failed. A pause is an operator's temporary decision, and a
      // customer whose search it killed would have to re-book at whatever surge
      // applies afterwards.
      expect(await attemptsFor(bookingId)).toHaveLength(0);
      expect(await statusOf(bookingId)).toBe('searching');

      await app.get(KillSwitchService).setPausedZones([]);
      await dispatch.runWave(bookingId);
      expect(await attemptsFor(bookingId)).toHaveLength(1);
    });

    it('holds a Band C booking when long-distance offers are switched off', async () => {
      zoneId = await seedZone(db);
      const bookingId = await seedSearchingBooking(db, { userId, zoneId, commissionBand: 'C' });
      await seedOnlineDriver(db, { zoneId, longDistance: true });
      await app.get(KillSwitchService).setLongDistanceDisabled(true);

      await dispatch.runWave(bookingId);
      expect(await attemptsFor(bookingId)).toHaveLength(0);

      // ...while an ordinary booking in the same zone is unaffected.
      const ordinary = await seedSearchingBooking(db, { userId: await seedCustomer(db), zoneId });
      await dispatch.runWave(ordinary);
      expect(await attemptsFor(ordinary)).toHaveLength(1);

      await app.get(KillSwitchService).setLongDistanceDisabled(false);
    });
  });

  describe('§6.5 re-dispatch', () => {
    it('resumes at the stored wave rather than restarting at 2 km', async () => {
      // A customer whose driver dropped out four minutes in must not be sent
      // back to the start of the ladder for someone else's decision.
      zoneId = await seedZone(db, { dispatchConfig: { radiusLadderKm: [2, 4, 7], offersPerWave: 1 } });
      const bookingId = await seedSearchingBooking(db, { userId, zoneId });
      const first = await seedOnlineDriver(db, { zoneId, metersAway: 500 });

      await dispatch.runWave(bookingId);
      await app.get(OfferService).reject(bookingId, first);
      await dispatch.runWave(bookingId);
      expect(await waveOf(bookingId)).toBe(2);

      await dispatch.redispatch(bookingId, 'driver_cancelled');

      // Wave preserved...
      expect(await waveOf(bookingId)).toBe(2);
      // ...and the deadline extended, because the customer already spent one
      // full search through no fault of their own.
      const [row] = await db
        .select({ deadline: bookings.dispatchDeadlineAt })
        .from(bookings)
        .where(eq(bookings.id, bookingId));
      expect(row!.deadline!.getTime()).toBeGreaterThan(Date.now());
    });

    it('never re-offers to a driver already asked about this booking', async () => {
      zoneId = await seedZone(db, { dispatchConfig: { radiusLadderKm: [10], offersPerWave: 3 } });
      const bookingId = await seedSearchingBooking(db, { userId, zoneId });
      const only = await seedOnlineDriver(db, { zoneId, metersAway: 500 });

      await dispatch.runWave(bookingId);
      await app.get(OfferService).reject(bookingId, only);
      await dispatch.redispatch(bookingId, 'driver_cancelled');
      await dispatch.runWave(bookingId);

      // One attempt total — the exclusion set held across the re-dispatch.
      expect(await attemptsFor(bookingId)).toHaveLength(1);
    });

    it('W12: `redispatchPriority` decides whether it jumps the queue or waits a cadence', async () => {
      zoneId = await seedZone(db, {
        dispatchConfig: { radiusLadderKm: [2, 4, 7], offersPerWave: 1, offerTimeoutSeconds: 20 },
      });
      const bookingId = await seedSearchingBooking(db, { userId, zoneId });
      const queue = app.get<QueuePort>(QUEUE);
      const spy = vi.spyOn(queue, 'enqueue');

      // The default — §6.5 as shipped: delay 0, because the customer has already
      // spent one full search through no fault of their own.
      await dispatch.redispatch(bookingId, 'driver_cancelled');
      expect(spy).toHaveBeenCalledWith(
        'dispatch.search',
        { bookingId },
        expect.objectContaining({ delayMs: 0 }),
      );

      await seedDispatchConfig(db, { redispatchPriority: 'normal' });
      await app.get(DispatchConfigRepo).invalidate();
      spy.mockClear();

      // `normal` schedules it like any other wave: one offer countdown away.
      await dispatch.redispatch(bookingId, 'driver_cancelled');
      expect(spy).toHaveBeenCalledWith(
        'dispatch.search',
        { bookingId },
        expect.objectContaining({ delayMs: 20_000 }),
      );

      spy.mockRestore();
    });
  });

  describe('the empty-wave rule', () => {
    it('advances IMMEDIATELY when a wave offered to nobody', async () => {
      /**
       * §6.4. Waiting out a twenty-second offer timeout that nobody is holding
       * would burn an eighth of the entire search deadline on nothing — and at
       * wave 1 in a quiet zone that is the common case, not the edge case.
       *
       * Asserted through `runWave`'s return value because the re-enqueue itself
       * is a no-op under `QUEUE_ENABLED=false`.
       */
      zoneId = await seedZone(db, { dispatchConfig: { radiusLadderKm: [2, 4], offerTimeoutSeconds: 20 } });
      const bookingId = await seedSearchingBooking(db, { userId, zoneId });
      // No drivers at all.

      const outcome = await dispatch.runWave(bookingId);

      expect(outcome).toMatchObject({ ran: true, offered: 0 });
      /**
       * FAST, BUT NOT ZERO — and this assertion is the scar from a real bug.
       *
       * The first implementation used 0, which re-enqueues instantly and spins:
       * `pnpm bench:dispatch` drove a booking to wave 3992 in under two minutes.
       * An earlier version of this very test asserted `nextDelayMs: 0` and
       * passed throughout, because a unit test cannot see a hot loop. The bound
       * below is what it should have been asserting: fast enough to walk the
       * ladder in seconds, slow enough that the process yields.
       */
      const { nextDelayMs } = outcome as { nextDelayMs: number };
      expect(nextDelayMs).toBeGreaterThan(0);
      expect(nextDelayMs).toBeLessThan(5_000);
    });

    it('waits the offer timeout when it DID offer to someone', async () => {
      zoneId = await seedZone(db, { dispatchConfig: { radiusLadderKm: [5], offerTimeoutSeconds: 20 } });
      const bookingId = await seedSearchingBooking(db, { userId, zoneId });
      await seedOnlineDriver(db, { zoneId, metersAway: 500 });

      const outcome = await dispatch.runWave(bookingId);

      expect(outcome).toMatchObject({ ran: true, offered: 1, nextDelayMs: 20_000 });
    });

    it('reports every non-running outcome distinctly', async () => {
      // Each of these is a different operational situation, and collapsing them
      // into "nothing happened" is how a paused zone gets mistaken for an empty
      // one during an incident.
      zoneId = await seedZone(db);
      const bookingId = await seedSearchingBooking(db, { userId, zoneId });

      await db.update(bookings).set({ status: 'cancelled' }).where(eq(bookings.id, bookingId));
      expect(await dispatch.runWave(bookingId)).toMatchObject({
        ran: false,
        reason: 'not_searching',
      });

      expect(await dispatch.runWave('00000000-0000-4000-8000-000000000000')).toMatchObject({
        ran: false,
        reason: 'unknown_booking',
      });
    });
  });

  describe('§9.1.6 retry / widen', () => {
    it('re-enters the search on the SAME booking, preserving the locked fare', async () => {
      zoneId = await seedZone(db);
      const bookingId = await seedSearchingBooking(db, { userId, zoneId, total: '1200.00' });
      await dispatch.runWave(bookingId);
      await db
        .update(bookings)
        .set({ dispatchDeadlineAt: new Date(Date.now() - 1_000) })
        .where(eq(bookings.id, bookingId));
      await dispatch.runWave(bookingId);
      expect(await statusOf(bookingId)).toBe('no_drivers_found');

      await app.get(BookingsService).retrySearch(userId, bookingId);

      expect(await statusOf(bookingId)).toBe('searching');
      // The wave RESETS here, unlike §6.5's re-dispatch: the ladder was already
      // exhausted, so resuming from the widest rung would just repeat it.
      expect(await waveOf(bookingId)).toBeNull();

      const [row] = await db
        .select({ total: bookings.total, deadline: bookings.dispatchDeadlineAt })
        .from(bookings)
        .where(eq(bookings.id, bookingId));
      // A new booking would have re-quoted the customer for the platform's own
      // failure to find anyone. This is why `no_drivers_found` is not terminal.
      expect(row?.total).toBe('1200.00');
      expect(row?.deadline).toBeNull();
    });

    it('does NOT clear the exclusion set', async () => {
      // Every driver in `dispatch_attempts` already declined or ignored this
      // booking. Asking them again immediately is how a retry produces the same
      // empty result, more slowly.
      zoneId = await seedZone(db, { dispatchConfig: { radiusLadderKm: [10], offersPerWave: 3 } });
      const bookingId = await seedSearchingBooking(db, { userId, zoneId });
      const only = await seedOnlineDriver(db, { zoneId, metersAway: 500 });

      await dispatch.runWave(bookingId);
      await app.get(OfferService).reject(bookingId, only);
      await db
        .update(bookings)
        .set({ dispatchDeadlineAt: new Date(Date.now() - 1_000) })
        .where(eq(bookings.id, bookingId));
      await dispatch.runWave(bookingId);

      await app.get(BookingsService).retrySearch(userId, bookingId);
      await dispatch.runWave(bookingId);

      expect(await attemptsFor(bookingId)).toHaveLength(1);
    });
  });

  it('reports honest progress the customer poll can read', async () => {
    zoneId = await seedZone(db, { dispatchConfig: { radiusLadderKm: [2, 9], offersPerWave: 2 } });
    const bookingId = await seedSearchingBooking(db, { userId, zoneId });
    await seedOnlineDriver(db, { zoneId, metersAway: 700 });
    await seedOnlineDriver(db, { zoneId, metersAway: 800 });

    await dispatch.runWave(bookingId);

    expect(await repo.driversContacted(bookingId)).toBe(2);
    expect(await waveOf(bookingId)).toBe(1);
  });
});
