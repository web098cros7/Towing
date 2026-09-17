import { Injectable, Logger } from '@nestjs/common';
import { haversineMeters } from '../pricing/pricing.math';
import { DispatchConfigRepo } from '../bookings/dispatch-config.repo';
import { DriverCandidatesRepo } from '../driver-presence/driver-candidates.repo';
import { PresenceStore } from '../driver-presence/presence-store';
import { DispatchRepo, type DispatchBookingRow, type DriverEligibilityRow } from './dispatch.repo';

/**
 * §3.2's eligibility filter and §6.2's weighted scorer.
 *
 * THE JOIN POINT THE PLAN SAID COULD NOT BE BUILT EARLIER, and it is worth
 * naming what converges here: KYC approval (Phase 11), presence and ping
 * freshness (Phase 16), driver capabilities (Phase 11), zone resolution
 * (Phase 14) and truck compliance (Phase 4). Five phases' worth of state, and a
 * candidate has to satisfy all of it simultaneously. Every one of those was
 * already functioning; this is the first thing that asks them the same question
 * at the same moment.
 */

/** Why a driver in range was not offered the job. Counted, logged, and testable. */
export type ExclusionReason =
  | 'not_approved'
  | 'suspension_pending'
  | 'offline'
  | 'wrong_vehicle_class'
  | 'no_long_distance'
  | 'truck_non_compliant'
  | 'already_on_job'
  | 'already_offered'
  | 'holds_offer';

export interface ScoredCandidate {
  driverId: string;
  distanceMeters: number;
  score: number;
  fleetId: string | null;
  truckId: string | null;
}

export interface SelectionResult {
  candidates: ScoredCandidate[];
  /** Redis was unreachable and this came from PostGIS (§19.2). */
  degraded: boolean;
  /** Per-reason counts, for the log line and the specs. */
  excluded: Partial<Record<ExclusionReason, number>>;
  /** Everyone in range before the filter ran — the denominator of the log line. */
  considered: number;
}

/**
 * The proximity term's normalisation ceiling.
 *
 * Distance has to become a 0–1 score to be weighted against three percentages,
 * and that needs a "far enough to score zero" figure. 15 km is the last rung of
 * §6.4's default ladder, so a driver at the outer edge of the widest ordinary
 * wave scores 0 on proximity and is chosen only on rating and reliability —
 * which is the correct behaviour at that distance.
 */
const PROXIMITY_CEILING_METERS = 15_000;

/**
 * What an absent signal scores.
 *
 * Rating and completion are still seeded defaults until Phases 19 and 18 write
 * them, and acceptance is null for any driver with no resolved offers in the
 * window. Scoring a missing signal as 0 would rank every new driver last
 * permanently — a cold-start trap that would make the marketplace impossible to
 * join. Neutral means a new driver competes on proximity, which is the only
 * thing genuinely known about them.
 */
const NEUTRAL = 0.5;

@Injectable()
export class CandidateSelectionService {
  private readonly logger = new Logger(CandidateSelectionService.name);

  constructor(
    private readonly candidates: DriverCandidatesRepo,
    private readonly presence: PresenceStore,
    private readonly repo: DispatchRepo,
    private readonly config: DispatchConfigRepo,
  ) {}

