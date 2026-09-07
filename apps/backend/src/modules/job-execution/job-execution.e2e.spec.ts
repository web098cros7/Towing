import type { INestApplication } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  bookings,
  bookingStatusHistory,
  chargeConfig,
  dispatchAttempts,
  drivers,
} from '../../db/schema';
import { createTestApp, driverAuthHeaderFor } from '../../test/app';
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
import { DispatchRepo } from '../dispatch/dispatch.repo';
import { OfferService } from '../dispatch/offer.service';
import { PresenceStore } from '../driver-presence/presence-store';
import { DriverStatsService } from './driver-stats.service';
import { JobExecutionService } from './job-execution.service';

/**
 * §5.2's execution chain, end to end over real HTTP.
 *
 * WHAT CARRIES THE WEIGHT HERE, in order:
 *   1. The OTP gate. §9.2.3 says "job cannot start without a valid OTP", and a
 *      hole in it is a vehicle collected from somebody who did not consent.
 *   2. The attempt cap. A six-digit space is small; an uncapped guess loop is a
 *      guaranteed break, not a theoretical one.
 *   3. `unable` → `searching`. The one backward edge in §5.1, and the one that
 *      leaves a customer stranded if it half-works.
 *   4. Fare finalization from the SNAPSHOTTED waiting rules, not live config —
 *      §3.4's lock is the promise the whole booking rests on.
 */

let app: INestApplication;
let db: TestDatabase;
let jobs: JobExecutionService;
let offers: OfferService;
let repo: DispatchRepo;
let otpService: BookingOtpService;
let stats: DriverStatsService;
let presence: PresenceStore;

/** Drives a booking all the way to `assigned` the way a real wave would. */
async function assign(bookingId: string, driverId: string): Promise<void> {
  const booking = await repo.booking(bookingId);
  await offers.offer(
    booking!,
    { driverId, distanceMeters: 500, score: 50, fleetId: null, truckId: null },
    1,
    2,
    20,
  );
  await offers.accept(bookingId, driverId);
}

async function statusOf(bookingId: string): Promise<string | undefined> {
  const [row] = await db
    .select({ status: bookings.status })
    .from(bookings)
    .where(eq(bookings.id, bookingId));
  return row?.status;
}

async function bookingRow(bookingId: string) {
  const [row] = await db.select().from(bookings).where(eq(bookings.id, bookingId));
  return row!;
}

