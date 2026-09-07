import {
  BAND_PCT,
  commissionPaise,
  paiseToRupeeString,
  resolveBand,
  splitPool,
  splitPoolN,
  type Band,
  type ServiceType,
  type SurgeBand,
} from '@towing/api-contracts';

/**
 * §7 fare engine — pure arithmetic, integer paise in, integer paise out.
 *
 * PROMOTED FROM `db/seed/pricing.ts` IN PHASE 14, not rewritten. That file was a
 * complete and unit-tested §7.1/§7.2/§7.3 implementation that lived under
 * `db/seed` and was imported only by the seeder; the slabs move here, the
 * fixture RNG (`createRng`/`pick`/`weighted`) stays there, and `pricing.spec.ts`
 * moved with the slabs. Phase 7 had already promoted the §3.3 bands, the
 * commission formula and the §14.3 split into `@towing/api-contracts` — those
 * are re-exported below rather than re-implemented, for exactly the reason that
 * move was made: the seed and the live path must be provably the same function,
 * not two implementations that agree today.
 *
 * TWO DELIBERATE BEHAVIOUR CHANGES FROM THE SEED VERSION, both documented at
 * their call site below:
 *  1. Band C no longer draws a random point in the §7.3 range — it interpolates.
 *  2. Surge applies to the pre-surge SUBTOTAL, not to the base alone.
 *
 * All arithmetic is integer paise; conversion to the NUMERIC(12,2) rupee strings
 * the schema stores happens only at `toRupees`. Floats never touch money.
 */

export {
  BAND_PCT,
  commissionPaise,
  resolveBand,
  splitPool,
  splitPoolN,
  type Band,
} from '@towing/api-contracts';

export type VehicleClass = 'wheel_lift' | 'flatbed';

/** The one string-space boundary. Round-trips with `rupeeStringToPaise`. */
export const toRupees = paiseToRupeeString;

/** One row of `pricing_rules`, in the shape the engine walks. */
export interface DistanceBandRule {
  /** Inclusive upper bound of the band, km. */
  maxKm: number;
  /** Slab price, or — for a long-distance band — the §7.3 range FLOOR. */
  pricePaise: number;
  /** §7.3 range CEILING; null on a plain slab. */
  priceMaxPaise: number | null;
}

/**
 * Everything `baseFarePaise` needs, loaded from `pricing_rules` at runtime and
 * defaulted to the constants below in tests and in the seed.
 */
export interface PricingRuleSet {
  /** §7.1 / §7.2, ascending by `maxKm`, per class. */
  slabs: Record<VehicleClass, DistanceBandRule[]>;
  /** §7.3, ascending by `maxKm`. Flatbed only — see `baseFarePaise`. */
  longDistance: DistanceBandRule[];
  /** Flat per-service roadside fares. */
  roadside: Partial<Record<ServiceType, number>>;
}

/** §7.1 wheel-lift base slabs: [maxKm, pricePaise]. */
const WHEEL_LIFT_SLABS: DistanceBandRule[] = [
  { maxKm: 5, pricePaise: 99_900, priceMaxPaise: null },
  { maxKm: 10, pricePaise: 149_900, priceMaxPaise: null },
  { maxKm: 20, pricePaise: 219_900, priceMaxPaise: null },
  { maxKm: 40, pricePaise: 349_900, priceMaxPaise: null },
  { maxKm: 60, pricePaise: 499_900, priceMaxPaise: null },
  { maxKm: 80, pricePaise: 649_900, priceMaxPaise: null },
  { maxKm: 100, pricePaise: 799_900, priceMaxPaise: null },
];

/** §7.2 flatbed base slabs. */
const FLATBED_SLABS: DistanceBandRule[] = [
  { maxKm: 5, pricePaise: 199_900, priceMaxPaise: null },
  { maxKm: 10, pricePaise: 299_900, priceMaxPaise: null },
  { maxKm: 20, pricePaise: 449_900, priceMaxPaise: null },
  { maxKm: 40, pricePaise: 649_900, priceMaxPaise: null },
  { maxKm: 60, pricePaise: 849_900, priceMaxPaise: null },
  { maxKm: 80, pricePaise: 1_099_900, priceMaxPaise: null },
  { maxKm: 100, pricePaise: 1_349_900, priceMaxPaise: null },
];

