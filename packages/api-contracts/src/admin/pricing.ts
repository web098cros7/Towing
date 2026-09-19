import { z } from 'zod';
import { serviceTypeSchema } from '../common/enums';
import { unsignedPaiseSchema } from '../common/money';
import { commissionPctSchema } from '../common/pricing';
import { vehicleClassSchema } from '../fleet/trucks';

/**
 * §16.5 `GET/PUT /v1/admin/pricing` and `GET/PUT /v1/admin/commission`, RBAC-gated
 * to `super_admin | finance`, audited on every change.
 *
 * These routes exist in Phase 14 because the §3.3 guardrail needs a way to be
 * exercised. Phase 14 builds the floor/cap check, the `commission_config` CHECK
 * and `commission_config_history`; without a route, none of the three could ever
 * be tripped, and "validated server-side" would be an untested claim. The thin
 * admin FORMS over these endpoints are Phase 20 · B3.
 *
 * EVERY UPDATE FIELD IS `.optional()` WITH NO `.default()`. Phase 13 shipped and
 * then fixed a bug where `.partial()` preserved field defaults, so a one-key PUT
 * arrived as every key and silently reset the rest — the same defect was found
 * dormant in `fleetSettingsUpdateSchema`. On a pricing table that would rewrite
 * the whole fare matrix from a single-field edit.
 */

export const pricingRuleKindSchema = z.enum(['slab', 'long_distance', 'roadside']);
export type PricingRuleKind = z.infer<typeof pricingRuleKindSchema>;

/** One row of `pricing_rules` — a §7.1/§7.2 slab, a §7.3 range, or a flat roadside fare. */
export const adminPricingRuleSchema = z.object({
  id: z.uuid(),
  ruleKind: pricingRuleKindSchema,
  /** Roadside rows only — which flat-rated service this is. */
  serviceType: serviceTypeSchema.nullable(),
  /** Slab and long-distance rows only. */
  vehicleClass: vehicleClassSchema.nullable(),
  /** Upper bound of the distance band, km. Null on roadside rows. */
  maxKm: z.number().nullable(),
  /** The slab price, the flat fare, or — for `long_distance` — the range FLOOR. */
  pricePaise: unsignedPaiseSchema,
  /** §7.3 range CEILING. Non-null on `long_distance` rows only. */
  priceMaxPaise: unsignedPaiseSchema.nullable(),
  isActive: z.boolean(),
});
export type AdminPricingRule = z.infer<typeof adminPricingRuleSchema>;

/** §7.4 additional charges — the singleton `charge_config` row. */
export const adminChargeConfigSchema = z.object({
  /** §7.4 night towing, percent of base. */
  nightPct: z.number().min(0).max(100),
  /** Night window, IST hours. Wraps midnight when start > end (22 → 6 does). */
  nightStartHour: z.number().int().min(0).max(23),
  nightEndHour: z.number().int().min(0).max(23),
  /** §7.4 gives ₹500–₹1,000; ₹500 is the seeded launch value. */
  highwayChargePaise: unsignedPaiseSchema,
  accidentChargePaise: unsignedPaiseSchema,
  waitingFreeMinutes: z.number().int().min(0).max(120),
  waitingPerMinutePaise: unsignedPaiseSchema,
  /** §7.4 surge is +10–25 %; `standard` is always 0 and is not editable. */
  surgePctHigh: z.number().min(0).max(100),
  surgePctPeak: z.number().min(0).max(100),
  /**
   * Multiplier applied to great-circle distance when the Distance Matrix is
   * unavailable (§19.2). Straight-line under-states a road tow, and quoting the
   * under-stated number is a business loss on every degraded booking.
   */
  haversineRoadFactor: z.number().min(1).max(3),
});
export type AdminChargeConfig = z.infer<typeof adminChargeConfigSchema>;

/** `GET /v1/admin/pricing`. */
export const adminPricingConfigSchema = z.object({
  charges: adminChargeConfigSchema,
  rules: z.array(adminPricingRuleSchema),
});
export type AdminPricingConfig = z.infer<typeof adminPricingConfigSchema>;

