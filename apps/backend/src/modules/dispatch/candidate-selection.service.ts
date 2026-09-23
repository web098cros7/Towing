import { Injectable, Logger } from '@nestjs/common';
import { isCoreServiceType } from '../../common/drivers/services';
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
  | 'fleet_suspended'
  | 'offline'
  | 'wrong_vehicle_class'
  | 'service_not_offered'
  | 'no_long_distance'
  | 'zone_restricted'
  | 'truck_non_compliant'
  | 'already_on_job'
  | 'already_offered'
  | 'holds_offer';

/** W5: the four §6.2 terms, each normalised 0–1 — the inspector's per-term bars. */
export interface ScoreTerms {
  proximity: number;
  rating: number;
  acceptance: number;
  completion: number;
}

/** W5: the weights in force when a wave ran — same four keys, from `dispatch_config`. */
export type ScoreWeights = ScoreTerms;

export interface ScoredCandidate {
  driverId: string;
  distanceMeters: number;
  score: number;
  /** W5: the per-term breakdown behind `score` — `score` must equal the weighted sum. */
  terms: ScoreTerms;
  fleetId: string | null;
  truckId: string | null;
}

/** W5: one exclusion reason's tally; the ids are a capped sample, the count is exact. */
export interface ExclusionDetail {
  count: number;
  driverIds: string[];
}

export interface SelectionResult {
  /** The offer list: top `limit` after scoring — unchanged behaviour. */
  candidates: ScoredCandidate[];
  /**
   * W5: every scored candidate PRE-slice, capped at `WAVE_LOG_CANDIDATE_CAP`.
   * The wave log keeps what the wave ranked, whether or not it reached them —
   * with `offersPerWave` at 3, the difference between "ranked 3rd" and "ranked
   * 8th" is exactly the thing the inspector exists to show.
   */
  ranked: ScoredCandidate[];
  /** W5: how many candidates passed every filter (uncapped) — the log's `eligible`. */
  eligible: number;
  /** W5: the weights these scores were computed with, stored beside them. */
  weights: ScoreWeights;
  /** Redis was unreachable and this came from PostGIS (§19.2). */
  degraded: boolean;
  /** Per-reason tallies, for the log line, the wave log and the specs. */
  excluded: Partial<Record<ExclusionReason, ExclusionDetail>>;
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

/**
 * W5: how many scored candidates a wave log row keeps.
 *
 * Ten is the offer-limit ceiling (`offersPerWave` is capped at 10), so the log
 * can always answer "who did this wave rank top ten, and who was actually
 * offered" without storing the whole candidate store.
 */
const WAVE_LOG_CANDIDATE_CAP = 10;

/**
 * W5: how many driver ids one exclusion reason keeps in a log row.
 *
 * The COUNT is exact; the id list is a capped sample. "1,240 offline" needs no
 * names, and the inspector's expandable list is for answers like the three
 * drivers a suspension-pending rule skipped.
 */
const EXCLUDED_ID_CAP = 20;

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

    // W5: read once, up front. The result carries the weights so the wave log
    // can store "the weights in force" beside the scores they produced — a
    // retuned weight is otherwise unreconstructable after the fact.
    const { weights } = await this.config.load();

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

    const excluded: Partial<Record<ExclusionReason, ExclusionDetail>> = {};
    const count = (reason: ExclusionReason, driverId?: string) => {
      const detail = (excluded[reason] ??= { count: 0, driverIds: [] });
      detail.count += 1;
      if (driverId && detail.driverIds.length < EXCLUDED_ID_CAP) {
        detail.driverIds.push(driverId);
      }
    };

    if (inRange.length === 0) {
      return {
        candidates: [],
        ranked: [],
        eligible: 0,
        weights,
        degraded,
        excluded,
        considered: 0,
      };
    }

    const ids = inRange.map((candidate) => candidate.driverId);
    const [eligibility, alreadyOffered] = await Promise.all([
      this.repo.eligibility(ids, booking.zoneId),
      this.repo.excludedDrivers(booking.id),
    ]);

    const survivors: Array<{ row: DriverEligibilityRow; distanceMeters: number }> = [];

