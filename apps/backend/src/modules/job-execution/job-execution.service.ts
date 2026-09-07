import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import {
  ErrorCodes,
  paiseToRupeeString,
  rupeeStringToPaise,
  type CallContact,
  type DriverJob,
  type JobStatus,
  type JobUnable,
  type JobUnableResponse,
} from '@towing/api-contracts';
import { eq } from 'drizzle-orm';
import { ApiException } from '../../common/errors/api-exception';
import { NotificationService } from '../../common/notifications/notification.service';
import { TELEPHONY, type TelephonyPort } from '../../common/telephony/telephony.port';
import { ENV, type Env } from '../../config/env';
import { DB, type Database } from '../../db/db.module';
import { bookings } from '../../db/schema';
import { BookingOtpService } from '../bookings/booking-otp.service';
import { BookingStateMachineService } from '../bookings/booking-state-machine.service';
import { CustomerGateway } from '../bookings/customer.gateway';
import { DispatchRepo } from '../dispatch/dispatch.repo';
import { DispatchService } from '../dispatch/dispatch.service';
import { LocationFlushService } from '../driver-presence/location-flush.service';
import { PresenceStore } from '../driver-presence/presence-store';
import { OfferService } from '../dispatch/offer.service';
import { haversineMeters, waitingChargePaise } from '../pricing/pricing.math';
import { AssignmentCacheService } from '../tracking/assignment-cache.service';
import { EtaService } from '../tracking/eta.service';
import { TrackingRepo } from '../tracking/tracking.repo';
import { JobExecutionRepo, type JobRow } from './job-execution.repo';
import { DriverStatsService } from './driver-stats.service';

/**
 * §5.2's driver job machine — `arrived → otp_verified(started) → completed`,
 * with `unable_to_deliver` as the branch out.
 *
 * EVERY METHOD HAS THE SAME SHAPE, and it is the shape `OfferService.accept`
 * established in Phase 17:
 *
 *   1. Read and authorise OUTSIDE the transaction, to fail fast on the common
 *      case (a stale screen).
 *   2. One transaction: `BookingStateMachineService.transition` with a `patch`
 *      that writes this step's columns in the SAME UPDATE. The machine is the
 *      only thing allowed to write `bookings.status`, it takes the caller's `tx`,
 *      and it locks the row `FOR UPDATE` — so two taps on `Complete` serialise
 *      and the second takes a graceful 409 rather than double-finalizing a fare.
 *   3. Everything else AFTER the commit — sockets, notifications, statistics,
 *      re-dispatch. A push about an arrival that then rolled back is worse than
 *      a late one, and none of those failures may undo a committed transition.
 *
 * THE CUSTOMER-FACING BROADCAST IS NOT IN THE MACHINE. `announce()` tells the
 * FLEET console; `CustomerGateway.emitBookingStatus` tells the customer. Phase 17
 * called both by hand from `afterAssign` for the same reason: the machine has no
 * business knowing which audiences a particular transition matters to.
 */
/**
 * How far from the pickup a driver may be and still mark arrival.
 *
 * MUCH LOOSER THAN §11.5's 100 m arrival assist, on purpose. The assist is a
 * prompt — "Mark arrived?" — and wants to fire only when the driver has clearly
 * stopped at the right place. This is a refusal, and a refusal that is wrong
 * strands a driver standing next to a customer's broken vehicle. Half a
 * kilometre absorbs a pin dropped on the wrong side of a building, a service
 * road, a multi-storey car park and an urban GPS fix, while still making a
 * five-kilometre early tap impossible.
 */
const ARRIVAL_RADIUS_METERS = 500;