/**
 * `POST /v1/admin/pricing/rules` — W10's "add a slab" (the update schema can
 * only edit rows that already exist, so the matrices were unextendable).
 *
 * THE THREE-WAY SHAPE IS MIRRORED FROM `ck_pricing_rules_shape`, deliberately
 * duplicated: the CHECK is the backstop that catches a hand-edited database,
 * and this schema is what turns a wrong shape into a field-level 422 instead of
 * a 500 from Postgres. A `roadside` row carrying a `max_km` no lookup path
 * reads, or a `long_distance` row without its ceiling, is refused in both
 * places with the same rule.
 *
 * Uniqueness is NOT checked here: `uq_pricing_rules_distance_band` and
 * `uq_pricing_rules_roadside` are PARTIAL (active rows only), so whether a new
 * band collides depends on which rows are currently active. The service maps
 * the unique violation to a 422 naming the band.
 */
export const adminPricingRuleCreateSchema = z
  .object({
    ruleKind: pricingRuleKindSchema,
    /** Roadside rows only — which flat-rated service this is. */
    serviceType: serviceTypeSchema.nullable().optional(),
    /** Slab and long-distance rows only. */
    vehicleClass: vehicleClassSchema.nullable().optional(),
    /** Upper bound of the distance band, km. Null on roadside rows. */
    maxKm: z.number().positive().max(10_000).nullable().optional(),
    /** The slab price, the flat fare, or — for `long_distance` — the range FLOOR. */
    pricePaise: unsignedPaiseSchema,
    /** §7.3 range CEILING. Required on `long_distance` rows, refused elsewhere. */
    priceMaxPaise: unsignedPaiseSchema.nullable().optional(),
    reason: z.string().min(3).max(500).optional(),
  })
  .superRefine((rule, ctx) => {
    const fail = (path: string, message: string) =>
      ctx.addIssue({ code: 'custom', path: [path], message });

    if (rule.ruleKind === 'roadside') {
      if (!rule.serviceType) fail('serviceType', 'a roadside fare must name its service');
      if (rule.vehicleClass != null || rule.maxKm != null || rule.priceMaxPaise != null) {
        fail('ruleKind', 'a roadside row carries no vehicle class, distance band or ceiling');
      }
      return;
    }

    if (!rule.vehicleClass) fail('vehicleClass', `${rule.ruleKind} rows must name a vehicle class`);
    if (rule.maxKm == null) fail('maxKm', `${rule.ruleKind} rows must carry their distance band`);
    if (rule.serviceType != null) fail('serviceType', 'distance rows do not name a service');

    if (rule.ruleKind === 'long_distance') {
      if (rule.priceMaxPaise == null) {
        fail('priceMaxPaise', 'a long-distance row needs its range ceiling');
      }
    } else if (rule.priceMaxPaise != null) {
      fail('priceMaxPaise', 'a slab row is a single price');
    }

    // §7.3 interpolates floor → ceiling; inverted bounds would quote a longer
    // tow LESS than a shorter one (`ck_pricing_rules_price_range`).
    if (rule.priceMaxPaise != null && rule.priceMaxPaise < rule.pricePaise) {
      fail('priceMaxPaise', 'the ceiling must not be below the floor');
    }
  });
export type AdminPricingRuleCreate = z.infer<typeof adminPricingRuleCreateSchema>;

/** `POST /v1/admin/pricing/rules/:id/deactivate` — retire, never hard-delete. */
export const adminPricingRuleDeactivateSchema = z.object({
  reason: z.string().min(3).max(500).optional(),
});
export type AdminPricingRuleDeactivate = z.infer<typeof adminPricingRuleDeactivateSchema>;

/**
 * A `pricing_config` row from `admin_actions` — `GET /v1/admin/pricing/history`.
 *
 * NO NEW TABLE. Every pricing write already stores the whole before and after,
 * so the version history §9.4.8 asks for exists; this endpoint is the read of
 * it. Before/after stay `unknown` for the same reason the audit detail's do:
 * the shape belongs to the writer.
 */
export const adminPricingHistoryEntrySchema = z.object({
  id: z.uuid(),
  adminId: z.uuid(),
  action: z.string(),
  reason: z.string().nullable(),
  before: z.unknown().nullable(),
  after: z.unknown().nullable(),
  createdAt: z.iso.datetime(),
});
export type AdminPricingHistoryEntry = z.infer<typeof adminPricingHistoryEntrySchema>;

