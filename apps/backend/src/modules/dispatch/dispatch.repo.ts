import { Inject, Injectable } from '@nestjs/common';
import { and, eq, gte, inArray, sql } from 'drizzle-orm';
import { DB, type Database, type DatabaseExecutor } from '../../db/db.module';
import { bookings, dispatchAttempts, drivers, fleetTrucks, services, users } from '../../db/schema';
import { ACTIVE_JOB_STATUSES } from '../bookings/booking-state-machine.service';

/**
 * The Postgres half of §6 dispatch: the offer log, wave state, and the
 * eligibility facts Redis does not hold.
 *
 * `dispatch_attempts` has existed since migration 0001 with no reader and no
 * writer. It gets both here, and they are the two that matter: the §6.5
 * exclusion set (who has already been asked about this booking) and the rolling
 * §6.2 acceptance rate.
 */

/**
 * The legal `outcome` values, constrained by `ck_dispatch_attempts_outcome`
 * (0014, widened by 0015 with `unable` — see `recordUnable`).
 */
export type AttemptOutcome = 'offered' | 'accepted' | 'rejected' | 'expired' | 'revoked' | 'unable';

/** Everything the §3.2 filter and the §6.2 scorer need that the hot hash cannot hold. */
export interface DriverEligibilityRow {
  driverId: string;
  kycStatus: string;
  isOnline: boolean;
  vehicleClass: string | null;
  longDistanceEnabled: boolean;
  fleetId: string | null;
  truckId: string | null;
  /** `null` for an independent driver — they operate no fleet truck by construction. */
  truckStatus: string | null;
  /** 0–5. Still a seeded default until Phase 19 writes it (§6.2 gives it 15 %). */
  rating: number | null;
  /** 0–100, written by this phase on every offer resolution. */
  acceptanceRate: number | null;
  /** 0–100. Owned by Phase 18's completion path; seeded until then. */
  completionRate: number | null;
  /** True when this driver already holds a job — the §3.2 "one at a time" rule. */
  hasActiveJob: boolean;
}

/** What the offer engine needs about the booking it is dispatching. */
export interface DispatchBookingRow {
  id: string;
  userId: string;
  status: string;
  zoneId: string | null;
  serviceType: string;
  vehicleClass: string;
  serviceSlug: string | null;
  pickupLat: number;
  pickupLng: number;
  pickupAddress: string | null;
  dropLat: number | null;
  dropLng: number | null;
  dropAddress: string | null;
  distanceKm: string | null;
  total: string;
  commissionBand: 'A' | 'B' | 'C' | null;
  commissionPct: string | null;
  commissionAmount: string;
  driverPayout: string;
  note: string | null;
  searchWave: number | null;
  dispatchDeadlineAt: Date | null;
  scheduledAt: Date | null;
  customerName: string | null;
  customerMobile: string | null;
  longDistance: boolean;
}

@Injectable()
export class DispatchRepo {
  constructor(@Inject(DB) private readonly db: Database) {}

  /**
   * Everything about the booking the engine needs, in one read.
   *
   * The money fields are the LOCKED ones from §3.4's confirm, never live config:
   * an admin editing commission mid-search must not change what a driver was
   * offered. `long_distance` is derived from the band rather than the distance,
   * because §3.2's opt-in is a Band C concept and the band is what was locked.
   */
  async booking(bookingId: string): Promise<DispatchBookingRow | undefined> {
    const [row] = await this.db
      .select({
        id: bookings.id,
        userId: bookings.userId,
        status: bookings.status,
        zoneId: bookings.zoneId,
        serviceType: bookings.serviceType,
        vehicleClass: bookings.vehicleClass,
        serviceSlug: services.slug,
        pickupLat: bookings.pickupLat,
        pickupLng: bookings.pickupLng,
        pickupAddress: bookings.pickupAddress,
        dropLat: bookings.dropLat,
        dropLng: bookings.dropLng,
        dropAddress: bookings.dropAddress,
        distanceKm: bookings.distanceKm,
        total: bookings.total,
        commissionBand: bookings.commissionBand,
        commissionPct: bookings.commissionPct,
        commissionAmount: bookings.commissionAmount,
        driverPayout: bookings.driverPayout,
        note: bookings.note,
        searchWave: bookings.searchWave,
        dispatchDeadlineAt: bookings.dispatchDeadlineAt,
        scheduledAt: bookings.scheduledAt,
        customerName: users.name,
        customerMobile: users.mobile,
      })
      .from(bookings)
      .leftJoin(services, eq(services.serviceType, bookings.serviceType))
      .leftJoin(users, eq(users.id, bookings.userId))
      .where(eq(bookings.id, bookingId))
      .limit(1);

    if (!row) return undefined;
    return { ...row, longDistance: row.commissionBand === 'C' } as DispatchBookingRow;
  }

