import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import {
  ErrorCodes,
  resolveDispatchConfig,
  rupeeStringToPaise,
  type DriverJob,
  type JobOffer,
  type ServiceType,
} from '@towing/api-contracts';
import { and, eq, sql } from 'drizzle-orm';
import { ApiException } from '../../common/errors/api-exception';
import { NotificationService } from '../../common/notifications/notification.service';
import { QUEUE, type QueuePort } from '../../common/queue/queue.port';
import { DB, type Database } from '../../db/db.module';
import { bookings, dispatchAttempts, drivers, serviceZones, users } from '../../db/schema';
import { haversineMeters } from '../pricing/pricing.math';
import { BookingStateMachineService } from '../bookings/booking-state-machine.service';
import { CustomerGateway } from '../bookings/customer.gateway';
import { DriverGateway } from '../driver-presence/driver.gateway';
import { PresenceStore } from '../driver-presence/presence-store';
import { EtaService } from '../tracking/eta.service';

import { CandidateSelectionService, type ScoredCandidate } from './candidate-selection.service';
import { DispatchRepo, type DispatchBookingRow } from './dispatch.repo';

/**
 * §6.3's offer lifecycle: make one, resolve it, and assign the job when a driver
 * takes it.
 *
 * THE ACCEPT TRANSACTION IS THE MOST CORRECTNESS-CRITICAL CODE IN THE PRODUCT.
 * Two drivers against one fare-locked booking does not degrade the experience —
 * it corrupts the ledger, because both would later be credited against one
 * customer payment. Everything below is arranged so that exactly one accept can
 * win, and the loser is told so politely.
 */

/**
 * Grace added to the offer TTL when locking a driver.
 *
 * The lock must outlive the offer, not match it: an expiry job that runs a
 * second late would otherwise find the lock already gone and the driver already
 * picked up by another search, producing two offers for one driver anyway. Five
 * seconds is longer than any plausible queue delay and short enough that a
 * crashed worker costs one wave rather than a shift.
 */
const OFFER_LOCK_GRACE_MS = 5_000;

@Injectable()
export class OfferService {
  private readonly logger = new Logger(OfferService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(QUEUE) private readonly queue: QueuePort,
    private readonly repo: DispatchRepo,
    private readonly selection: CandidateSelectionService,
    private readonly presence: PresenceStore,
    private readonly gateway: DriverGateway,
    private readonly customerGateway: CustomerGateway,
    private readonly machine: BookingStateMachineService,
    private readonly notifications: NotificationService,
    private readonly tracking: EtaService,
  ) {}

  /**
   * Offers one booking to one driver.
   *
   * THE LOCK IS TAKEN FIRST AND THE RETURN VALUE IS OBEYED. Losing the race for
   * a driver is the ordinary case in a busy zone, not an error: another search
   * got there first, and this wave simply offers to the next candidate. Writing
   * the attempt row before taking the lock would leave a phantom `offered` row
   * for an offer that was never made, which the exclusion set would then honour
   * — permanently locking that driver out of this booking for nothing.
   */
  async offer(
    booking: DispatchBookingRow,
    candidate: ScoredCandidate,
    wave: number,
    radiusKm: number,
    timeoutSeconds: number,
  ): Promise<boolean> {
    const ttlMs = timeoutSeconds * 1_000 + OFFER_LOCK_GRACE_MS;
    if (!(await this.presence.takeOfferLock(candidate.driverId, ttlMs))) return false;

    const expiresAt = new Date(Date.now() + timeoutSeconds * 1_000);

    try {
      await this.repo.recordOffer({
        bookingId: booking.id,
        driverId: candidate.driverId,
        wave,
        radiusKm,
      });
    } catch (error) {
      // The row is what makes the offer real. Without it the expiry job has
      // nothing to resolve and the exclusion set has no record — so release the
      // driver rather than leaving them locked for the full TTL.
      await this.presence.releaseOfferLock(candidate.driverId);
      throw error;
    }

    const payload = await this.buildOffer(booking, candidate, wave, expiresAt);

    // The socket first, because it is the fast path when the app is open, and
    // the push second because it is the only path when it is not. BOTH always —
    // not "push only if the socket missed", which would need a delivery receipt
    // the socket does not give us and would cost the driver seconds of a
    // twenty-second window while we waited for one.
    this.gateway.emitJobOffer(candidate.driverId, payload);
    await this.pushOffer(booking, candidate.driverId, payload);

    // The expiry, as a DURABLE delayed job. An in-process `setTimeout` over N
    // Fargate tasks is the double-assignment bug this whole design exists to
    // prevent: the task holding the timer recycles, the timer dies with it, and
    // the offer is locked open forever.
    await this.queue.enqueue(
      'dispatch.offer-timeout',
      { bookingId: booking.id, driverId: candidate.driverId, wave },
      {
        // Unique per offer, so a re-offer on a later wave is not deduplicated
        // against this one by BullMQ's job-id collision rule.
        jobId: `offer-timeout-${booking.id}-${candidate.driverId}-${wave}`,
        delayMs: timeoutSeconds * 1_000,
        // ONE attempt. A retried expiry is a second attempt to expire an offer
        // that is either already resolved (a no-op) or still open (the next
        // wave's search will pass over it anyway). Retrying buys nothing and
        // risks re-running the release against a driver who has since been
        // offered something else.
        attempts: 1,
      },
    );

    return true;
  }