@Injectable()
export class JobExecutionService {
  private readonly logger = new Logger(JobExecutionService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(ENV) private readonly env: Env,
    @Inject(TELEPHONY) private readonly telephony: TelephonyPort,
    private readonly repo: JobExecutionRepo,
    private readonly machine: BookingStateMachineService,
    private readonly otp: BookingOtpService,
    private readonly customerGateway: CustomerGateway,
    private readonly notifications: NotificationService,
    private readonly stats: DriverStatsService,
    private readonly dispatch: DispatchService,
    private readonly dispatchRepo: DispatchRepo,
    private readonly offers: OfferService,
    private readonly eta: EtaService,
    private readonly tracking: TrackingRepo,
    private readonly assignments: AssignmentCacheService,
    private readonly flush: LocationFlushService,
    private readonly presence: PresenceStore,
  ) {}

  /**
   * §5.1's "driver moves" edge, fired by the location pipeline rather than by a
   * route.
   *
   * NOT AN ENDPOINT, AND THAT IS THE INTERESTING DECISION. §5.2's chain has an
   * `arriving` step between accept and arrive, and the plan's route list is
   * `{arrived, start, complete, unable}` — four, not five. A driver does not tap
   * "I have set off"; they set off. So the transition is derived from the fact
   * that produces it, which is the driver's own position moving away from where
   * they accepted.
   *
   * The threshold exists because a fix is not movement: GPS drifts tens of metres
   * while a phone sits still on a dashboard, and a customer told "your driver is
   * on the way" by jitter would then watch a stationary marker. `EN_ROUTE_METERS`
   * is comfortably outside that drift and comfortably inside "has pulled out".
   *
   * Idempotent by the state machine: a second call finds the booking already
   * `en_route`, which is an illegal transition, and is swallowed.
   */
  async markEnRoute(bookingId: string, driverId: string): Promise<void> {
    try {
      const result = await this.db.transaction((tx) =>
        this.machine.transition(tx, { bookingId, to: 'en_route', actor: 'driver' }),
      );

      await this.assignments.invalidate(driverId);
      this.customerGateway.emitBookingStatus(bookingId, 'en_route');
      await this.machine.announce(result);
      await this.notifyCustomer(bookingId, 'booking.driver_en_route');
    } catch (error) {
      // The overwhelmingly common cause is a second ping arriving before the
      // first transition committed, or a booking that has already moved on.
      // Neither is worth a log line at warn level on a 3-second cadence.
      if (error instanceof ApiException && error.getStatus() === HttpStatus.CONFLICT) return;
      this.logger.warn(`en_route transition failed for ${bookingId}: ${String(error)}`);
    }
  }

  /**
   * §5.2's `arrived`, and the moment the §7.4 waiting grace starts running.
   *
   * `arrivedAt` is written in the transition's own UPDATE. It is not decoration:
   * it is the instant TowPartner's ticker counts from and the instant `complete`
   * bills from, so it has to be the same value in both places and it has to be
   * the server's.
   *
   * IT IS ALSO THE ONLY STEP IN THE CHAIN WITH A GEOGRAPHIC GUARD, and it needs
   * one because it is the only step that starts charging. Fifteen free minutes
   * then ₹5 a minute: a driver who taps this from five kilometres away has begun
   * billing a customer for their own drive. §11.5's arrival assist prompts at
   * 100 m and under 5 km/h, but that is a client-side convenience on a screen a
   * driver can ignore, and a convenience is not a control.
   *
   * The radius is deliberately much looser than the assist's — this is a
   * backstop against a wrong tap, not a second geofence, and a pickup pin
   * dropped on the far side of a large building or a service road should not
   * strand a driver who is genuinely there. No fix at all is ALLOWED through:
   * a driver whose GPS has failed still has to be able to finish the job, and
   * `last_ping_at` staleness is already what excludes them from new dispatch.
   */
  async arrived(bookingId: string, driverId: string): Promise<DriverJob> {
    await this.requireDriverJob(bookingId, driverId);
    await this.requireNearPickup(bookingId, driverId);
    const now = new Date();

    const result = await this.db.transaction((tx) =>
      this.machine.transition(tx, {
        bookingId,
        to: 'arrived',
        actor: 'driver',
        patch: { arrivedAt: now },
      }),
    );

    await this.assignments.invalidate(driverId);
    this.customerGateway.emitBookingStatus(bookingId, 'arrived');
    await this.machine.announce(result);
    await this.eta.onStatusChange(bookingId, 'arrived');
    await this.notifyCustomer(bookingId, 'booking.driver_arrived');

    return this.job(bookingId, driverId);
  }

