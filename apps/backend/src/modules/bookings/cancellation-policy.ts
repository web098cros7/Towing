import type { CancellationTier, JobStatus } from '@towing/api-contracts';

/**
 * §3.5's cancellation policy.
 *
 * | Window after confirm | Customer charge | Driver compensation |
 * | 0–2 min              | Free            | None                |
 * | 2–10 min             | Partial (₹150)  | Configurable share  |
 * | > 10 min OR driver en route / at pickup | Full base fare | Configurable share |
 *
 * Plus the rule that overrides the clock entirely: **during `SEARCHING`
 * cancellation is always free** — "the customer hasn't been matched yet". A
 * customer who waits eleven minutes for a driver that never came has cost
 * nobody anything.
 *
 * WHY THE WHOLE LADDER IS WRITTEN WHEN ONLY THE FREE BRANCH IS REACHABLE.
 * Nothing can leave `searching` until Phase 17 assigns a driver, so in Phase 15
 * every real cancellation is free. Implementing only that branch would leave
 * the tiers to be invented later by whoever wires the ledger, from the same
 * spec table, with no test — and §3.5 is a table people get wrong. Here it is
 * transcribed once, tested against its own worked examples, and the route
 * refuses the chargeable tiers rather than quietly charging zero for them.
 */

/**
 * §3.5's launch defaults.
 *
 * Phase 19 made them admin-configurable, as the previous version of this
 * comment promised — but they survive as constants because they are still the
 * defaults `DEFAULT_CANCELLATION_CONFIG` is built from, and because
 * `cancellation-policy.spec.ts` transcribes §3.5's worked examples against
 * them. A caller that passes no config gets exactly the behaviour that shipped.
 */
export const CANCELLATION_FREE_WINDOW_MS = 2 * 60 * 1000;
export const CANCELLATION_PARTIAL_WINDOW_MS = 10 * 60 * 1000;
export const CANCELLATION_PARTIAL_FEE_PAISE = 15_000; // ₹150

/**
 * §3.5's driver compensation share, defaulting to 50 %.
 *
 * NOT ZERO, and the asymmetry with the GST default is deliberate. GST defaults
 * to zero so that behaviour is byte-identical until an accountant sets a rate;
 * there is no equivalent "today" here, because every chargeable tier was
 * REFUSED outright until Phase 19. §3.5 says the driver is compensated when a
 * customer cancels on them, so a 0 % default would quietly stiff the driver on
 * the very first real one.
 */
export const CANCELLATION_DRIVER_COMP_PCT = 50;

/** The live values, from `charge_config`. Omit for §3.5's launch defaults. */
export interface CancellationConfig {
  freeWindowMs: number;
  partialWindowMs: number;
  partialFeePaise: number;
  driverCompensationPct: number;
}

export const DEFAULT_CANCELLATION_CONFIG: CancellationConfig = {
  freeWindowMs: CANCELLATION_FREE_WINDOW_MS,
  partialWindowMs: CANCELLATION_PARTIAL_WINDOW_MS,
  partialFeePaise: CANCELLATION_PARTIAL_FEE_PAISE,
  driverCompensationPct: CANCELLATION_DRIVER_COMP_PCT,
};

/** The states in which a driver is already committed — full fare regardless of the clock. */
const DRIVER_COMMITTED: readonly JobStatus[] = ['en_route', 'arrived', 'in_progress'];

export interface CancellationOutcome {
  tier: CancellationTier;
  feePaise: number;
  /** Why this tier — surfaced to the customer before they confirm (§9.1.7). */
  reason: string;
  /**
   * §3.5's compensation to the driver, a share of `feePaise`.
   *
   * ⚠ ITS LEDGER LEG IS AN `adjustment`, NEVER AN EARNING TYPE, and this is the
   * single most likely silent bug in Phase 19. The earnings projector joins
   * `driver_share_credit | fleet_share_credit | fare_credit` to `bookings` by
   * `ref_id` WITH NO STATUS FILTER, so an earning leg on a CANCELLED booking
   * would make it count `gross = booking.total` — the full fare of a trip that
   * never happened — inflating `earnings_daily`, every fleet report and the
   * §9.4.13 GMV chart. And it would trip no invariant at all: `ledgerDrift`
   * filters `status = 'paid'`, while `projectionDrift` compares the projection
   * against the same wrong query, so the two would agree perfectly on a wrong
   * number. See `ledgerKeys.cancellationCompensation`.
   */
  driverCompensationPaise: number;
}

export function cancellationPolicy(params: {
  status: JobStatus;
  confirmedAt: Date;
  basePaise: number;
  now?: Date;
  config?: CancellationConfig;
  /**
   * Whether a driver is on the booking at all. No driver means no
   * compensation, whatever the tier says — there is nobody to compensate.
   */
  hasDriver?: boolean;
}): CancellationOutcome {
  const now = params.now ?? new Date();
  const config = params.config ?? DEFAULT_CANCELLATION_CONFIG;
  const elapsedMs = now.getTime() - params.confirmedAt.getTime();

  /** Applied to every return below, so no branch can forget it. */
  const withCompensation = (outcome: Omit<CancellationOutcome, 'driverCompensationPaise'>) => ({
    ...outcome,
    driverCompensationPaise:
      outcome.tier === 'free' || params.hasDriver === false
        ? 0
        : Math.round((outcome.feePaise * config.driverCompensationPct) / 100),
  });

  // §3.5: "During search (SEARCHING) cancellation is always free". This beats
  // the clock, not the other way round — a ten-minute fruitless search is the
  // platform's failure, not the customer's.
  if (params.status === 'searching') {
    return withCompensation({
      tier: 'free',
      feePaise: 0,
      reason: 'Free while we are still finding you a driver',
    });
  }

  // A driver already moving is owed something whatever the elapsed time says.
  if (DRIVER_COMMITTED.includes(params.status)) {
    return withCompensation({
      tier: 'full',
      feePaise: params.basePaise,
      reason: 'Your driver is already on the way',
    });
  }

  if (elapsedMs <= config.freeWindowMs) {
    return withCompensation({
      tier: 'free',
      feePaise: 0,
      reason: `Free within ${Math.round(config.freeWindowMs / 60_000)} minutes of booking`,
    });
  }

  if (elapsedMs <= config.partialWindowMs) {
    return withCompensation({
      tier: 'partial',
      feePaise: config.partialFeePaise,
      reason:
        `Cancelled between ${Math.round(config.freeWindowMs / 60_000)} and ` +
        `${Math.round(config.partialWindowMs / 60_000)} minutes after booking`,
    });
  }

  return withCompensation({
    tier: 'full',
    feePaise: params.basePaise,
    reason: `Cancelled more than ${Math.round(config.partialWindowMs / 60_000)} minutes after booking`,
  });
}