  /**
   * Expires an offer nobody answered.
   *
   * IDEMPOTENT, and it has to be: this fires from a delayed job that may land
   * after the driver already accepted, after another driver accepted, or twice.
   * `resolveOffer` only moves a row that is still `offered`, so every one of
   * those is a no-op that returns false.
   */
  async expire(bookingId: string, driverId: string): Promise<void> {
    const moved = await this.repo.resolveOffer(bookingId, driverId, 'expired');
    if (!moved) return;

    await this.presence.releaseOfferLock(driverId);
    // §6.2: silence counts against the acceptance rate exactly as a decline
    // does. A driver whose phone is in a pocket is, from the customer's side,
    // a driver who did not take the job.
    await this.repo.recomputeAcceptanceRate(driverId);
    this.gateway.emitJobRevoked(driverId, bookingId, 'expired');
  }

  /** The driver said no. Same bookkeeping as an expiry, minus the surprise. */
  async reject(bookingId: string, driverId: string, reason?: string): Promise<void> {
    const moved = await this.repo.resolveOffer(bookingId, driverId, 'rejected');
    if (!moved) {
      // Either the offer already expired, or this is a duplicate tap. Neither is
      // worth an error — the driver's intent is satisfied either way.
      return;
    }

    await this.presence.releaseOfferLock(driverId);
    await this.repo.recomputeAcceptanceRate(driverId);
    if (reason) this.logger.debug(`driver ${driverId} declined ${bookingId}: ${reason}`);
  }

  /**
   * The driver said yes. §3.4's atomic assignment.
   *
   * FOUR THINGS HAVE TO BE TRUE AT COMMIT and each is checked inside the
   * transaction rather than before it:
   *
   *  1. The booking is still `SEARCHING`. `BookingStateMachineService.transition`
   *     takes `SELECT … FOR UPDATE` on the row, so two drivers accepting the
   *     same booking serialise here and the second finds `assigned`.
   *  2. This driver's offer is still `offered` — not expired, not revoked
   *     because someone else won. The UPDATE's own predicate decides it.
   *  3. The driver is STILL ELIGIBLE. This is where §3.1's database layer
   *     finally lands: approval, online state and truck compliance are re-read
   *     at the last possible moment, because all three can change inside the
   *     twenty seconds the driver spent deciding.
   *  4. `bookings.truck_id` is snapshotted. Without it, a fleet reassigning a
   *     driver's truck later silently rewrites this job's attribution and every
   *     earnings report built on it.
   */
  async accept(bookingId: string, driverId: string): Promise<DriverJob> {
    const booking = await this.repo.booking(bookingId);
    if (!booking) throw ApiException.notFound('Job not found');

    // Cheap pre-flight OUTSIDE the transaction, purely to fail fast on the
    // common case (a driver tapping Accept on an offer that expired while the
    // screen was open). The authoritative checks are all inside.
    if (booking.status !== 'searching') {
      throw this.gone();
    }

    const result = await this.db.transaction(async (tx) => {
      // (2) — and it is the offer lock's arbiter, not merely a bookkeeping
      // update. A driver who was never offered this booking, or whose offer has
      // been revoked, moves no row and is refused.
      const claimed = await this.repo.resolveOffer(bookingId, driverId, 'accepted', tx);
      if (!claimed) throw this.gone();

      // (3) §3.1's database layer.
      const [eligible] = await tx
        .select({
          kycStatus: drivers.kycStatus,
          isOnline: drivers.isOnline,
          fleetId: drivers.fleetId,
          truckId: drivers.assignedTruckId,
        })
        .from(drivers)
        .where(eq(drivers.id, driverId))
        .limit(1);

      if (!eligible || eligible.kycStatus !== 'approved' || !eligible.isOnline) {
        throw new ApiException(
          HttpStatus.FORBIDDEN,
          ErrorCodes.DRIVER_NOT_ELIGIBLE,
          'You can no longer take this job',
        );
      }

      // (1) and (4) together, in the caller's transaction — which is exactly
      // what `transition` takes a `tx` for.
      await this.machine.transition(tx, {
        bookingId,
        to: 'assigned',
        actor: 'driver',
        patch: {
          driverId,
          fleetId: eligible.fleetId,
          truckId: eligible.truckId,
        },
      });

      return { fleetId: eligible.fleetId, truckId: eligible.truckId };
    });

    // Everything below is AFTER the commit. A socket frame or a push about an
    // assignment that then rolled back is worse than a late one.
    await this.afterAssign(booking, driverId, result.fleetId);

    const job = await this.currentJob(driverId);
    if (!job) throw ApiException.notFound('Job not found');
    return job;
  }