  /**
   * §9.2.3's "job cannot start without a valid OTP" — the hard gate in this
   * phase.
   *
   * THE OTP IS VERIFIED BEFORE THE TRANSACTION OPENS, deliberately. It is a
   * write (the attempt counter increments on every guess, which is what makes
   * the cap real), and putting it inside the transition's transaction would mean
   * a failed guess rolls back its own attempt count — turning a 5-attempt cap
   * into an unlimited one. `BookingOtpService.verify` does the increment and the
   * read in ONE statement for the same reason.
   *
   * `otpVerified` is set in the transition patch because `verify()` deliberately
   * does not: it answers "is this the code", and committing the consequence is
   * the caller's business.
   */
  async start(bookingId: string, driverId: string, code: string): Promise<DriverJob> {
    const job = await this.requireDriverJob(bookingId, driverId);

    const ok = await this.otp.verify(this.db, bookingId, code);
    if (!ok) {
      // One refusal for wrong / expired / exhausted / never-minted — anything
      // finer is an oracle against a six-digit space. `attemptsRemaining` is
      // safe and is the one thing the driver actually needs, because the
      // alternative is discovering the cap by being locked out mid-handover.
      const attempts = await this.repo.otpAttempts(bookingId);
      throw new ApiException(
        HttpStatus.CONFLICT,
        ErrorCodes.INVALID_BOOKING_OTP,
        'That code is not correct',
        { attemptsRemaining: Math.max(0, this.env.OTP_MAX_ATTEMPTS - attempts) },
      );
    }

    const now = new Date();
    const result = await this.db.transaction((tx) =>
      this.machine.transition(tx, {
        bookingId,
        to: 'in_progress',
        actor: 'driver',
        patch: { startedAt: now, otpVerified: true },
      }),
    );

    await this.assignments.invalidate(driverId);
    this.customerGateway.emitBookingStatus(bookingId, 'in_progress');
    await this.machine.announce(result);
    // The ETA now measures to the DROP. §11.5's status-change trigger exists
    // exactly for this moment — without it the customer would keep seeing an
    // estimate to a pickup the driver is already standing at.
    await this.eta.onStatusChange(bookingId, 'in_progress');
    await this.notifyCustomer(bookingId, 'booking.job_started');

    void job;
    return this.job(bookingId, driverId);
  }

