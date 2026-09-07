import { z } from 'zod';
import { serviceTypeSchema, surgeBandSchema } from '../common/enums';
import { geoPointSchema } from '../common/geo';
import { unsignedPaiseSchema } from '../common/money';
import { vehicleClassSchema } from '../fleet/trucks';

/**
 * `POST /v1/pricing/estimate` (§16.2, §7.6) — the full line-item breakdown, the
 * commission band and an ETA, in ≤ 2 s.
 *
 * THE CUSTOMER SEES FARES, NEVER COMMISSION (§7.6). There is deliberately no
 * `commissionPaise`, `commissionPct` or `driverPayoutPaise` field anywhere in
 * this file. `pricing.e2e.spec.ts` asserts the served body has none, and
 * `expectMatchesContract` `toEqual`s rather than merely parsing, so a field
 * added to the service without being added here fails the suite rather than
 * leaking. The band itself IS returned — §7.6 names it explicitly, and it is a
 * tier label, not a percentage.
 */

export const pricingEstimateRequestSchema = z.object({
  /** A `services.slug` from `GET /v1/services`. The server maps it to a billable `serviceType`. */
  serviceSlug: z.string().min(1),
  /**
   * Overrides the catalogue row's `defaultVehicleClass`. Required when that is
   * `null` (§9.1.5 step 1 — "vehicle determines class"), ignored when it is not.
   */
  vehicleClass: vehicleClassSchema.optional(),
  pickup: geoPointSchema,
  /** Omitted for roadside services, whose catalogue row has `requiresDrop: false`. */
  drop: geoPointSchema.optional(),
  /**
   * When the tow is for. Decides whether the §7.4 night window applies; defaults
   * to now. Server-evaluated in Asia/Kolkata — a client clock must never be able
   * to move a fare out of the night band.
   */
  scheduledAt: z.iso.datetime().optional(),
});
export type PricingEstimateRequest = z.infer<typeof pricingEstimateRequestSchema>;

/**
 * §7's formula, one field per addend, all integer paise.
 *
 * NO `distanceCharge`. `bookings.distance_charge` exists as a column and has
 * never been written, because §7 has no separate distance term — distance
 * selects the §7.1/§7.2 slab, so it is already inside `basePaise`. Surfacing a
 * permanently-zero row to a customer suggests a charge that does not exist.
 *
 * NO `waitingCharge` either: §7.6 accrues it only after the driver has been at
 * pickup 15 minutes and adds it at completion, so at estimate time it is not
 * merely zero, it is not yet knowable.
 */
export const fareBreakdownSchema = z.object({
  /** §7.1/§7.2 slab, §7.3 long-distance interpolation, or the flat roadside fare. */
  basePaise: unsignedPaiseSchema,
  /** §7.4 night towing, +15 % of base inside the night window. */
  nightPaise: unsignedPaiseSchema,
  /** §7.4 highway pickup, when the resolved zone has `isHighway`. */
  highwayPaise: unsignedPaiseSchema,
  /** §7.4 accident recovery flat add-on. */
  accidentPaise: unsignedPaiseSchema,
  /** §7.4 surge, by the resolved zone's band. */
  surgePaise: unsignedPaiseSchema,
  /**
   * §7.4 waiting, accrued on-site past the free window. Zero on an estimate —
   * nobody has waited yet — and finalized by `complete`.
   */
  waitingPaise: unsignedPaiseSchema.default(0),
  /**
   * The coupon's discount. LIVE SINCE PHASE 19 — the previous comment here
   * said "always 0 until Phase 20 ships promotions", which the plan's own B1
   * slice contradicted by putting `POST /v1/coupons/validate` and the `coupons`
   * table in Phase 19. Applied inside the same transaction that locks the fare,
   * so a booking never carries a discount whose redemption went unrecorded.
   */
  discountPaise: unsignedPaiseSchema,
  /**
   * §14 GST on the taxable subtotal. ZERO until an admin sets
   * `charge_config.tax_pct`, which is the entire premise of Phase 19's
   * GST-ready-but-off schema — so the line renders only when it is non-zero.
   */
  taxPaise: unsignedPaiseSchema.default(0),
  /**
   * base + night + highway + accident + waiting + surge − discount + tax.
   *
   * The pre-tax half of that is the TAXABLE amount, and it — not this total —
   * is what §14.3's commission split is computed on. Crediting a driver a share
   * of the tax is the mistake `ck_bookings_payout_within_total` exists to
   * catch.
   */
  totalPaise: unsignedPaiseSchema,
});
export type FareBreakdown = z.infer<typeof fareBreakdownSchema>;

export const pricingEstimateResponseSchema = z.object({
  serviceSlug: z.string(),
  serviceType: serviceTypeSchema,
  vehicleClass: vehicleClassSchema,
  /** Billed distance, 2 dp. Zero for roadside services, which are flat-rated. */
  distanceKm: z.number().min(0),
  /**
   * Which routing path produced `distanceKm`. `haversine` means the Distance
   * Matrix breaker was open or no key is configured — the §19.2 degradation
   * ladder, surfaced rather than hidden, so the app can caveat the number.
   */
  distanceSource: z.enum(['google_distance_matrix', 'haversine']),
  /** Driving time in minutes, or `null` when only straight-line distance was available. */
  etaMinutes: z.number().int().min(0).nullable(),
  /** §6.10 point-in-polygon result for the pickup. */
  zone: z.object({
    id: z.uuid(),
    name: z.string(),
    surgeBand: surgeBandSchema,
    isHighway: z.boolean(),
  }),
  /** §3.3 tier. A tier label, not a take rate. */
  band: z.enum(['A', 'B', 'C']),
  breakdown: fareBreakdownSchema,
  /** §9.1.5 — drives the surge badge. True whenever `breakdown.surgePaise > 0`. */
  surgeActive: z.boolean(),
});
export type PricingEstimateResponse = z.infer<typeof pricingEstimateResponseSchema>;