  /**
   * The §3.2 facts for a candidate set, batched.
   *
   * ONE QUERY FOR THE WHOLE WAVE, not one per driver. A wave considers every
   * driver inside the current radius — dozens in a dense zone — and the §6.10
   * latency target leaves no room for N round trips before the first offer goes
   * out.
   *
   * The truck join is a LEFT join and `truckStatus` is nullable on purpose: an
   * independent driver has no `assigned_truck_id` and must pass the compliance
   * filter, not fail it for having nothing to check.
   */
  async eligibility(driverIds: string[]): Promise<Map<string, DriverEligibilityRow>> {
    if (driverIds.length === 0) return new Map();

    const rows = await this.db
      .select({
        driverId: drivers.id,
        kycStatus: drivers.kycStatus,
        isOnline: drivers.isOnline,
        vehicleClass: drivers.vehicleClass,
        longDistanceEnabled: drivers.longDistanceEnabled,
        fleetId: drivers.fleetId,
        truckId: drivers.assignedTruckId,
        truckStatus: fleetTrucks.status,
        rating: drivers.rating,
        acceptanceRate: drivers.acceptanceRate,
        completionRate: drivers.completionRate,
        // A correlated EXISTS rather than a join: a driver has at most one
        // active booking (migration 0014 makes that a unique index), so a join
        // would multiply nothing and an EXISTS stops at the first row.
        hasActiveJob: sql<boolean>`exists (
          select 1 from bookings b
          where b.driver_id = ${drivers.id}
            and b.status in ${activeStatusList()}
        )`,
      })
      .from(drivers)
      .leftJoin(fleetTrucks, eq(fleetTrucks.id, drivers.assignedTruckId))
      .where(inArray(drivers.id, driverIds));

    return new Map(
      rows.map((row) => [
        row.driverId,
        {
          ...row,
          rating: row.rating === null ? null : Number(row.rating),
          acceptanceRate: row.acceptanceRate === null ? null : Number(row.acceptanceRate),
          completionRate: row.completionRate === null ? null : Number(row.completionRate),
        },
      ]),
    );
  }

  /**
   * §6.5's exclusion set — every driver already asked about this booking.
   *
   * ALL OUTCOMES COUNT, including `expired`. A driver whose phone was in a
   * pocket for the full twenty seconds is not a driver to ask again three
   * minutes later on a wider radius; they are a driver who is not answering.
   * Re-offering to them costs another twenty seconds of the customer's deadline
   * for the same silence.
   */
  async excludedDrivers(bookingId: string): Promise<Set<string>> {
    const rows = await this.db
      .selectDistinct({ driverId: dispatchAttempts.driverId })
      .from(dispatchAttempts)
      .where(eq(dispatchAttempts.bookingId, bookingId));

    return new Set(rows.flatMap((row) => (row.driverId ? [row.driverId] : [])));
  }

  /** How many distinct drivers have been offered this booking — the customer-facing number. */
  async driversContacted(bookingId: string): Promise<number> {
    const [row] = await this.db
      .select({ count: sql<number>`count(distinct ${dispatchAttempts.driverId})::int` })
      .from(dispatchAttempts)
      .where(eq(dispatchAttempts.bookingId, bookingId));
    return row?.count ?? 0;
  }