  /**
   * §5.2's `completed` — and §7.6's fare finalization.
   *
   * WHAT IS RECOMPUTED: the waiting charge, and nothing else. Base, distance,
   * night, highway, accident, surge and discount were all locked at confirm
   * (§3.4) and are copied forward untouched. Re-running `computeFare` here would
   * re-derive every one of them from today's rate card, which is the exact thing
   * §3.4 exists to prevent — an admin editing config mid-trip would silently
   * re-price a booking the customer already agreed to.
   *
   * WHAT THE WAITING CHARGE IS COMPUTED FROM: the `waiting_free_minutes` and
   * `waiting_per_minute` SNAPSHOTTED ON THIS BOOKING at confirm (migration 0015),
   * never `charge_config`. Waiting is the one component that cannot be locked at
   * confirm — nobody knows in advance how long the driver will wait — so locking
   * its RULES is the closest equivalent, and it is what makes the number on the
   * driver's live ticker and the number on the final bill the same number.
   *
   * The commission is deliberately NOT recomputed. §19.2 is explicit that credit
   * happens on capture, never at completion, and Phase 19 owns both — this
   * method must leave `commission_amount` at zero or it would create ledger
   * drift against a payment that has not happened.
   */
  async complete(bookingId: string, driverId: string): Promise<DriverJob> {
    const job = await this.requireDriverJob(bookingId, driverId);
    const now = new Date();

    const waitedMinutes = job.arrivedAt
      ? Math.max(
          0,
          Math.floor(((job.startedAt ?? now).getTime() - job.arrivedAt.getTime()) / 60_000),
        )
      : 0;

    // Nullable only for rows predating migration 0015; the backfill gave every
    // existing booking the rates that were in force, and these defaults cover a
    // fixture that inserted a booking directly.
    const freeMinutes = job.waitingFreeMinutes ?? 15;
    const perMinutePaise =
      job.waitingPerMinute === null ? 500 : rupeeStringToPaise(job.waitingPerMinute);

    const waitingPaise = waitingChargePaise(waitedMinutes, freeMinutes, perMinutePaise);
    const lockedTotalPaise = rupeeStringToPaise(job.total);
    const previousWaitingPaise = rupeeStringToPaise(job.waitingCharge);

    // The locked total already contains whatever waiting was on the row (zero,
    // in practice, since nothing wrote it before this phase). Subtracting it
    // before adding the new figure makes this method idempotent in value even
    // though the state machine already makes it idempotent in effect.
    const totalPaise = lockedTotalPaise - previousWaitingPaise + waitingPaise;

    const result = await this.db.transaction(async (tx) => {
      const transition = await this.machine.transition(tx, {
        bookingId,
        to: 'completed',
        actor: 'driver',
        patch: {
          completedAt: now,
          waitingCharge: paiseToRupeeString(waitingPaise),
          total: paiseToRupeeString(totalPaise),
        },
      });

      // §11.7's "expires when the trip completes (+30 min grace)". In the same
      // transaction as the completion, because a link that outlives its trip
      // because a follow-up write failed is a privacy leak with a long tail.
      await this.tracking.expireShareOnCompletion(
        tx,
        bookingId,
        new Date(now.getTime() + this.env.SHARE_LINK_GRACE_MINUTES * 60_000),
      );

      return transition;
    });

    await this.afterJobEnded(bookingId, driverId);
    this.customerGateway.emitBookingStatus(bookingId, 'completed');
    await this.machine.announce(result);

    // §11.2's trip replay wants the final positions, and the flush is otherwise
    // on a ~30 s timer that a completed driver may go offline before.
    await this.flush.flushDriver(driverId).catch(() => undefined);

    return this.job(bookingId, driverId, { allowEnded: true });
  }