  /**
   * Everything the world needs to know once a driver is committed.
   *
   * Best-effort throughout: the assignment is committed, and no notification
   * failure may undo it or surface as an error to the driver who just accepted.
   */
  private async afterAssign(
    booking: DispatchBookingRow,
    driverId: string,
    fleetId: string | null,
  ): Promise<void> {
    // Every other driver still holding this offer is released and told, so their
    // takeover screen closes now rather than counting down to a job that is
    // gone. `taken` is a different feeling from "you were too slow".
    try {
      const losers = await this.repo.revokeOutstanding(booking.id, driverId);
      for (const loser of losers) {
        await this.presence.releaseOfferLock(loser);
        this.gateway.emitJobRevoked(loser, booking.id, 'taken');
        // A revoked offer does NOT count against acceptance rate — the driver
        // did nothing wrong. `recomputeAcceptanceRate` excludes `revoked` from
        // its denominator, so this is a no-op by construction; called anyway
        // because the rate is otherwise only refreshed when they next resolve
        // an offer of their own.
      }
    } catch (error) {
      this.logger.warn(`revoking outstanding offers for ${booking.id} failed: ${String(error)}`);
    }

    await this.presence.releaseOfferLock(driverId);
    await this.repo.recomputeAcceptanceRate(driverId).catch(() => undefined);

    // §12.2's "driver assigned" row, and §9.1.6's literal AC: "app backgrounded
    // during search → push on match".
    try {
      const [driver] = await this.db
        .select({ name: drivers.name })
        .from(drivers)
        .where(eq(drivers.id, driverId))
        .limit(1);

      await this.notifications.emit('booking.driver_assigned', {
        bookingId: booking.id,
        userId: booking.userId,
        driverId,
        driverName: driver?.name ?? null,
        reference: reference(booking.id),
      });
    } catch (error) {
      this.logger.warn(`assignment notification failed for ${booking.id}: ${String(error)}`);
    }

    // The CUSTOMER, first — they are the one staring at a radar animation.
    // Without this their searching screen would wait out its ten-second poll to
    // discover the match, on a socket built specifically to avoid that.
    this.customerGateway.emitBookingStatus(booking.id, 'assigned');

    // The fleet console's live feed — only meaningful for a fleet-affiliated
    // driver, and `announce` no-ops on a null tenant.
    await this.machine.announce({
      id: booking.id,
      from: 'searching',
      to: 'assigned',
      fleetId,
    });

    // §11.5's route and first ETA (Phase 18) — the ONE Directions call this
    // booking will ever make. Deliberately last, deliberately not awaited by the
    // accept response's critical path, and deliberately outside the transaction:
    // a four-second vendor timeout must not roll back an assignment, and a
    // driver who tapped Accept must not stare at a spinner waiting for a map
    // line. `planRoute` swallows its own failures and the trip runs fine with a
    // straight-line ETA — which is what the router falls back to anyway.
    //
    // The driver's last fix is passed rather than re-read: `PresenceStore`
    // already had it a moment ago to score this candidate, and it is fresher
    // than the ~30 s Postgres flush.
    const fix = await this.presence.lastFix(driverId).catch(() => null);
    void this.tracking.planRoute(
      booking.id,
      fix ? { lat: fix.lat, lng: fix.lng } : null,
    );
  }