  async recordOffer(params: {
    bookingId: string;
    driverId: string;
    wave: number;
    radiusKm: number;
  }): Promise<string> {
    const [row] = await this.db
      .insert(dispatchAttempts)
      .values({
        bookingId: params.bookingId,
        driverId: params.driverId,
        wave: params.wave,
        radiusKm: params.radiusKm.toFixed(2),
        outcome: 'offered',
      })
      .returning({ id: dispatchAttempts.id });
    return row!.id;
  }

  /**
   * §9.2.3's unable-to-deliver, recorded as an attempt (Phase 18).
   *
   * A NEW ROW RATHER THAN A RESOLVED ONE. The driver's `accepted` row is the
   * truth about what happened at offer time and must stay exactly as it is —
   * `recomputeAcceptanceRate` counts it, and rewriting it to `unable` would
   * quietly dock the acceptance rate of somebody who did accept. Two rows say
   * two true things: they took the job, and they could not finish it.
   *
   * IT IS NOT WHAT EXCLUDES THEM FROM THE RE-DISPATCH — their `accepted` row
   * already does that, since `excludedDrivers()` counts every outcome. This row
   * is the AUDIT: §9.4.6's dispatch inspector reconstructs a booking's history
   * from this table, and without it a trip that was accepted, abandoned and
   * re-matched reads as a driver who simply vanished. It also makes "how often
   * does this driver bail after accepting" answerable from one table instead of
   * a scan over `bookings.unable_reason`.
   *
   * It leaves the acceptance rate untouched by construction:
   * `recomputeAcceptanceRate`'s denominator is an explicit
   * `('accepted','rejected','expired')` allowlist, so a sixth outcome cannot
   * silently join it. The number that SHOULD move is `completion_rate`, and
   * `DriverStatsService` moves it from the booking row.
   *
   * `outcome = 'unable'` is legal from migration 0015, which widened the CHECK
   * 0014 deliberately left widenable.
   */
  async recordUnable(bookingId: string, driverId: string): Promise<void> {
    // The wave and radius are copied from the attempt that produced the
    // assignment, so the dispatch inspector (§9.4.6) shows the failure on the
    // rung it actually happened on rather than on a fabricated wave 0.
    const [accepted] = await this.db
      .select({ wave: dispatchAttempts.wave, radiusKm: dispatchAttempts.radiusKm })
      .from(dispatchAttempts)
      .where(
        and(
          eq(dispatchAttempts.bookingId, bookingId),
          eq(dispatchAttempts.driverId, driverId),
          eq(dispatchAttempts.outcome, 'accepted'),
        ),
      )
      .limit(1);

    await this.db.insert(dispatchAttempts).values({
      bookingId,
      driverId,
      wave: accepted?.wave ?? 1,
      radiusKm: accepted?.radiusKm ?? '0.00',
      outcome: 'unable',
      respondedAt: new Date(),
    });
  }

  /**
   * Resolves an offer, and returns whether it actually moved.
   *
   * The `outcome = 'offered'` predicate is the idempotency: an expiry job that
   * fires after the driver already accepted finds nothing to update and returns
   * false, so the caller skips the release and the recompute. Without it a late
   * timer would overwrite `accepted` with `expired` and un-assign a live job.
   */
  async resolveOffer(
    bookingId: string,
    driverId: string,
    outcome: Exclude<AttemptOutcome, 'offered'>,
    tx: DatabaseExecutor = this.db,
  ): Promise<boolean> {
    const updated = await tx
      .update(dispatchAttempts)
      .set({ outcome, respondedAt: new Date() })
      .where(
        and(
          eq(dispatchAttempts.bookingId, bookingId),
          eq(dispatchAttempts.driverId, driverId),
          eq(dispatchAttempts.outcome, 'offered'),
        ),
      )
      .returning({ id: dispatchAttempts.id });

    return updated.length > 0;
  }

  /** Every driver still holding a live offer on this booking — the revoke list. */
  async pendingOffers(bookingId: string): Promise<string[]> {
    const rows = await this.db
      .select({ driverId: dispatchAttempts.driverId })
      .from(dispatchAttempts)
      .where(
        and(eq(dispatchAttempts.bookingId, bookingId), eq(dispatchAttempts.outcome, 'offered')),
      );
    return rows.flatMap((row) => (row.driverId ? [row.driverId] : []));
  }