/** §7.3 long-distance ranges: floor..ceiling per band. */
const LONG_DISTANCE_RANGES: DistanceBandRule[] = [
  { maxKm: 150, pricePaise: 1_600_000, priceMaxPaise: 2_000_000 },
  { maxKm: 250, pricePaise: 2_200_000, priceMaxPaise: 3_000_000 },
  { maxKm: 400, pricePaise: 3_500_000, priceMaxPaise: 4_800_000 },
  { maxKm: 600, pricePaise: 5_500_000, priceMaxPaise: 7_500_000 },
];

/** Flat roadside fares (Appendix B tier). `tow` and `accident_recovery` are absent by design. */
const ROADSIDE_FARE: Partial<Record<ServiceType, number>> = {
  battery: 79_900,
  flat_tyre: 69_900,
  fuel: 69_900,
  breakdown: 99_900,
};

/**
 * The launch matrix. Seeded into `pricing_rules` by `db/seed`, and the default
 * `baseFarePaise` falls back to — so every existing unit assertion holds
 * unchanged, and a test does not need a database to price a tow.
 */
export const DEFAULT_PRICING_RULES: PricingRuleSet = {
  slabs: { wheel_lift: WHEEL_LIFT_SLABS, flatbed: FLATBED_SLABS },
  longDistance: LONG_DISTANCE_RANGES,
  roadside: ROADSIDE_FARE,
};

/** Where §7.3's first long-distance band starts, and where Band C begins (§3.3). */
export const LONG_DISTANCE_FLOOR_KM = 100;

/**
 * §7.3's last row is "600 km+ — Custom quote (manual at launch)". Past this the
 * engine has no price to give and the caller must refuse the booking; the
 * manual-quote admin path is post-launch.
 */
export const CUSTOM_QUOTE_ABOVE_KM = 600;

/** Thrown when §7.3 hands the distance to a human. Callers turn it into a 422. */
export class CustomQuoteRequiredError extends Error {
  constructor(readonly distanceKm: number) {
    super(`Distances over ${CUSTOM_QUOTE_ABOVE_KM} km need a manual quote (§7.3)`);
    this.name = 'CustomQuoteRequiredError';
  }
}

/**
 * §7.1 / §7.2 / §7.3 base fare.
 *
 * THE `rng` PARAMETER IS GONE. It existed because the seed drew a random point
 * inside §7.3's published range; a live estimate cannot, since quoting the same
 * tow twice must give the same number. `rules` took its place and defaults to
 * the launch matrix, so every slab and roadside assertion in the promoted spec
 * holds byte-identical.
 *
 * BAND C INTERPOLATES. §7.3 gives ranges, not points: 100–150 km is
 * ₹16,000–₹20,000. The fare scales linearly from the floor at the band's lower
 * bound to the ceiling at its upper bound, then rounds to whole rupees (long
 * -distance quotes are human-negotiated numbers). This is monotonic in distance
 * — a 149 km tow never costs more than a 151 km one — and always lands inside
 * the published range, which is what lets the promoted range assertions stand.
 *
 * LONG DISTANCE IS FLATBED. §7.3 is titled "Long-Distance Flatbed" and §3.3
 * Band C is "Flatbed hauling", so `vehicleClass` is not consulted past
 * `LONG_DISTANCE_FLOOR_KM`. The seed only ever generated >100 km distances for
 * flatbed bookings, so this is also exactly the behaviour it had.
 */
export function baseFarePaise(
  service: ServiceType,
  vehicleClass: VehicleClass,
  distanceKm: number,
  rules: PricingRuleSet = DEFAULT_PRICING_RULES,
): number {
  const roadside = rules.roadside[service];
  if (roadside !== undefined) return roadside;

  if (distanceKm > LONG_DISTANCE_FLOOR_KM) {
    if (distanceKm > CUSTOM_QUOTE_ABOVE_KM) throw new CustomQuoteRequiredError(distanceKm);
    return longDistanceFarePaise(distanceKm, rules.longDistance);
  }

  const slabs = rules.slabs[vehicleClass];
  const slab = slabs.find(({ maxKm }) => distanceKm <= maxKm) ?? slabs[slabs.length - 1]!;
  return slab.pricePaise;
}

