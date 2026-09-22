/**
 * §3.3 commission bands + §14.3 split math, in integer paise.
 *
 * Lives in api-contracts, not the backend, for three reasons:
 *  1. this package is already the shared money vocabulary (`paiseSchema`,
 *     `rupeeStringToPaise`, `paiseToRupeeString`) and already ships non-schema
 *     functions, so this is not a precedent change;
 *  2. `commissionPaise` is genuinely part of the contract — the split DTO
 *     carries `commissionPaise` and a client must be able to verify it;
 *  3. the seed (`apps/backend/src/db/seed/pricing.ts`) and the live settlement
 *     path must be provably the same function, not two implementations that
 *     agree today.
 *
 * §7's only rounding rule: "All computation in paise precision; commission
 * rounded half-up to the paisa; driver net = total − commission (so the two
 * always sum exactly)." Every function here is integer-in / integer-out.
 */

import { z } from 'zod';
import type { ServiceType } from './enums';

export type Band = 'A' | 'B' | 'C';

/**
 * §3.3 launch percentages — the DEFAULTS the `commission_config` table is seeded
 * with, not the runtime source of truth since Phase 14. A live estimate reads
 * the table (admin-editable, §16.5); these are what the seed writes and what
 * every unit test asserts against.
 */
export const BAND_PCT: Record<Band, number> = { A: 10, B: 8, C: 5 };

/**
 * §3.3 guardrail: "admin edits are validated server-side against the floor/cap
 * (5%/10% at launch); attempts outside the band are rejected and audited."
 *
 * SINCE W11 THESE ARE THE SEEDED LAUNCH WINDOW, NOT THE POLICY. Decision G2
 * made the window editable by a super admin: it lives in `commission_guardrail`
 * (one row, seeded 5/10 by migration 0026), the service enforces THAT, and the
 * two database CHECKs were relaxed to the absolute outer bound G2 names
 * (`0 < pct <= 30` — "the DB CHECK still refuses an absurd value").
 *
 * `commissionPctSchema` below therefore validates against the LAUNCH window and
 * is fit for the seed and for tests. A runtime caller must use the row.
 */
export const COMMISSION_PCT_FLOOR = 5;
export const COMMISSION_PCT_CAP = 10;

/**
 * A commission percentage inside the §3.3 LAUNCH window. Two decimal places,
 * `numeric(5,2)`.
 *
 * See the note above: the enforcement window is `commission_guardrail` since
 * W11, so a live write path must read it rather than lean on this schema.
 */
export const commissionPctSchema = z
  .number()
  .min(COMMISSION_PCT_FLOOR)
  .max(COMMISSION_PCT_CAP)
  .multipleOf(0.01);

/**
 * The billable service types the fare engine bands on.
 *
 * Aliased to `ServiceType` rather than re-declared: this used to be an
 * independent copy of the same six strings, so `service_type` could drift here
 * without a single compile error. See `common/enums.ts` for why the enum stayed
 * at six values while Appendix B's catalogue has nine.
 */
export type PricingServiceType = ServiceType;

/** §3.3: service type + billed distance decide the band; accident is always ≥ B. */
export function resolveBand(service: PricingServiceType, distanceKm: number): Band {
  if (distanceKm > 100) return 'C';
  if (service === 'accident_recovery') return 'B';
  if (distanceKm > 40) return 'B';
  return 'A';
}

/**
 * §7: `PlatformEarning = Total × commission%`, rounded half-up to the paisa.
 *
 * THE PERCENTAGE IS A PARAMETER, and that is the whole point of this function
 * existing separately from `commissionPaise` below.
 *
 * Phase 14 made `commission_config` the runtime source of truth for §3.3's
 * percentages — admins can move a band inside the 5–10 guardrail with no
 * deploy. `commissionPaise(total, band)` multiplies by the hard-coded
 * `BAND_PCT` constant instead, so anything locking a fare through it would
 * silently ignore that edit and write economics the admin did not choose. That
 * was harmless while nothing locked a commission (Phase 14's estimate omits it
 * deliberately, §7.6) and becomes real money the moment Phase 15 creates a
 * booking, which is why the split landed there.
 *
 * Live paths pass `rateCard.commissionPct[band]`. `BAND_PCT` remains the
 * seed's and the unit tests' oracle.
 */
export function commissionPaiseAtPct(totalPaise: number, pct: number): number {
  return Math.round((totalPaise * pct) / 100);
}

/**
 * §7 commission at a band's LAUNCH DEFAULT percentage.
 *
 * Retained unchanged for the seed, the golden-fare test and every existing
 * assertion. A live booking must use `commissionPaiseAtPct` with the configured
 * percentage — see above.
 */
export function commissionPaise(totalPaise: number, band: Band): number {
  return commissionPaiseAtPct(totalPaise, BAND_PCT[band]);
}

/**
 * §14.3 two-way split of the driver pool. Largest-remainder style: the fleet
 * leg is rounded and the driver leg is the exact remainder, so the two always
 * sum to the pool to the paisa.
 *
 * §7.5's worked vector: pool 404_910 at 80/20 → fleet 80_982 (₹809.82),
 * driver 323_928 (₹3,239.28).
 *
 * The rounding order is load-bearing — it is the shape 755 seeded ledger rows
 * were written with, and `verifySeedInvariants`' third invariant asserts the
 * legs sum back to `bookings.driver_payout`. Do not "simplify" it to rounding
 * the driver leg instead.
 */
export function splitPool(
  poolPaise: number,
  driverSharePct: number,
): { driverPaise: number; fleetPaise: number } {
  const fleetPaise = Math.round((poolPaise * (100 - driverSharePct)) / 100);
  return { driverPaise: poolPaise - fleetPaise, fleetPaise };
}

/**
 * N-way largest-remainder allocation. The legs always sum to `totalPaise`
 * exactly, whatever the weights — which is the property `splitPool` gives for
 * N=2 and Track B Phase 19 needs for a three-way platform/fleet/driver split.
 *
 * Integer arithmetic throughout: the comparison key is the exact numerator
 * remainder (`total × weight mod sum`), never a float fraction, so ties break
 * deterministically on the lower index rather than on floating-point noise.
 */
export function splitPoolN(totalPaise: number, weights: readonly number[]): number[] {
  if (weights.length === 0) {
    throw new Error('splitPoolN needs at least one weight');
  }
  if (!Number.isSafeInteger(totalPaise)) {
    throw new Error(`splitPoolN needs integer paise, got ${totalPaise}`);
  }

  let weightSum = 0;
  for (const w of weights) {
    if (!Number.isFinite(w) || w < 0) {
      throw new Error(`splitPoolN weights must be non-negative and finite, got ${w}`);
    }
    weightSum += w;
  }
  if (weightSum <= 0) {
    throw new Error('splitPoolN weights must sum to a positive number');
  }

  const legs: number[] = [];
  const remainders: number[] = [];
  for (const w of weights) {
    const numerator = totalPaise * w;
    if (!Number.isSafeInteger(numerator)) {
      throw new Error('splitPoolN overflowed safe-integer range');
    }
    const floor = Math.floor(numerator / weightSum);
    legs.push(floor);
    remainders.push(numerator - floor * weightSum);
  }

  let unallocated = totalPaise - legs.reduce((sum, leg) => sum + leg, 0);
  const byRemainder = remainders
    .map((remainder, index) => ({ remainder, index }))
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index);

  for (let i = 0; unallocated > 0; i += 1, unallocated -= 1) {
    const target = byRemainder[i % byRemainder.length]!.index;
    legs[target] = legs[target]! + 1;
  }

  return legs;
}