  /** Marks every outstanding offer revoked at once — the accept path's cleanup. */
  async revokeOutstanding(bookingId: string, exceptDriverId: string): Promise<string[]> {
    const updated = await this.db
      .update(dispatchAttempts)
      .set({ outcome: 'revoked', respondedAt: new Date() })
      .where(
        and(
          eq(dispatchAttempts.bookingId, bookingId),
          eq(dispatchAttempts.outcome, 'offered'),
          sql`${dispatchAttempts.driverId} <> ${exceptDriverId}`,
        ),
      )
      .returning({ driverId: dispatchAttempts.driverId });

    return updated.flatMap((row) => (row.driverId ? [row.driverId] : []));
  }

  /**
   * §6.2's acceptance rate, recomputed from a rolling 30-day window.
   *
   * THIS IS THE FIRST AND ONLY WRITER of `drivers.acceptance_rate`, which is
   * 15 % of the dispatch score and has run on a frozen seed value since Phase 3.
   * The offer lifecycle is the only thing in the system that knows
   * offered/accepted/rejected/expired, so it owns the number.
   *
   * RECOMPUTED, NOT INCREMENTED. A counter would need every historical decision
   * to have been counted exactly once — across retries, crashes and the DLQ —
   * and would drift silently the first time one was not. Recomputing from the
   * audit log is idempotent by construction and self-heals, and the window is
   * bounded so the query stays small however long a driver has been on the
   * platform. `idx_dispatch_attempts_driver` (migration 0014) backs it.
   *
   * `revoked` is EXCLUDED from the denominator: the driver did nothing wrong —
   * somebody else accepted first — and counting it against them would penalise
   * drivers for being in busy areas where offers resolve fastest.
   *
   * A driver with no resolved offers in the window is left NULL rather than set
   * to 0 or 100. Null means "no signal", which the scorer treats as neutral; a
   * zero would rank a brand-new driver below everyone forever.
   */
  async recomputeAcceptanceRate(driverId: string, windowDays = 30): Promise<number | null> {
    const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);

    const [row] = await this.db
      .select({
        accepted: sql<number>`count(*) filter (where ${dispatchAttempts.outcome} = 'accepted')::int`,
        resolved: sql<number>`count(*) filter (where ${dispatchAttempts.outcome} in ('accepted', 'rejected', 'expired'))::int`,
      })
      .from(dispatchAttempts)
      .where(
        and(eq(dispatchAttempts.driverId, driverId), gte(dispatchAttempts.offeredAt, since)),
      );

    if (!row || row.resolved === 0) return null;

    const rate = (row.accepted / row.resolved) * 100;
    await this.db
      .update(drivers)
      .set({ acceptanceRate: rate.toFixed(2), updatedAt: new Date() })
      .where(eq(drivers.id, driverId));

    return rate;
  }

  /** Persists the §6.4 wave position. The deadline is written once, on the first wave. */
  async setWaveState(
    bookingId: string,
    wave: number,
    deadlineAt: Date | null,
  ): Promise<void> {
    await this.db
      .update(bookings)
      .set({
        searchWave: wave,
        ...(deadlineAt ? { dispatchDeadlineAt: deadlineAt } : {}),
        updatedAt: new Date(),
      })
      .where(eq(bookings.id, bookingId));
  }
}

/**
 * `ACTIVE_JOB_STATUSES` as an enum-typed SQL list.
 *
 * Interpolating the array binds it as ONE parameter, which Postgres reads as a
 * single malformed enum value. The `::booking_status` cast on each literal keeps
 * the comparison on the enum — a `status::text in (…)` spelling would work and
 * would silently stop using any index on `status`.
 */
function activeStatusList() {
  return sql`(${sql.join(
    ACTIVE_JOB_STATUSES.map((status) => sql`${status}::booking_status`),
    sql`, `,
  )})`;
}