function longDistanceFarePaise(distanceKm: number, bands: DistanceBandRule[]): number {
  let lowerKm = LONG_DISTANCE_FLOOR_KM;
  for (const band of bands) {
    if (distanceKm <= band.maxKm) {
      const ceiling = band.priceMaxPaise ?? band.pricePaise;
      const span = band.maxKm - lowerKm;
      // A zero-width band would divide by zero; treat it as its floor.
      const t = span > 0 ? (distanceKm - lowerKm) / span : 0;
      const interpolated = band.pricePaise + t * (ceiling - band.pricePaise);
      return Math.round(interpolated / 100) * 100;
    }
    lowerKm = band.maxKm;
  }
  // Unreachable while CUSTOM_QUOTE_ABOVE_KM matches the last band's maxKm, but a
  // rule set edited from the admin API can end lower than the constant does.
  const last = bands[bands.length - 1]!;
  return Math.round((last.priceMaxPaise ?? last.pricePaise) / 100) * 100;
}

/** The §7.4 knobs, as loaded from `charge_config`. Percentages are whole numbers (15 = 15 %). */
export interface ChargeConfigValues {
  nightPct: number;
  nightStartHour: number;
  nightEndHour: number;
  highwayChargePaise: number;
  accidentChargePaise: number;
  waitingFreeMinutes: number;
  waitingPerMinutePaise: number;
  surgePctHigh: number;
  surgePctPeak: number;
  haversineRoadFactor: number;
  /** §14 GST on the taxable subtotal. Zero until an accountant says otherwise. */
  taxPct: number;
  taxLabel: string;
  /** §3.5's cancellation ladder, admin-configurable since Phase 19. */
  cancelFreeMinutes: number;
  cancelPartialMinutes: number;
  cancelPartialFeePaise: number;
  cancelDriverCompPct: number;
  /** §14.4's Finance gate. At or below this, a payout skips the queue. */
  payoutAutoApproveMaxPaise: number;
}

/** The launch values, mirroring `charge_config`'s column defaults. */
export const DEFAULT_CHARGE_CONFIG: ChargeConfigValues = {
  nightPct: 15,
  nightStartHour: 22,
  nightEndHour: 6,
  highwayChargePaise: 50_000,
  accidentChargePaise: 150_000,
  waitingFreeMinutes: 15,
  waitingPerMinutePaise: 500,
  surgePctHigh: 10,
  surgePctPeak: 25,
  haversineRoadFactor: 1.3,
  // §14 GST. ZERO, and that is the entire premise of Phase 19 shipping the tax
  // schema without a tax: nothing computes differently until an admin sets a
  // rate, and the rate needs an Indian indirect-tax professional rather than an
  // engineer. See ToBeDoneEhsan.md.
  taxPct: 0,
  taxLabel: 'GST',
  // §3.5's ladder. These reproduce `cancellation-policy.ts`'s constants
  // exactly, so its §3.5 worked examples keep passing untouched.
  cancelFreeMinutes: 2,
  cancelPartialMinutes: 10,
  cancelPartialFeePaise: 15_000,
  // 50, not 0 — see the schema. The chargeable tiers were refused outright
  // until Phase 19, so there is no prior behaviour to preserve, and §3.5 says
  // the driver IS compensated when a customer cancels on them.
  cancelDriverCompPct: 50,
  // §14.4's Finance gate: ₹1,00,000. Everything at or below this auto-approves.
  payoutAutoApproveMaxPaise: 10_000_000,
};

/**
 * Is `hour` inside the night window? Handles the wrapping case (22 → 6) rather
 * than assuming start < end, because the launch window wraps midnight and a
 * naive `hour >= start && hour < end` is false for every hour of it.
 */
export function isNightHour(hour: number, startHour: number, endHour: number): boolean {
  return startHour <= endHour
    ? hour >= startHour && hour < endHour
    : hour >= startHour || hour < endHour;
}

/** Surge percentage for a zone's band. `standard` is always 0 (§7.4 gives 10–25 % for the rest). */
export function surgePctFor(band: SurgeBand, charges: ChargeConfigValues): number {
  if (band === 'high') return charges.surgePctHigh;
  if (band === 'peak') return charges.surgePctPeak;
  return 0;
}

export interface FareInput {
  service: ServiceType;
  vehicleClass: VehicleClass;
  distanceKm: number;
  /** Hour-of-day in the operating timezone, 0–23. Decides the §7.4 night window. */
  hourOfDay: number;
  /** §7.4 — true when the PICKUP falls in a zone flagged `is_highway`. */
  isHighwayPickup: boolean;
  surgeBand: SurgeBand;
  /** Minutes the driver waited on-site. 0 at estimate time — §7.6 adds it at completion. */
  waitingMinutes?: number;
  discountPaise?: number;
  rules?: PricingRuleSet;
  charges?: ChargeConfigValues;
}