  /**
   * Everyone eligible inside `radiusKm`, best first.
   *
   * The order of operations is a cost decision. Redis narrows by geography and
   * freshness first (cheap, and it is what the candidate store exists for), then
   * one batched Postgres read supplies the facts Redis cannot hold, then the
   * Redis offer locks are checked last — because that check is only worth making
   * for drivers who survived everything else.
   */
  async select(
    booking: DispatchBookingRow,
    radiusKm: number,
    limit: number,
  ): Promise<SelectionResult> {
    const centre = { lat: booking.pickupLat, lng: booking.pickupLng };

    const { candidates: inRange, degraded } = await this.candidates.searchWithFallback({
      zoneId: booking.zoneId,
      centre,
      radiusKm,
      // Deliberately wider than `limit`: the filter below removes a large
      // fraction — offline drivers, wrong vehicle class, drivers already on a
      // job — and selecting exactly `limit` from Redis would routinely leave a
      // wave with nobody to offer to while eligible drivers sat just outside it.
      limit: Math.max(limit * 8, 40),
    });

    const excluded: Partial<Record<ExclusionReason, number>> = {};
    const count = (reason: ExclusionReason) => {
      excluded[reason] = (excluded[reason] ?? 0) + 1;
    };

    if (inRange.length === 0) {
      return { candidates: [], degraded, excluded, considered: 0 };
    }

    const ids = inRange.map((candidate) => candidate.driverId);
    const [eligibility, alreadyOffered] = await Promise.all([
      this.repo.eligibility(ids),
      this.repo.excludedDrivers(booking.id),
    ]);

    const survivors: Array<{ row: DriverEligibilityRow; distanceMeters: number }> = [];

    for (const candidate of inRange) {
      // §6.5: a driver already asked about THIS booking is not asked again on a
      // wider wave. Checked before the row lookup because it needs no row.
      if (alreadyOffered.has(candidate.driverId)) {
        count('already_offered');
        continue;
      }

      const row = eligibility.get(candidate.driverId);
      // In the candidate store with no driver row is a data fault, not a
      // decision — skip silently rather than inventing an exclusion reason.
      if (!row) continue;

      // §3.1 layer 4. Redis said approved when they went online; an admin may
      // have suspended them since, and the hash lives for 30 s after that.
      if (row.kycStatus !== 'approved') {
        count('not_approved');
        continue;
      }
      // A14: shelved suspension — the driver finishes their live job but takes
      // no new offers. Checked here rather than only at accept time so a wave
      // does not burn twenty seconds offering to a driver who cannot take it.
      if (row.suspensionPending) {
        count('suspension_pending');
        continue;
      }
      if (!row.isOnline) {
        count('offline');
        continue;
      }
      // §3.2: a wheel-lift cannot take a flatbed job. A driver who has declared
      // no class at all is not offered a tow — the class decides the equipment.
      if (row.vehicleClass !== booking.vehicleClass) {
        count('wrong_vehicle_class');
        continue;
      }
      // §3.2's Band C opt-in — a long haul needs a willing driver, not a
      // pricier plan.
      if (booking.longDistance && !row.longDistanceEnabled) {
        count('no_long_distance');
        continue;
      }
      // Phase 4's exclusion status. `null` is an independent driver with no
      // fleet truck, which passes — there is nothing to be non-compliant.
      if (row.truckStatus === 'non_compliant') {
        count('truck_non_compliant');
        continue;
      }
      if (row.hasActiveJob) {
        count('already_on_job');
        continue;
      }

      survivors.push({
        row,
        // Straight-line, not routed. §6.2 scores proximity to RANK candidates,
        // and a Directions call per driver per wave would be dozens of billed
        // vendor calls inside the §6.10 latency budget. The winner's real ETA is
        // Phase 18's problem, once there is exactly one driver to compute it for.
        distanceMeters: haversineMeters(centre, { lat: candidate.lat, lng: candidate.lng }),
      });
    }

    // Offer locks LAST — one pipelined round trip over the survivors rather than
    // over everyone who happened to be in range.
    const locked = await this.presence.lockedDrivers(survivors.map((s) => s.row.driverId));
    const available = survivors.filter((s) => {
      if (locked.has(s.row.driverId)) {
        count('holds_offer');
        return false;
      }
      return true;
    });

    const { weights } = await this.config.load();
    const scored = available
      .map(({ row, distanceMeters }) => ({
        driverId: row.driverId,
        distanceMeters,
        fleetId: row.fleetId,
        truckId: row.truckId,
        score: score(row, distanceMeters, weights),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    this.logger.debug(
      `booking ${booking.id} wave radius ${radiusKm}km: ${inRange.length} in range, ${scored.length} offered${
        degraded ? ' (postgis)' : ''
      }`,
    );

    return { candidates: scored, degraded, excluded, considered: inRange.length };
  }
}

/**
 * §6.2's weighted score — proximity/ETA 60 %, rating 15 %, acceptance 15 %,
 * completion 10 %.
 *
 * EVERY WEIGHT IS READ AT QUERY TIME from the `dispatch_config` singleton, never
 * from a constant here. Phase 14 created that table one phase early for exactly
 * this reason: hard-coding the weights and retrofitting a config service later
 * is a matcher rewrite, and §6.7 requires them to change with no deploy.
 *
 * ⚠ TWO OF THE FOUR INPUTS ARE NOT YET LIVE SIGNALS. `acceptance_rate` gets its
 * first writer in this phase. `completion_rate` and `rating` are still the
 * values `db/seed/seed.ts` wrote — Phase 18 owns completion, Phase 19 owns
 * rating — so 25 % of this score is currently a fixture. That is stated here
 * rather than left for someone to discover from a suspiciously stable ranking.
 */
function score(
  row: DriverEligibilityRow,
  distanceMeters: number,
  weights: { proximity: number; rating: number; acceptance: number; completion: number },
): number {
  // Linear falloff to the ceiling. Not inverse-square: a driver twice as far
  // away is roughly twice the wait, and squaring would make the term dominate
  // the other three so completely that they might as well not be weighted.
  const proximity = Math.max(0, 1 - distanceMeters / PROXIMITY_CEILING_METERS);
  const rating = row.rating === null ? NEUTRAL : clamp01(row.rating / 5);
  const acceptance = row.acceptanceRate === null ? NEUTRAL : clamp01(row.acceptanceRate / 100);
  const completion = row.completionRate === null ? NEUTRAL : clamp01(row.completionRate / 100);

  // Weights are percentages summing to 100 (CHECKed in migration 0011), so the
  // result is a 0–100 score and is directly comparable across zones even if an
  // admin retunes one of them.
  return (
    proximity * weights.proximity +
    rating * weights.rating +
    acceptance * weights.acceptance +
    completion * weights.completion
  );
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return NEUTRAL;
  return Math.min(1, Math.max(0, value));
}