  /**
   * §9.2.3's "unable-to-deliver (customer unavailable / wrong address /
   * refused)", and §6.5's re-dispatch.
   *
   * THE ORDER IS TRANSITION FIRST, RE-DISPATCH SECOND, AND IT IS NOT OPTIONAL.
   * `DispatchService.redispatch` early-returns unless the booking is already
   * `searching` — it is written to resume a search, not to start one — so
   * calling it before the transition would silently do nothing and leave a
   * booking with no driver and no search running.
   *
   * THE DRIVER IS CLEARED OFF THE BOOKING IN THE SAME UPDATE. Leaving
   * `driver_id` set would keep them inside `uq_bookings_one_active_per_driver`'s
   * predicate — no, it would not, since the status is no longer active — but it
   * WOULD leave `activeBookingForDriver` and every fleet report attributing a
   * trip to somebody who did not do it, and would leave the next driver's
   * assignment overwriting a field that still names the last one.
   *
   * §3.5: this NEVER charges the customer. Their vehicle is still broken and
   * they are further from help than they were twenty minutes ago.
   */
  async unable(
    bookingId: string,
    driverId: string,
    body: JobUnable,
  ): Promise<JobUnableResponse> {
    await this.requireDriverJob(bookingId, driverId);

    const result = await this.db.transaction((tx) =>
      this.machine.transition(tx, {
        bookingId,
        to: 'searching',
        actor: 'driver',
        note: `unable: ${body.reason}${body.note ? ` — ${body.note}` : ''}`,
        patch: {
          unableReason: body.reason,
          // Cleared so the booking is genuinely unassigned again. The truck goes
          // with the driver: `truck_id` is the truck that RAN the job, and none
          // did.
          driverId: null,
          fleetId: null,
          truckId: null,
          arrivedAt: null,
          // The route was computed from a driver who is no longer coming. Left
          // in place it would draw a line from nowhere to the pickup on the
          // customer's map for the whole of the next search.
          routePolyline: null,
          routeDropPolyline: null,
          routeSource: null,
          etaSeconds: null,
          etaUpdatedAt: null,
        },
      }),
    );

    // The §9.4.6 audit row. Exclusion from the next wave is already covered by
    // this driver's `accepted` row — `excludedDrivers()` counts every outcome —
    // so this exists to make the inspector's account of the booking complete,
    // rather than to change the search.
    await this.dispatchRepo
      .recordUnable(bookingId, driverId)
      .catch((error: unknown) =>
        this.logger.warn(`recording unable attempt failed for ${bookingId}: ${String(error)}`),
      );

    await this.afterJobEnded(bookingId, driverId);
    this.customerGateway.emitBookingStatus(bookingId, 'searching');
    await this.machine.announce(result);

    let redispatched = false;
    try {
      await this.dispatch.redispatch(bookingId, `unable_${body.reason}`);
      redispatched = true;
    } catch (error) {
      // The booking is back in `searching` and durable; the periodic sweep and
      // the customer's own retry both still reach it. Failing the driver's
      // request here would strand them on a job they have already left.
      this.logger.warn(`re-dispatch after unable failed for ${bookingId}: ${String(error)}`);
    }

    return { bookingId, redispatched };
  }

  /** §9.2.3's call button, driver side. */
  async driverContact(bookingId: string, driverId: string): Promise<CallContact> {
    const job = await this.requireDriverJob(bookingId, driverId);

    const call = await this.telephony.maskedNumber({
      bookingId,
      from: 'driver',
      // §9.1.5's "booking for someone else": the driver must reach whoever is
      // actually standing beside the vehicle, which is `contact_mobile` when the
      // customer named somebody else.
      customerMobile: job.contactMobile ?? job.customerMobile,
      driverMobile: null,
    });

    return {
      dialNumber: call.dialNumber,
      masked: call.masked,
      party: 'customer',
      displayName: job.contactName ?? job.customerName,
      reference: call.reference,
    };
  }

  // -------------------------------------------------------------------------

  /**
   * Shared teardown for the two ways a job ends.
   *
   * Order matters only in that the cache invalidation comes first: everything
   * after it is best-effort, and a stale driver→booking entry would keep the
   * relay fanning a finished trip's pings into a room the customer has left.
   */
  private async afterJobEnded(bookingId: string, driverId: string): Promise<void> {
    await this.assignments.invalidate(driverId);
    await this.eta.forget(bookingId);
    await this.otp.forget(bookingId);
    // §6.2's completion rate and the driver's lifetime trip count. After the
    // commit, and never throwing — see `DriverStatsService`.
    await this.stats.recompute(driverId);
  }