/**
 * §7.4/§7.6's waiting charge — free for the first N minutes, then per-minute.
 *
 * EXTRACTED SO PHASE 18 CAN CALL IT WITHOUT CALLING `computeFare`, and that is
 * the point rather than tidiness. When a job completes, waiting is the ONLY
 * component that may move: base, night, highway, accident, surge and discount
 * were all locked at confirm (§3.4) and re-running the whole formula against
 * today's rules risks quietly re-deriving one of them — a rate-card edit made
 * mid-trip would then reach a booking it must never touch. The finalizer adds
 * this one number to the locked total and leaves everything else alone.
 *
 * It takes the free window and the per-minute rate as ARGUMENTS rather than
 * reading a config, because the finalizer passes the values snapshotted on the
 * booking row (migration 0015), not the live ones.
 */
export function waitingChargePaise(
  waitedMinutes: number,
  freeMinutes: number,
  perMinutePaise: number,
): number {
  const billable = Math.max(0, waitedMinutes - freeMinutes);
  return billable * perMinutePaise;
}

export interface FareResult {
  basePaise: number;
  nightPaise: number;
  highwayPaise: number;
  accidentPaise: number;
  waitingPaise: number;
  surgePaise: number;
  discountPaise: number;
  totalPaise: number;
  band: Band;
}

/**
 * The whole §7 formula, in the order the spec writes it.
 *
 * SURGE APPLIES TO THE PRE-SURGE SUBTOTAL, NOT TO THE BASE. §7's formula block
 * lists the addends without naming surge's operand, but §7.5's third worked
 * example pins it: "base ₹3,499 + ₹1,500 accident = ₹4,999 → +20 % surge
 * ₹999.80". ₹4,999 × 20 % is ₹999.80; ₹3,499 × 20 % is ₹699.80. The seed had it
 * on the base alone and therefore under-charged surge on every accident
 * recovery and every night tow — corrected here, and `pricing.math.spec.ts`
 * reproduces all five §7.5 vectors end to end so it cannot drift back.
 *
 * The discount is subtracted last and clamped, so a coupon larger than the fare
 * cannot produce a negative total (`ck_bookings_non_negative` would reject it).
 */
export function computeFare(input: FareInput): FareResult {
  const rules = input.rules ?? DEFAULT_PRICING_RULES;
  const charges = input.charges ?? DEFAULT_CHARGE_CONFIG;

  const basePaise = baseFarePaise(input.service, input.vehicleClass, input.distanceKm, rules);

  const nightPaise = isNightHour(input.hourOfDay, charges.nightStartHour, charges.nightEndHour)
    ? Math.round((basePaise * charges.nightPct) / 100)
    : 0;

  const highwayPaise = input.isHighwayPickup ? charges.highwayChargePaise : 0;
  const accidentPaise =
    input.service === 'accident_recovery' ? charges.accidentChargePaise : 0;

  const waitingPaise = waitingChargePaise(
    input.waitingMinutes ?? 0,
    charges.waitingFreeMinutes,
    charges.waitingPerMinutePaise,
  );

  const preSurgePaise = basePaise + nightPaise + highwayPaise + accidentPaise + waitingPaise;
  const surgePct = surgePctFor(input.surgeBand, charges);
  const surgePaise = surgePct > 0 ? Math.round((preSurgePaise * surgePct) / 100) : 0;

  const discountPaise = Math.min(input.discountPaise ?? 0, preSurgePaise + surgePaise);
  const totalPaise = preSurgePaise + surgePaise - discountPaise;

  return {
    basePaise,
    nightPaise,
    highwayPaise,
    accidentPaise,
    waitingPaise,
    surgePaise,
    discountPaise,
    totalPaise,
    band: resolveBand(input.service, input.distanceKm),
  };
}

/**
 * Great-circle distance in metres.
 *
 * The repo had no Haversine before Phase 14 — the only mention was
 * `simulate-locations.ts` declining to bother with the trig for a simulator.
 * This one is load-bearing: it is the §19.2 fallback that prices a tow when the
 * Distance Matrix breaker is open, so it is the difference between a degraded
 * estimate and no estimate at all.
 */
export function haversineMeters(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
): number {
  const EARTH_RADIUS_M = 6_371_008.8;
  const toRad = (deg: number) => (deg * Math.PI) / 180;

  const dLat = toRad(to.lat - from.lat);
  const dLng = toRad(to.lng - from.lng);
  const lat1 = toRad(from.lat);
  const lat2 = toRad(to.lat);

  const a =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)));
}
