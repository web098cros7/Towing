import {
  boolean,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { adminUsers } from './admin';
import { money, primaryId, timestamps } from './columns';
import {
  commissionBandEnum,
  pricingRuleKindEnum,
  serviceTypeEnum,
  vehicleClassEnum,
} from './enums';

/**
 * §7 pricing + §3.3 commission + §6.2 scoring, as ADMIN-EDITABLE DATA (Phase 14).
 *
 * Until this migration every §7 number was a `const` array in
 * `db/seed/pricing.ts` — a file imported only by the seeder. §6.7 requires these
 * knobs to change "no deploy needed", and §16.5 gives them routes, so they have
 * to be rows.
 *
 * MONEY IS `money()` — NUMERIC(12,2) rupee strings, read back as strings and
 * converted only through `rupeeStringToPaise` / `paiseToRupeeString`. The engine
 * computes in integer paise throughout; the string boundary is the point of the
 * convention (§3.4, and the ledger invariant test that exists to catch a float
 * sneaking in).
 *
 * CHECK CONSTRAINTS ARE HAND-WRITTEN IN MIGRATION 0011 — drizzle-kit emits none.
 * Every rule described in a docblock here has a matching CHECK there; if you add
 * one, add both.
 */

/**
 * Appendix B's nine-entry catalogue, over the six-value `service_type` enum.
 *
 * The enum was deliberately NOT widened to nine (see `common/enums.ts` in
 * contracts for the full argument): car / bike / flatbed / wheel-lift tow all
 * bill as `tow` and differ only in the vehicle class that picks the §7.1 or §7.2
 * slab. They are catalogue rows, not new economics — and a Postgres enum value
 * cannot be dropped, so widening would not have been reversible.
 */
export const services = pgTable(
  'services',
  {
    id: primaryId(),
    /** Stable key the apps map to a bundled icon, e.g. `car_tow`. */
    slug: text('slug').notNull(),
    /** What a booking of this service is billed as. Four tow slugs share `tow`. */
    serviceType: serviceTypeEnum('service_type').notNull(),
    /**
     * The tow class this catalogue entry implies, or NULL when the customer's
     * own vehicle decides it (§9.1.5 step 1).
     */
    defaultVehicleClass: vehicleClassEnum('default_vehicle_class'),
    name: text('name').notNull(),
    description: text('description').notNull(),
    /** Roadside services have no destination — drives §9.1.5's "no drop needed" state. */
    requiresDrop: boolean('requires_drop').notNull().default(false),
    displayOrder: integer('display_order').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('uq_services_slug').on(t.slug),
    index('idx_services_active_order').on(t.isActive, t.displayOrder),
  ],
);

/**
 * §7.1 / §7.2 base slabs, §7.3 long-distance ranges and the flat roadside fares
 * — one table, discriminated by `ruleKind`.
 *
 * One table rather than three because all three answer the same question ("what
 * is the base fare for this service, class and distance?") and the engine walks
 * them in one pass. The shape CHECK in 0011 is what keeps the union honest:
 *
 *   slab           vehicle_class + max_km required · price_max NULL
 *   long_distance  vehicle_class + max_km + price_max required (price is the FLOOR)
 *   roadside       service_type required · max_km and price_max NULL
 *
 * §7.3 gives Band C as RANGES, not points. `price`/`price_max` are that range's
 * floor and ceiling; `pricing.math.ts` interpolates linearly across the slab, so
 * a 149 km tow never costs more than a 151 km one.
 */
export const pricingRules = pgTable(
  'pricing_rules',
  {
    id: primaryId(),
    ruleKind: pricingRuleKindEnum('rule_kind').notNull(),
    /** `roadside` rows only. */
    serviceType: serviceTypeEnum('service_type'),
    /** `slab` and `long_distance` rows only. */
    vehicleClass: vehicleClassEnum('vehicle_class'),
    /** Inclusive upper bound of the distance band, km. NULL on `roadside`. */
    maxKm: numeric('max_km', { precision: 8, scale: 2 }),
    /** Slab price, flat roadside fare, or the §7.3 range FLOOR. */
    price: money('price').notNull(),
    /** §7.3 range CEILING. Non-NULL on `long_distance` only. */
    priceMax: money('price_max'),
    isActive: boolean('is_active').notNull().default(true),
    ...timestamps,
  },
  (t) => [
    // Partial uniques (hand-written in 0011 — drizzle-kit emits no WHERE clause):
    // one active distance band per (kind, class), one active fare per roadside
    // service. Two active rows for the same slab is an ambiguous fare.
    index('idx_pricing_rules_lookup').on(t.ruleKind, t.vehicleClass, t.maxKm),
  ],
);

/**
 * §7.4 additional charges — a SINGLETON row.
 *
 * Explicit typed columns rather than a key/value table: every knob here has a
 * different unit (a percentage, an hour, a rupee amount, a bare multiplier) and
 * a different valid range, and a `value numeric` column can express none of
 * that. The CHECKs in 0011 are the reason this shape was chosen.
 *
 * The singleton is enforced by `singleton boolean NOT NULL DEFAULT true UNIQUE`
 * — a second row can only be inserted by setting the column false, which the
 * CHECK forbids.
 */
export const chargeConfig = pgTable('charge_config', {
  id: primaryId(),
  /** Always `true`; UNIQUE + CHECK make this table hold exactly one row. */
  singleton: boolean('singleton').notNull().default(true).unique(),
  /** §7.4 night towing, percent of base. Launch: 15. */
  nightPct: numeric('night_pct', { precision: 5, scale: 2 }).notNull().default('15.00'),
  /**
   * Night window in IST hours, inclusive start, exclusive end. 22 → 6 wraps
   * midnight; the engine handles start > end explicitly rather than assuming.
   */
  nightStartHour: integer('night_start_hour').notNull().default(22),
  nightEndHour: integer('night_end_hour').notNull().default(6),
  /** §7.4 gives ₹500–₹1,000. ₹500 is the launch value — see ToBeDoneEhsan.md. */
  highwayCharge: money('highway_charge').notNull().default('500.00'),
  accidentCharge: money('accident_charge').notNull().default('1500.00'),
  /** §7.4 / §7.6: waiting accrues only after this many minutes on-site. */
  waitingFreeMinutes: integer('waiting_free_minutes').notNull().default(15),
  waitingPerMinute: money('waiting_per_minute').notNull().default('5.00'),
  /** §7.4 surge is +10–25 %. `standard` is always 0 and has no column. */
  surgePctHigh: numeric('surge_pct_high', { precision: 5, scale: 2 }).notNull().default('10.00'),
  surgePctPeak: numeric('surge_pct_peak', { precision: 5, scale: 2 }).notNull().default('25.00'),
  /**
   * Multiplier on great-circle distance when the Distance Matrix is unavailable
   * (§19.2). Straight-line under-states a road tow; quoting the under-stated
   * number is a loss on every degraded booking. Data, not a magic constant, so
   * it can be tuned against real routes once the Maps key exists.
   */
  haversineRoadFactor: numeric('haversine_road_factor', { precision: 4, scale: 2 })
    .notNull()
    .default('1.30'),

  /**
   * §14 GST on the fare. DEFAULTS TO ZERO, so nothing computes differently
   * until somebody sets it — which is the entire point of shipping the tax
   * schema in Phase 19 rather than migrating live money rows later. The rate
   * itself needs an Indian indirect-tax professional, not an engineer; see
   * ToBeDoneEhsan.md. `tax_label` is what the invoice prints beside the line.
   */
  taxPct: numeric('tax_pct', { precision: 5, scale: 2 }).notNull().default('0.00'),
  taxLabel: text('tax_label').notNull().default('GST'),

  /**
   * §3.5's cancellation ladder. These three were TypeScript `export const`s in
   * `cancellation-policy.ts` from Phase 15, whose own comment promised the
   * admin-configurable versions to Phase 19. The defaults reproduce those
   * constants exactly, so the §3.5 worked examples in
   * `cancellation-policy.spec.ts` keep passing untouched.
   */
  cancelFreeMinutes: integer('cancel_free_minutes').notNull().default(2),
  cancelPartialMinutes: integer('cancel_partial_minutes').notNull().default(10),
  cancelPartialFee: money('cancel_partial_fee').notNull().default('150.00'),

  /**
   * The driver's share of a chargeable cancellation fee.
   *
   * 50, NOT ZERO — and the asymmetry with `tax_pct` above is deliberate.
   * `tax_pct` is zero to keep behaviour byte-identical, but there is no
   * equivalent "today" here: every chargeable tier was refused outright with
   * 409 `cancellation_not_free` until Phase 19, so this is the first release in
   * which the branch is reachable at all. §3.5 says the driver IS compensated
   * when a customer cancels on them; a 0 % default would quietly stiff them on
   * the very first one.
   */
  cancelDriverCompPct: numeric('cancel_driver_comp_pct', { precision: 5, scale: 2 })
    .notNull()
    .default('50.00'),

  /**
   * §14.4's Finance gate. "Admin Finance approves where required" never says
   * WHICH payouts require it; this is the answer. At or below the threshold a
   * payout auto-approves and goes straight to the provider; above it, it waits
   * in §9.4.10's queue. ₹1,000.00 at launch.
   *
   * FLEET PAYOUTS JOIN THIS RULE. They bypassed approval entirely from Phase 7
   * until Phase 19 — a behaviour change, not a new feature, and one that
   * belongs in a release note.
   */
  payoutAutoApproveMax: money('payout_auto_approve_max').notNull().default('100000.00'),
  ...timestamps,
});

/**
 * §3.3 commission percentages — one row per band, admin-editable within the
 * guardrail.
 *
 * `ck_commission_config_guardrail CHECK (pct >= 5 AND pct <= 10)` in 0011 is
 * deliberately the same bound as `ck_bookings_commission_pct_guardrail`, which
 * has guarded `bookings.commission_pct` since migration 0002. If this table were
 * allowed to hold 12 while that column rejects it, the failure would not surface
 * at the admin's edit — it would surface as an insert error on the first booking
 * afterwards, with no way to attribute it.
 */
export const commissionConfig = pgTable('commission_config', {
  id: primaryId(),
  band: commissionBandEnum('band').notNull().unique(),
  pct: numeric('pct', { precision: 5, scale: 2 }).notNull(),
  /** No cascade — a config row must outlive the admin who last touched it. */
  updatedBy: uuid('updated_by').references(() => adminUsers.id),
  ...timestamps,
});

/**
 * Append-only record of every commission change (§3.3 "versioned + audited",
 * §16.5).
 *
 * `createdAt` only, no `...timestamps` — a history row is never updated, the
 * same rule `booking_status_history` and `admin_actions` follow. `adminActionId`
 * links to the `admin_actions` row written in the same transaction, so the two
 * audit trails join rather than duplicating each other's context.
 */
export const commissionConfigHistory = pgTable(
  'commission_config_history',
  {
    id: primaryId(),
    band: commissionBandEnum('band').notNull(),
    /** NULL only for the seeded genesis rows, which had nothing before them. */
    oldPct: numeric('old_pct', { precision: 5, scale: 2 }),
    newPct: numeric('new_pct', { precision: 5, scale: 2 }).notNull(),
    changedBy: uuid('changed_by').references(() => adminUsers.id),
    adminActionId: uuid('admin_action_id'),
    reason: text('reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // `desc nulls last` spelled out — drizzle-kit emits DESC as NULLS LAST and an
    // ORDER BY that only says `desc` gets a Sort node bolted on (engineering note 5).
    index('idx_commission_history_band').on(t.band, t.createdAt.desc().nullsLast()),
  ],
);

/**
 * §6.2 scorer weights + §6.1 liveness threshold — the GLOBAL half of §6.7, a
 * singleton row.
 *
 * CREATED IN PHASE 14, CONSUMED IN PHASE 17. That ordering is the point: Phase
 * 17's matcher is required to read every weight at query time, and if the table
 * does not exist when the matcher is written, the weights become constants and
 * retrofitting a config service afterwards is a matcher rewrite.
 *
 * NOTE THE NAME COLLISION, IT IS DELIBERATE. This TABLE holds what is global.
 * The `service_zones.dispatch_config` COLUMN holds what is per-zone — radius
 * ladders, offer timing, wave size. A ladder is a property of a city; a scoring
 * weight is a property of the marketplace. Both are modelled by
 * `common/dispatch-config.ts` in contracts.
 */
export const dispatchConfig = pgTable('dispatch_config', {
  id: primaryId(),
  singleton: boolean('singleton').notNull().default(true).unique(),
  /** §6.2 — proximity/ETA 60 %, rating 15 %, acceptance 15 %, completion 10 %. Sum CHECKed = 100. */
  weightProximity: numeric('weight_proximity', { precision: 5, scale: 2 }).notNull().default('60.00'),
  weightRating: numeric('weight_rating', { precision: 5, scale: 2 }).notNull().default('15.00'),
  weightAcceptance: numeric('weight_acceptance', { precision: 5, scale: 2 })
    .notNull()
    .default('15.00'),
  weightCompletion: numeric('weight_completion', { precision: 5, scale: 2 })
    .notNull()
    .default('10.00'),
  /** §6.1 — liveness is PING FRESHNESS, not socket connectivity. */
  stalePingSeconds: integer('stale_ping_seconds').notNull().default(15),
  /** §3.8 / §6.7. Read by Phase 15's booking-creation guard. */
  oneActiveBookingPerCustomer: boolean('one_active_booking_per_customer').notNull().default(true),
  /**
   * §3.8: "Customer with unpaid prior balance: blocked from new bookings until
   * cleared (admin-configurable)." This is the admin-configurable part.
   *
   * "Unpaid" is a booking left in `completed` — §5.1 distinguishes `completed`
   * (delivered) from `paid` (settled), so the condition needs no new table and
   * no customer wallet, which is just as well: `wallet_owner_type` reserves
   * 'user' and nothing has ever created one.
   */
  blockOnUnpaidBalance: boolean('block_on_unpaid_balance').notNull().default(true),
  ...timestamps,
});