  /** `GET /v1/driver/offers/current` — §19.2's resync for a dropped socket. */
  async currentOffer(driverId: string): Promise<JobOffer | null> {
    const [row] = await this.db
      .select({
        bookingId: dispatchAttempts.bookingId,
        wave: dispatchAttempts.wave,
        offeredAt: dispatchAttempts.offeredAt,
      })
      .from(dispatchAttempts)
      .where(and(eq(dispatchAttempts.driverId, driverId), eq(dispatchAttempts.outcome, 'offered')))
      .orderBy(sql`${dispatchAttempts.offeredAt} desc nulls last`)
      .limit(1);

    if (!row) return null;

    const booking = await this.repo.booking(row.bookingId);
    // An offer whose booking has moved on is not an offer. The expiry job will
    // tidy the row; reporting it here would put a dead countdown on screen.
    if (!booking || booking.status !== 'searching') return null;

    const [driver] = await this.db
      .select({ location: drivers.currentLocation })
      .from(drivers)
      .where(eq(drivers.id, driverId))
      .limit(1);

    // The remaining window is derived from the offer's own timestamp and the
    // zone's timeout, not stored — the same number the delayed job will use.
    const offerTimeoutSeconds = await this.timeoutFor(booking);
    const expiresAt = new Date(row.offeredAt.getTime() + offerTimeoutSeconds * 1_000);
    if (expiresAt.getTime() <= Date.now()) return null;

    return this.buildOffer(
      booking,
      {
        driverId,
        distanceMeters: driver?.location
          ? haversineMeters(
              { lat: booking.pickupLat, lng: booking.pickupLng },
              { lat: driver.location.lat, lng: driver.location.lng },
            )
          : 0,
        score: 0,
        fleetId: null,
        truckId: null,
      },
      row.wave,
      expiresAt,
    );
  }

  /** `GET /v1/driver/jobs/current` — the assigned job, or null when idle. */
  async currentJob(driverId: string): Promise<DriverJob | null> {
    const [row] = await this.db
      .select({
        booking: bookings,
        customerName: users.name,
        customerMobile: users.mobile,
      })
      .from(bookings)
      .leftJoin(users, eq(users.id, bookings.userId))
      .where(
        and(
          eq(bookings.driverId, driverId),
          sql`${bookings.status} in ('assigned', 'en_route', 'arrived', 'in_progress')`,
        ),
      )
      .limit(1);

    if (!row) return null;
    const booking = row.booking;

    return {
      bookingId: booking.id,
      reference: reference(booking.id),
      status: booking.status,
      serviceType: booking.serviceType,
      vehicleClass: booking.vehicleClass,
      earnings: earningsOf(booking),
      pickup: { lat: booking.pickupLat, lng: booking.pickupLng },
      pickupAddress: booking.pickupAddress,
      drop:
        booking.dropLat !== null && booking.dropLng !== null
          ? { lat: booking.dropLat, lng: booking.dropLng }
          : null,
      dropAddress: booking.dropAddress,
      distanceKm: booking.distanceKm === null ? null : Number(booking.distanceKm),
      customerName: row.customerName,
      // Phase 18 replaces this with a masked number once telephony exists
      // (SETUP-CHECKLIST). Until then the driver gets the real one, which is
      // what makes the job completable and is recorded as a known gap.
      customerMobile: row.customerMobile,
      customerRating: null,
      note: booking.note,
      // §5.1's collection OTP is held by the CUSTOMER and typed by the driver;
      // the code itself never travels to this phone.
      otpPending: booking.status === 'assigned' || booking.status === 'en_route' || booking.status === 'arrived',
      assignedAt: booking.updatedAt?.toISOString() ?? null,

      // §5.2's instants (Phase 18). ABSOLUTE, on the server's clock, for the
      // same reason `JobOffer.expiresAt` is: `arrivedAt` is what TowPartner's
      // waiting ticker counts from, and unlike a countdown the result is
      // BILLABLE — the number on the driver's screen has to be the number
      // `complete` charges.
      arrivedAt: booking.arrivedAt?.toISOString() ?? null,
      startedAt: booking.startedAt?.toISOString() ?? null,

      // §7.4's waiting rules as LOCKED on this booking (§3.4), not as currently
      // configured, so the live ticker and the final bill cannot disagree. The
      // fallbacks cover rows predating migration 0015.
      waiting: {
        freeMinutes: booking.waitingFreeMinutes ?? 15,
        perMinutePaise:
          booking.waitingPerMinute === null ? 500 : rupeeStringToPaise(booking.waitingPerMinute),
      },

      // §11.4/§11.5 — the driver draws the same route line the customer sees.
      etaSeconds: booking.etaSeconds,
      routePolyline: booking.routePolyline,
      routeDropPolyline: booking.routeDropPolyline,
    };
  }