/** `PUT /v1/admin/pricing`. Charges are patched key-by-key; rules are edited by id. */
export const adminPricingUpdateSchema = z
  .object({
    charges: z
      .object({
        nightPct: z.number().min(0).max(100).optional(),
        nightStartHour: z.number().int().min(0).max(23).optional(),
        nightEndHour: z.number().int().min(0).max(23).optional(),
        highwayChargePaise: unsignedPaiseSchema.optional(),
        accidentChargePaise: unsignedPaiseSchema.optional(),
        waitingFreeMinutes: z.number().int().min(0).max(120).optional(),
        waitingPerMinutePaise: unsignedPaiseSchema.optional(),
        surgePctHigh: z.number().min(0).max(100).optional(),
        surgePctPeak: z.number().min(0).max(100).optional(),
        haversineRoadFactor: z.number().min(1).max(3).optional(),
      })
      .optional(),
    rules: z
      .array(
        z.object({
          id: z.uuid(),
          pricePaise: unsignedPaiseSchema.optional(),
          priceMaxPaise: unsignedPaiseSchema.nullable().optional(),
          isActive: z.boolean().optional(),
        }),
      )
      .optional(),
    reason: z.string().min(3).max(500).optional(),
  })
  .refine((body) => body.charges !== undefined || (body.rules?.length ?? 0) > 0, {
    message: 'Nothing to update',
  });
export type AdminPricingUpdate = z.infer<typeof adminPricingUpdateSchema>;

/** One band's live percentage, plus who last moved it. */
export const adminCommissionBandSchema = z.object({
  band: z.enum(['A', 'B', 'C']),
  pct: z.number(),
  updatedAt: z.iso.datetime(),
  updatedBy: z.uuid().nullable(),
});
export type AdminCommissionBand = z.infer<typeof adminCommissionBandSchema>;

/** `GET /v1/admin/commission`. The guardrail is served alongside so a form can render it. */
export const adminCommissionConfigSchema = z.object({
  bands: z.array(adminCommissionBandSchema),
  /**
   * W11 / decision G2 — the CURRENT window, read from `commission_guardrail`.
   *
   * NUMBERS, NOT LITERALS: since 0026 the window is a row a super admin can
   * move, and the two DB CHECKs hold only the absolute outer bound (0 < pct ≤
   * 30). A literal here would be a second, silently-stale copy of the policy.
   */
  floorPct: z.number(),
  capPct: z.number(),
  /** When the window itself last moved, so the form can say how old it is. */
  guardrailUpdatedAt: z.iso.datetime().nullable(),
});
export type AdminCommissionConfig = z.infer<typeof adminCommissionConfigSchema>;

/**
 * `PUT /v1/admin/commission/guardrail` — `commission.guardrail`, Super Admin
 * only (decision G2).
 *
 * The OUTER bound is mirrored here (`0 < pct ≤ 30`) so an absurd value is a
 * field-level 422 rather than a CHECK violation; the *live* window is enforced
 * in the service, which also refuses a change that would leave a live band
 * outside the new one — a window that excludes a rate the platform is charging
 * right now is a contradiction, not a policy.
 */
export const adminCommissionGuardrailUpdateSchema = z
  .object({
    floorPct: z.number().gt(0).max(30).multipleOf(0.01),
    capPct: z.number().gt(0).max(30).multipleOf(0.01),
    reason: z.string().min(3).max(500).optional(),
  })
  .refine((body) => body.floorPct < body.capPct, {
    message: 'the floor must sit below the cap',
    path: ['floorPct'],
  });
export type AdminCommissionGuardrailUpdate = z.infer<typeof adminCommissionGuardrailUpdateSchema>;

/** One `commission_proposals` row — §4.2's Operations ⚠️. */
export const adminCommissionProposalSchema = z.object({
  id: z.uuid(),
  band: z.enum(['A', 'B', 'C']),
  pct: z.number(),
  proposedBy: z.uuid(),
  reason: z.string(),
  status: z.enum(['open', 'applied', 'declined']),
  decidedBy: z.uuid().nullable(),
  decidedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
});
export type AdminCommissionProposal = z.infer<typeof adminCommissionProposalSchema>;

/** `POST /v1/admin/commission/proposals` — Operations may propose, never set. */
export const adminCommissionProposalCreateSchema = z.object({
  band: z.enum(['A', 'B', 'C']),
  pct: z.number().gt(0).max(30).multipleOf(0.01),
  reason: z.string().min(3).max(500),
});
export type AdminCommissionProposalCreate = z.infer<typeof adminCommissionProposalCreateSchema>;

/** `POST /v1/admin/commission/proposals/:id/apply|decline`. */
export const adminCommissionProposalDecisionSchema = z.object({
  reason: z.string().min(3).max(500).optional(),
});
export type AdminCommissionProposalDecision = z.infer<
  typeof adminCommissionProposalDecisionSchema