  /**
   * The backstop behind §11.5's arrival assist.
   *
   * Reads the HOT fix from Redis rather than the ~30 s Postgres flush: a driver
   * who has just pulled up is exactly the case where a half-minute-old position
   * is still on the previous street, and refusing them would be the failure this
   * guard exists to avoid.
   *
   * Every failure mode here is permissive by design — no fix, an unreadable
   * booking, Redis down — because the cost of a false refusal is a driver
   * standing beside a customer's broken vehicle unable to proceed, and the cost
   * of a false allow is a waiting charge that §7.4 already caps behind fifteen
   * free minutes and that ops can reverse.
   */
  private async requireNearPickup(bookingId: string, driverId: string): Promise<void> {
    const [fix, booking] = await Promise.all([
      this.presence.lastFix(driverId).catch(() => null),
      this.tracking.booking(bookingId).catch(() => undefined),
    ]);

    if (!fix || !booking) return;

    const metres = haversineMeters(
      { lat: fix.lat, lng: fix.lng },
      { lat: booking.pickupLat, lng: booking.pickupLng },
    );
    if (metres <= ARRIVAL_RADIUS_METERS) return;

    throw new ApiException(
      HttpStatus.CONFLICT,
      ErrorCodes.INVALID_BOOKING_STATE,
      'You are too far from the pickup to mark arrival',
      { distanceMeters: Math.round(metres), radiusMeters: ARRIVAL_RADIUS_METERS },
    );
  }

  /**
   * The authorisation every route shares: this booking exists, this driver is on
   * it, and it is still live.
   *
   * A `NOT_ASSIGNED_DRIVER` 409 rather than a 403, because the common cause is
   * not an attack — it is a stale screen. A job completed on another device, or
   * a re-dispatch that took it away while the app was backgrounded, both land
   * here, and the app's remedy is to refetch rather than to complain about
   * permissions.
   */
  private async requireDriverJob(bookingId: string, driverId: string): Promise<JobRow> {
    const row = await this.repo.job(bookingId);
    if (!row) throw ApiException.notFound('Job not found');

    if (row.driverId !== driverId) {
      throw new ApiException(
        HttpStatus.CONFLICT,
        ErrorCodes.NOT_ASSIGNED_DRIVER,
        'This job is no longer yours',
      );
    }

    return row;
  }

  /** The job as the driver's app renders it, after a transition. */
  private async job(
    bookingId: string,
    driverId: string,
    options: { allowEnded?: boolean } = {},
  ): Promise<DriverJob> {
    const job = await this.offers.currentJob(driverId);
    if (job && job.bookingId === bookingId) return job;

    if (options.allowEnded) {
      // `currentJob` is scoped to ACTIVE statuses, so a completed booking
      // legitimately returns nothing. The driver still needs the finished job
      // back — it is what their completion screen renders — so it is rebuilt
      // from the row rather than reported as missing.
      const ended = await this.repo.endedJob(bookingId);
      if (ended) return ended;
    }

    throw ApiException.notFound('Job not found');
  }

  /**
   * §12.2's customer-facing rows for this phase.
   *
   * Best-effort: a notification failure must never surface to the driver who
   * just completed a step, and the transition is already committed.
   */
  private async notifyCustomer(bookingId: string, event: string): Promise<void> {
    try {
      const [row] = await this.db
        .select({ userId: bookings.userId, driverId: bookings.driverId })
        .from(bookings)
        .where(eq(bookings.id, bookingId))
        .limit(1);
      if (!row) return;

      const driver = row.driverId ? await this.repo.driverName(row.driverId) : null;

      await this.notifications.emit(event, {
        bookingId,
        userId: row.userId,
        driverId: row.driverId,
        driverName: driver,
        reference: referenceOf(bookingId),
      });
    } catch (error) {
      this.logger.warn(`${event} notification failed for ${bookingId}: ${String(error)}`);
    }
  }
}

/**
 * Matches `OfferService.reference` exactly so both surfaces quote one code.
 *
 * Duplicated rather than imported because `OfferService`'s copy is a private
 * module function; the value is the first eight characters of the uuid, and the
 * two would have to diverge deliberately for a customer to be shown two
 * different references for one trip.
 */
function referenceOf(bookingId: string): string {
  return `TW-${bookingId.slice(0, 8).toUpperCase()}`;
}

export type { JobStatus };