describe('§5.2 job execution', () => {
  let zoneId: string;
  let userId: string;
  let driverId: string;
  let bookingId: string;
  let auth: string;

  beforeAll(async () => {
    await setupTestDatabase();
    db = testDb();
    app = await createTestApp();
    jobs = app.get(JobExecutionService);
    offers = app.get(OfferService);
    repo = app.get(DispatchRepo);
    otpService = app.get(BookingOtpService);
    stats = app.get(DriverStatsService);
    presence = app.get(PresenceStore);
  });

  afterAll(async () => {
    await app.close();
    await closeTestRedis();
  });

  beforeEach(async () => {
    await truncateAll();
    await flushTestRedis();

    zoneId = await seedZone(db);
    userId = await seedCustomer(db);
    driverId = await seedOnlineDriver(db, { zoneId });
    bookingId = await seedSearchingBooking(db, { userId, zoneId });
    auth = await driverAuthHeaderFor(app, { driverId });
    await assign(bookingId, driverId);
  });

  // -- the OTP gate --------------------------------------------------------

  describe('the OTP gate (§9.2.3)', () => {
    beforeEach(async () => {
      await jobs.arrived(bookingId, driverId);
    });

    it('refuses to start without a code at all', async () => {
      await request(app.getHttpServer())
        .post(`/v1/jobs/${bookingId}/start`)
        .set('authorization', auth)
        .send({})
        .expect(422);

      expect(await statusOf(bookingId)).toBe('arrived');
    });

    it('refuses a wrong code and leaves the booking where it was', async () => {
      const response = await request(app.getHttpServer())
        .post(`/v1/jobs/${bookingId}/start`)
        .set('authorization', auth)
        .send({ otp: '000000' })
        .expect(409);

      expect(response.body.error.code).toBe('invalid_booking_otp');
      expect(await statusOf(bookingId)).toBe('arrived');
      expect(await bookingRow(bookingId).then((r) => r.otpVerified)).toBe(false);
    });

    it('starts the job on the real code and records the OTP as consumed', async () => {
      const { code } = await otpService.issue(db, bookingId);

      await request(app.getHttpServer())
        .post(`/v1/jobs/${bookingId}/start`)
        .set('authorization', auth)
        .send({ otp: code })
        .expect(200);

      const row = await bookingRow(bookingId);
      expect(row.status).toBe('in_progress');
      // `verify()` deliberately does not set this — the caller commits the
      // consequence. If this is ever false after a successful start, the flag
      // has stopped meaning anything.
      expect(row.otpVerified).toBe(true);
      expect(row.startedAt).not.toBeNull();
    });

    it('caps wrong guesses and keeps refusing after the cap, even with the right code', async () => {
      const { code } = await otpService.issue(db, bookingId);
      const max = Number(process.env.OTP_MAX_ATTEMPTS ?? 5);

      for (let i = 0; i <= max; i += 1) {
        await request(app.getHttpServer())
          .post(`/v1/jobs/${bookingId}/start`)
          .set('authorization', auth)
          .send({ otp: '111111' })
          .expect(409);
      }

      // THE ASSERTION THAT MATTERS: past the cap the CORRECT code is refused
      // too. A cap that only rejects wrong guesses is not a cap — an attacker
      // stops as soon as they are right, which is exactly the case it must stop.
      await request(app.getHttpServer())
        .post(`/v1/jobs/${bookingId}/start`)
        .set('authorization', auth)
        .send({ otp: code })
        .expect(409);

      expect(await statusOf(bookingId)).toBe('arrived');
    });

    it('tells the driver how many attempts remain without revealing anything else', async () => {
      await otpService.issue(db, bookingId);
      const response = await request(app.getHttpServer())
        .post(`/v1/jobs/${bookingId}/start`)
        .set('authorization', auth)
        .send({ otp: '222222' })
        .expect(409);

      expect(response.body.error.details.attemptsRemaining).toBeGreaterThanOrEqual(0);
      // Wrong / expired / exhausted / never-minted are one indistinguishable
      // refusal. Anything finer is an oracle against a six-digit space.
      expect(JSON.stringify(response.body)).not.toContain('expired');
    });

    it('refuses a code that has passed its window', async () => {
      await otpService.issue(db, bookingId);
      const { code } = await otpService.issue(db, bookingId);
      await db
        .update(bookings)
        .set({ otpExpiresAt: new Date(Date.now() - 1_000) })
        .where(eq(bookings.id, bookingId));

      await request(app.getHttpServer())
        .post(`/v1/jobs/${bookingId}/start`)
        .set('authorization', auth)
        .send({ otp: code })
        .expect(409);
    });
  });

  // -- the chain -----------------------------------------------------------

  describe('the §5.2 chain', () => {
    it('cannot skip arrival — a job does not start from `assigned`', async () => {
      const { code } = await otpService.issue(db, bookingId);
      await request(app.getHttpServer())
        .post(`/v1/jobs/${bookingId}/start`)
        .set('authorization', auth)
        .send({ otp: code })
        .expect(409);
    });

    it('writes a history row for every transition', async () => {
      await jobs.markEnRoute(bookingId, driverId);
      await jobs.arrived(bookingId, driverId);
      const { code } = await otpService.issue(db, bookingId);
      await jobs.start(bookingId, driverId, code);
      await jobs.complete(bookingId, driverId);

      const history = await db
        .select({ status: bookingStatusHistory.status })
        .from(bookingStatusHistory)
        .where(eq(bookingStatusHistory.bookingId, bookingId))
        .orderBy(bookingStatusHistory.createdAt);

      // NO opening `searching` row: `seedSearchingBooking` inserts the row
      // directly, and only `BookingsService.create` writes that first history
      // entry. The chain under test starts at the assignment.
      expect(history.map((row) => row.status)).toEqual([
        'assigned',
        'en_route',
        'arrived',
        'in_progress',
        'completed',
      ]);
    });

    it('lets a driver already at the pickup arrive without an en_route step', async () => {
      // The real case this exists for: a vehicle parked fifty metres away never
      // trips `EnRouteWatcher`'s 150 m threshold, so requiring `en_route` first
      // would 409 a driver standing next to the job.
      await jobs.arrived(bookingId, driverId);

      const history = await db
        .select({ status: bookingStatusHistory.status })
        .from(bookingStatusHistory)
        .where(eq(bookingStatusHistory.bookingId, bookingId))
        .orderBy(bookingStatusHistory.createdAt);

      // No fabricated `en_route` row for a journey nobody made.
      expect(history.map((row) => row.status)).toEqual(['assigned', 'arrived']);
    });

    it('refuses a driver who is not the one on the booking', async () => {
      const other = await seedOnlineDriver(db, { zoneId });
      const otherAuth = await driverAuthHeaderFor(app, { driverId: other });

      const response = await request(app.getHttpServer())
        .post(`/v1/jobs/${bookingId}/arrived`)
        .set('authorization', otherAuth)
        .send({})
        .expect(409);

      expect(response.body.error.code).toBe('not_assigned_driver');
    });

    it('refuses arrival from far away — the backstop behind §11.5 arrival assist', async () => {
      // The abuse this closes: marking arrival early starts §7.4's waiting clock,
      // so a driver five kilometres out would begin billing the customer for
      // their own drive. The client-side assist prompts at 100 m, but a prompt on
      // a screen a driver can ignore is a convenience, not a control.
      await presence.applyPing(driverId, {
        // ~9 km north of PICKUP.
        lat: 13.0516,
        lng: 77.5946,
        at: new Date().toISOString(),
        seq: 99,
        accuracyM: 10,
      });

      const response = await request(app.getHttpServer())
        .post(`/v1/jobs/${bookingId}/arrived`)
        .set('authorization', auth)
        .send({})
        .expect(409);

      expect(response.body.error.details.distanceMeters).toBeGreaterThan(5_000);
      expect(await statusOf(bookingId)).toBe('assigned');
    });

    it('allows arrival when the driver is at the pickup', async () => {
      await presence.applyPing(driverId, {
        lat: PICKUP.lat,
        lng: PICKUP.lng,
        at: new Date().toISOString(),
        seq: 99,
        accuracyM: 10,
      });

      await request(app.getHttpServer())
        .post(`/v1/jobs/${bookingId}/arrived`)
        .set('authorization', auth)
        .send({})
        .expect(200);

      expect(await statusOf(bookingId)).toBe('arrived');
    });

    it('allows arrival when the driver has no fix at all', async () => {
      // Permissive by design. A driver whose GPS has failed still has to be able
      // to finish the job; the cost of a false refusal is somebody stranded
      // beside a customer's broken vehicle, and stale fixes are already what
      // excludes a driver from NEW dispatch (§6.1).
      await request(app.getHttpServer())
        .post(`/v1/jobs/${bookingId}/arrived`)
        .set('authorization', auth)
        .send({})
        .expect(200);
    });

    it('takes a graceful 409 on a double-tapped complete rather than re-finalizing', async () => {
      await jobs.arrived(bookingId, driverId);
      const { code } = await otpService.issue(db, bookingId);
      await jobs.start(bookingId, driverId, code);

      await request(app.getHttpServer())
        .post(`/v1/jobs/${bookingId}/complete`)
        .set('authorization', auth)
        .send({})
        .expect(200);

      const total = (await bookingRow(bookingId)).total;

      await request(app.getHttpServer())
        .post(`/v1/jobs/${bookingId}/complete`)
        .set('authorization', auth)
        .send({})
        .expect(409);

      // The fare must be untouched by the second tap. This is why the machine's
      // `FOR UPDATE` + legal-transition guard is a stronger mechanism than an
      // idempotency key would have been.
      expect((await bookingRow(bookingId)).total).toBe(total);
    });
  });

  // -- fare finalization ---------------------------------------------------

  describe('§7.6 fare finalization', () => {
    async function runWithWait(waitMinutes: number): Promise<void> {
      await jobs.arrived(bookingId, driverId);
      // Backdate the arrival so the waiting window is real without a real wait.
      await db
        .update(bookings)
        .set({ arrivedAt: new Date(Date.now() - waitMinutes * 60_000) })
        .where(eq(bookings.id, bookingId));

      const { code } = await otpService.issue(db, bookingId);
      await jobs.start(bookingId, driverId, code);
      await jobs.complete(bookingId, driverId);
    }

    it('bills nothing inside the free window', async () => {
      await runWithWait(10);
      const row = await bookingRow(bookingId);
      expect(row.waitingCharge).toBe('0.00');
      expect(row.total).toBe('1200.00');
    });

    it('bills per minute past the free window and adds it to the locked total', async () => {
      // 25 minutes on site, 15 free, 10 billable at ₹5 = ₹50.
      await runWithWait(25);
      const row = await bookingRow(bookingId);
      expect(row.waitingCharge).toBe('50.00');
      expect(row.total).toBe('1250.00');
    });

    it('uses the rules SNAPSHOTTED on the booking, never live config (§3.4)', async () => {
      // The scenario this exists for: an admin doubles the waiting rate while a
      // trip is already running. The customer agreed to a rate card; they did
      // not agree to that one.
      await db
        .update(bookings)
        .set({ waitingFreeMinutes: 15, waitingPerMinute: '5.00' })
        .where(eq(bookings.id, bookingId));

      await db.update(chargeConfig).set({ waitingPerMinute: '99.00' });

      await runWithWait(25);
      const row = await bookingRow(bookingId);
      // ₹5/min, not ₹99/min.
      expect(row.waitingCharge).toBe('50.00');
    });

    it('does not touch the commission — credit happens on capture (§19.2), not completion', async () => {
      // Asserted as UNCHANGED rather than as zero. `BookingsService.create`
      // writes 0.00 and Phase 19's capture is what fills it in, but this fixture
      // seeds a realistic locked value — and the property under test is that
      // `complete` is not a writer of these columns, whatever they hold.
      const before = await bookingRow(bookingId);

      await runWithWait(0);

      const after = await bookingRow(bookingId);
      expect(after.commissionAmount).toBe(before.commissionAmount);
      expect(after.driverPayout).toBe(before.driverPayout);
      expect(after.status).toBe('completed');
    });
  });

  // -- unable to deliver ---------------------------------------------------

  describe('§9.2.3 unable to deliver', () => {
    it('puts the booking back into `searching` and clears the driver', async () => {
      const response = await request(app.getHttpServer())
        .post(`/v1/jobs/${bookingId}/unable`)
        .set('authorization', auth)
        .send({ reason: 'customer_unavailable' })
        .expect(200);

      expect(response.body.bookingId).toBe(bookingId);

      const row = await bookingRow(bookingId);
      expect(row.status).toBe('searching');
      expect(row.driverId).toBeNull();
      expect(row.truckId).toBeNull();
      expect(row.unableReason).toBe('customer_unavailable');
    });

    it('never charges the customer (§3.5)', async () => {
      await jobs.unable(bookingId, driverId, { reason: 'wrong_address' });
      const row = await bookingRow(bookingId);
      expect(row.cancellationFee).toBe('0.00');
      expect(row.cancelledBy).toBeNull();
    });

    it('clears the route so the customer is not shown a line from a driver who left', async () => {
      await db
        .update(bookings)
        .set({ routePolyline: 'abc', etaSeconds: 300, routeSource: 'haversine' })
        .where(eq(bookings.id, bookingId));

      await jobs.unable(bookingId, driverId, { reason: 'customer_refused' });

      const row = await bookingRow(bookingId);
      expect(row.routePolyline).toBeNull();
      expect(row.etaSeconds).toBeNull();
    });

    it('records the §9.4.6 audit row without disturbing the acceptance rate', async () => {
      await jobs.unable(bookingId, driverId, { reason: 'vehicle_inaccessible' });

      const attempts = await db
        .select({ outcome: dispatchAttempts.outcome })
        .from(dispatchAttempts)
        .where(
          and(
            eq(dispatchAttempts.bookingId, bookingId),
            eq(dispatchAttempts.driverId, driverId),
          ),
        );

      // Two rows, two true facts: they accepted, and they could not finish.
      // Rewriting the `accepted` row would dock the acceptance rate of somebody
      // who did accept.
      expect(attempts.map((a) => a.outcome).sort()).toEqual(['accepted', 'unable']);

      const rate = await repo.recomputeAcceptanceRate(driverId);
      expect(rate).toBe(100);
    });

    it('keeps that driver out of the next wave', async () => {
      await jobs.unable(bookingId, driverId, { reason: 'customer_unavailable' });
      const excluded = await repo.excludedDrivers(bookingId);
      expect(excluded.has(driverId)).toBe(true);
    });

    it('rejects a reason outside the §3.5 enum', async () => {
      await request(app.getHttpServer())
        .post(`/v1/jobs/${bookingId}/unable`)
        .set('authorization', auth)
        .send({ reason: 'could not be bothered' })
        .expect(422);
    });
  });

  // -- driver statistics ---------------------------------------------------

  describe('§6.2 driver statistics', () => {
    /**
     * Frees the driver before each scenario.
     *
     * The outer `beforeEach` leaves them `assigned` to `bookingId`, and §3.2's
     * one-job-at-a-time rule — `uq_bookings_one_active_per_driver`, migration
     * 0014 — refuses to assign them a second. These tests are about a driver
     * accumulating a HISTORY of jobs, so the starting condition has to be a
     * driver who is free. Cancelled rather than completed: a completion would
     * seed a trip that every count below then has to account for.
     */
    beforeEach(async () => {
      await db
        .update(bookings)
        .set({ status: 'cancelled', cancelledBy: 'customer', driverId: null })
        .where(eq(bookings.id, bookingId));
    });

    async function completeOnce(): Promise<void> {
      // A FRESH CUSTOMER EACH TIME. §3.8's `uq_bookings_one_active_per_user`
      // permits one open booking per customer, and the `beforeEach` booking is
      // still `assigned` — reusing `userId` here makes the insert fail on a
      // constraint that is doing exactly its job.
      const customer = await seedCustomer(db, `Stats Customer ${Date.now()}`);
      const id = await seedSearchingBooking(db, { userId: customer, zoneId });
      await assign(id, driverId);
      await jobs.arrived(id, driverId);
      const { code } = await otpService.issue(db, id);
      await jobs.start(id, driverId, code);
      await jobs.complete(id, driverId);
    }

    async function driverRow() {
      const [row] = await db.select().from(drivers).where(eq(drivers.id, driverId));
      return row!;
    }

    it('gives total_trips and completion_rate their first real values', async () => {
      // Both have been seeded fixtures since Phase 3 —
      // `candidate-selection.service.ts` says so in a comment. This is the test
      // that stops them being fixtures.
      //
      // `completeOnce` rather than the outer `bookingId`: this block's own
      // `beforeEach` cancels that one to free the driver, so it is not a job
      // anybody can complete.
      await completeOnce();

      const row = await driverRow();
      expect(row.totalTrips).toBe(1);
      expect(Number(row.completionRate)).toBe(100);
    });

    it('moves completion_rate down on an unable-to-deliver', async () => {
      await completeOnce();
      await completeOnce();
      await completeOnce();
      // Three completions, one failure → 75 %.
      const failCustomer = await seedCustomer(db, `Fail Customer ${Date.now()}`);
      const failing = await seedSearchingBooking(db, { userId: failCustomer, zoneId });
      await assign(failing, driverId);
      await jobs.unable(failing, driverId, { reason: 'customer_unavailable' });

      const row = await driverRow();
      expect(Number(row.completionRate)).toBe(75);
      // The failure is not a trip.
      expect(row.totalTrips).toBe(3);
    });

    it('does not penalise a driver for a CUSTOMER cancellation', async () => {
      await completeOnce();
      const cancelCustomer = await seedCustomer(db, `Cancel Customer ${Date.now()}`);
      const cancelled = await seedSearchingBooking(db, { userId: cancelCustomer, zoneId });
      await assign(cancelled, driverId);
      await db
        .update(bookings)
        .set({ status: 'cancelled', cancelledBy: 'customer' })
        .where(eq(bookings.id, cancelled));

      await stats.recompute(driverId);
      // §3.5 charges only driver cancellations and unable-to-deliver against the
      // rate. A driver working a flaky area must not be ranked down for it.
      expect(Number((await driverRow()).completionRate)).toBe(100);
    });

    it('is recomputed absolutely, so running it twice changes nothing', async () => {
      await completeOnce();
      await stats.recompute(driverId);
      const first = await driverRow();
      await stats.recompute(driverId);
      const second = await driverRow();

      expect(second.totalTrips).toBe(first.totalTrips);
      expect(second.completionRate).toBe(first.completionRate);
    });

    it('leaves completion_rate NULL for a driver with no signal', async () => {
      const fresh = await seedOnlineDriver(db, { zoneId });
      await stats.recompute(fresh);

      const [row] = await db.select().from(drivers).where(eq(drivers.id, fresh));
      // NULL, not 100. `score()` maps null to its NEUTRAL midpoint; a hard 100
      // would rank every new driver above people who have earned one.
      expect(row!.completionRate).toBeNull();
    });
  });
});