  private async buildOffer(
    booking: DispatchBookingRow,
    candidate: ScoredCandidate,
    wave: number,
    expiresAt: Date,
  ): Promise<JobOffer> {
    return {
      bookingId: booking.id,
      reference: reference(booking.id),
      serviceType: booking.serviceType as JobOffer['serviceType'],
      vehicleClass: booking.vehicleClass as JobOffer['vehicleClass'],
      expiresAt: expiresAt.toISOString(),
      earnings: earningsOf(booking),
      pickup: { lat: booking.pickupLat, lng: booking.pickupLng },
      pickupAddress: booking.pickupAddress,
      drop:
        booking.dropLat !== null && booking.dropLng !== null
          ? { lat: booking.dropLat, lng: booking.dropLng }
          : null,
      dropAddress: booking.dropAddress,
      distanceKm: booking.distanceKm === null ? null : Number(booking.distanceKm),
      distanceToPickupMeters: Math.round(candidate.distanceMeters),
      // §9.2.2 asks for the customer's rating on the offer card. `ratings` is
      // Phase 19's table, so there is nothing to read — null, which the card
      // renders as "no rating yet" rather than inventing a 5.0.
      customerRating: null,
      customerName: firstName(booking.customerName),
      note: booking.note,
      wave,
    };
  }

  /** The zone's offer timeout, through the one sanctioned reader of the JSONB. */
  private async timeoutFor(booking: DispatchBookingRow): Promise<number> {
    const [zone] = booking.zoneId
      ? await this.db
          .select({ dispatchConfig: serviceZones.dispatchConfig })
          .from(serviceZones)
          .where(eq(serviceZones.id, booking.zoneId))
          .limit(1)
      : [];

    // `resolveDispatchConfig` rather than reaching into the JSONB — a caller
    // re-inventing the NULL handling is how a second set of dispatch constants
    // gets hard-coded somewhere no admin can reach.
    return resolveDispatchConfig(zone?.dispatchConfig ?? null, booking.serviceType as ServiceType)
      .offerTimeoutSeconds;
  }

  private async pushOffer(
    booking: DispatchBookingRow,
    driverId: string,
    offer: JobOffer,
  ): Promise<void> {
    try {
      await this.notifications.emit('job.offered', {
        bookingId: booking.id,
        driverId,
        netAmount: `₹${(offer.earnings.netPaise / 100).toFixed(2)}`,
        pickupAddress: booking.pickupAddress ?? '',
        expiresAt: offer.expiresAt,
      });
    } catch (error) {
      // The socket may well have delivered it. A push failure must never abort
      // an offer that is already on the wire and already counted down.
      this.logger.warn(`offer push failed for driver ${driverId}: ${String(error)}`);
    }
  }

  private gone(): ApiException {
    return new ApiException(
      HttpStatus.CONFLICT,
      ErrorCodes.OFFER_NO_LONGER_AVAILABLE,
      'This job is no longer available',
    );
  }
}

/** The same short code the fleet console and the customer's trip list show. */
function reference(bookingId: string): string {
  return `TW-${bookingId.slice(0, 8).toUpperCase()}`;
}

/**
 * The gross → commission → net triple, from the values LOCKED at confirm.
 *
 * Never recomputed from live config: §3.4 locks the fare and the commission
 * percentage at the moment the customer confirms, precisely so an admin editing
 * the rate card mid-search cannot change what a driver is offered — or, worse,
 * offer one number and pay another.
 */
function earningsOf(booking: {
  total: string;
  commissionBand: 'A' | 'B' | 'C' | null;
  commissionPct: string | null;
  commissionAmount: string;
  driverPayout: string;
}): JobOffer['earnings'] {
  return {
    grossPaise: rupeeStringToPaise(booking.total),
    band: booking.commissionBand,
    commissionPct: booking.commissionPct === null ? null : Number(booking.commissionPct),
    commissionPaise: rupeeStringToPaise(booking.commissionAmount),
    netPaise: rupeeStringToPaise(booking.driverPayout),
  };
}

/** First name only on an offer — full identity is earned by assignment, not consideration. */
function firstName(name: string | null): string | null {
  if (!name) return null;
  return name.split(' ')[0] ?? name;
}