>;

/**
 * §9.4.9's impact preview: "at last week's volume, Band A 10 %→9 % ≈ −₹X
 * revenue".
 *
 * READ-ONLY ARITHMETIC over ACTUAL paid bookings in the window, using the same
 * `commissionPaiseAtPct` the live settlement path uses — so the number shown is
 * the number the platform would have earned, not a projection from averages.
 */
export const adminCommissionImpactBandSchema = z.object({
  band: z.enum(['A', 'B', 'C']),
  /** What the band charges today. */
  currentPct: z.number(),
  /** What the operator typed into the preview. */
  proposedPct: z.number(),
  bookings: z.number().int(),
  currentPaise: unsignedPaiseSchema,
  proposedPaise: unsignedPaiseSchema,
  /** `proposed − current`, signed: a cut is negative. */
  deltaPaise: z.number().int(),
});
export type AdminCommissionImpactBand = z.infer<typeof adminCommissionImpactBandSchema>;

export const adminCommissionImpactSchema = z.object({
  days: z.number().int(),
  bands: z.array(adminCommissionImpactBandSchema),
  totalCurrentPaise: unsignedPaiseSchema,
  totalProposedPaise: unsignedPaiseSchema,
  totalDeltaPaise: z.number().int(),
});
export type AdminCommissionImpact = z.infer<typeof adminCommissionImpactSchema>;

/**
 * `GET /v1/admin/commission/impact?bands=A:9,B:8,C:5&days=7`.
 *
 * The bands param is compact because it is a preview of ONE edit: three pairs,
 * not a form. Parsing is strict — a typo'd band set must 422 rather than
 * silently preview something else.
 */
export const adminCommissionImpactQuerySchema = z.object({
  bands: z
    .string()
    .regex(/^[ABC]:\d{1,2}(\.\d{1,2})?(,[ABC]:\d{1,2}(\.\d{1,2})?)*$/, 'expected A:9,B:8,C:5'),
  days: z.coerce.number().int().min(1).max(90).default(7),
});
export type AdminCommissionImpactQuery = z.infer<typeof adminCommissionImpactQuerySchema>;

/**
 * `PUT /v1/admin/commission`.
 *
 * THIS SCHEMA DELIBERATELY DOES NOT ENFORCE THE 5–10 GUARDRAIL, and that is the
 * subtle part. §3.3 requires that out-of-band attempts are "rejected AND
 * audited" — but a `ZodValidationPipe` rejection never reaches the service, so
 * pinning `commissionPctSchema` here would produce a 422 with NO audit row and
 * quietly satisfy only half the sentence. Somebody probing how far the fare
 * engine bends is precisely what the audit log exists to record.
 *
 * What stays at the pipe is a SANITY bound: finite, non-negative, at most 100,
 * two decimal places. That rejects garbage and typos cheaply without swallowing
 * the deliberate 11 % attempt that the service must see, audit and refuse. The
 * guardrail proper lives in `AdminConfigService.updateCommission`, backed by
 * `ck_commission_config_guardrail` in the database.
 *
 * `commissionPctSchema` remains exported for callers that want the strict check
 * WITHOUT the audit semantics — the Phase 20 form validating a field as the
 * operator types, for instance.
 */
export const adminCommissionUpdateSchema = z.object({
  bands: z
    .array(
      z.object({
        band: z.enum(['A', 'B', 'C']),
        pct: z.number().min(0).max(100).multipleOf(0.01),
      }),
    )
    .min(1)
    .max(3),
  reason: z.string().min(3).max(500).optional(),
});
export type AdminCommissionUpdate = z.infer<typeof adminCommissionUpdateSchema>;

/**
 * `commissionPctSchema` is re-exported for callers that want the §3.3 LAUNCH
 * window without the audit semantics — the W11 form validating a field as the
 * operator types, for instance. The runtime window is `commission_guardrail`'s
 * row (decision G2); this is the seed's and the tests' oracle.
 */
export { commissionPctSchema };

/** A `commission_config_history` row — `GET /v1/admin/commission/history`. */
export const commissionHistoryEntrySchema = z.object({
  id: z.uuid(),
  band: z.enum(['A', 'B', 'C']),
  oldPct: z.number().nullable(),
  newPct: z.number(),
  changedBy: z.uuid(),
  reason: z.string().nullable(),
  createdAt: z.iso.datetime(),
});
export type CommissionHistoryEntry = z.infer<typeof commissionHistoryEntrySchema>;