    for (const candidate of inRange) {
      // §6.5: a driver already asked about THIS booking is not asked again on a
      // wider wave. Checked before the row lookup because it needs no row.
      if (alreadyOffered.has(candidate.driverId)) {
        count('already_offered', candidate.driverId);
        continue;
      }

      const row = eligibility.get(candidate.driverId);
      // In the candidate store with no driver row is a data fault, not a
      // decision — skip silently rather than inventing an exclusion reason.
      if (!row) continue;

      // §3.1 layer 4. Redis said approved when they went online; an admin may
      // have suspended them since, and the hash lives for 30 s after that.
      if (row.kycStatus !== 'approved') {
        count('not_approved', row.driverId);
        continue;
      }
      // A14: shelved suspension — the driver finishes their live job but takes
      // no new offers. Checked here rather than only at accept time so a wave
      // does not burn twenty seconds offering to a driver who cannot take it.
      if (row.suspensionPending) {
        count('suspension_pending', row.driverId);
        continue;
      }
      // A15: the fleet counterpart of `not_approved`. A suspended fleet's
      // drivers are not offered jobs however available they look — counted
      // separately so the inspector can tell whose suspension bit.
      if (row.fleetStatus === 'suspended') {
        count('fleet_suspended', row.driverId);
        continue;
      }
      if (!row.isOnline) {
        count('offline', row.driverId);
        continue;
      }
      // §3.2: a wheel-lift cannot take a flatbed job. A driver who has declared
      // no class at all is not offered a tow — the class decides the equipment.
      if (row.vehicleClass !== booking.vehicleClass) {
        count('wrong_vehicle_class', row.driverId);
        continue;
      }
      // The roadside opt-in the driver made at onboarding. Vehicle class says
      // nothing about whether a truck carries a jump pack or a lockout kit —
      // the `service_type` enum has always noted that roadside work is open to
      // both classes, which until now meant open to everyone in range. Tow and
      // accident recovery skip this: their match IS the class check above.
      if (
        !isCoreServiceType(booking.serviceType) &&
        !row.services.includes(booking.serviceType)
      ) {
        count('service_not_offered', row.driverId);
        continue;
      }
      // §3.2's Band C opt-in — a long haul needs a willing driver, not a
      // pricier plan.
      if (booking.longDistance && !row.longDistanceEnabled) {
        count('no_long_distance', row.driverId);
        continue;
      }
      // W6 §6.10: "drivers can be restricted to zones" — an admin's per-zone
      // block. A row for (driver, booking zone) excludes them HERE; the live
      // map keeps drawing them, so an operator can see why supply vanished.
      if (row.zoneRestricted) {
        count('zone_restricted', row.driverId);
        continue;
      }
      // Phase 4's exclusion status. `null` is an independent driver with no
      // fleet truck, which passes — there is nothing to be non-compliant.
      if (row.truckStatus === 'non_compliant') {
        count('truck_non_compliant', row.driverId);
        continue;
      }
      if (row.hasActiveJob) {
        count('already_on_job', row.driverId);
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
        count('holds_offer', s.row.driverId);
        return false;
      }
      return true;
    });

    const scored = available
      .map(({ row, distanceMeters }) => {
        const { total, terms } = computeScore(row, distanceMeters, weights);
        return {
          driverId: row.driverId,
          distanceMeters,
          fleetId: row.fleetId,
          truckId: row.truckId,
          score: total,
          terms,
        };
      })
      .sort((a, b) => b.score - a.score);

    this.logger.debug(
      `booking ${booking.id} wave radius ${radiusKm}km: ${inRange.length} in range, ${scored.length} offered${
        degraded ? ' (postgis)' : ''
      }`,
    );

    return {
      // The offer list: unchanged — top `limit` after scoring.
      candidates: scored.slice(0, limit),
      // W5: pre-slice, capped — what the wave ranked, reached or not.
      ranked: scored.slice(0, WAVE_LOG_CANDIDATE_CAP),
      // W5: everyone who passed every filter (uncapped) — the log's `eligible`.
      eligible: scored.length,
      weights,
      degraded,
      excluded,
      considered: inRange.length,
    };
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
 *
 * W5: returns `{ total, terms }` rather than a bare number. The dispatch
 * inspector has to answer "why did this driver win", and a lone total cannot —
 * the four normalised terms go into `dispatch_wave_logs.candidates` beside the
 * weights in force, and a spec asserts the total is exactly their weighted sum.
 */
function computeScore(
  row: DriverEligibilityRow,
  distanceMeters: number,
  weights: { proximity: number; rating: number; acceptance: number; completion: number },
): { total: number; terms: ScoreTerms } {
  // Linear falloff to the ceiling. Not inverse-square: a driver twice as far
  // away is roughly twice the wait, and squaring would make the term dominate
  // the other three so completely that they might as well not be weighted.
  const terms: ScoreTerms = {
    proximity: Math.max(0, 1 - distanceMeters / PROXIMITY_CEILING_METERS),
    rating: row.rating === null ? NEUTRAL : clamp01(row.rating / 5),
    acceptance: row.acceptanceRate === null ? NEUTRAL : clamp01(row.acceptanceRate / 100),
    completion: row.completionRate === null ? NEUTRAL : clamp01(row.completionRate / 100),
  };

  // Weights are percentages summing to 100 (CHECKed in migration 0011), so the
  // result is a 0–100 score and is directly comparable across zones even if an
  // admin retunes one of them.
  const total =
    terms.proximity * weights.proximity +
    terms.rating * weights.rating +
    terms.acceptance * weights.acceptance +
    terms.completion * weights.completion;

  return { total, terms };
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return NEUTRAL;
  return Math.min(1, Math.max(0, value));
}
