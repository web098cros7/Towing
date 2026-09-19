import { z } from 'zod';
import {
  dispatchConfigOverrideSchema,
  perServiceMaxOffersSchema,
  redispatchPrioritySchema,
  scorerWeightsSchema,
} from '../common/dispatch-config';

/**
 * `GET/PUT /v1/admin/dispatch-config` (§16.5) — Phase 17.
 *
 * BUILT ON `common/dispatch-config.ts`, NOT BESIDE IT. That file already models
 * both scopes and states the rule this API has to honour: the `dispatch_config`
 * TABLE holds what is global (scorer weights, the stale-ping threshold) and the
 * `service_zones.dispatch_config` COLUMN holds what is per-zone (radius ladder,
 * offer timing, wave size). Re-declaring either shape here would give the matcher
 * and the admin form two schemas to disagree about, which is exactly the
 * outcome Phase 14 created that file to prevent.
 *
 * §6.7 requires every knob below to change with NO DEPLOY, and Phase 17's engine
 * reads all of them at query time — so an edit through this route takes effect on
 * the next wave, not on the next release.
 */

/**
 * The global row. Sent whole on read; the update is a partial (see below).
 *
 * `stalePingSeconds` is the §6.1 liveness threshold, and it is the knob an
 * operator reaches for during a network incident: widening it keeps drivers
 * dispatchable through patchy coverage at the cost of occasionally offering a
 * job to a phone that has gone quiet.
 */
export const adminGlobalDispatchSchema = z.object({
  weights: scorerWeightsSchema,
  stalePingSeconds: z.number().int().min(5).max(300),
  /** §3.8 / §6.7 — enforced by Phase 15's booking-creation guard. */
  oneActiveBookingPerCustomer: z.boolean(),
  /** §3.8's "admin-configurable" unpaid-balance block. */
  blockOnUnpaidBalance: z.boolean(),
  // ── W12 ──
  /** §6.7's re-dispatch priority: jump the queue, or wait for the cadence. */
  redispatchPriority: redispatchPrioritySchema,
  /** §11.3's cadence on an active job — pushed to handsets as `config:update`. */
  pingOnJobMs: z.number().int().min(1_000).max(300_000),
  pingIdleMs: z.number().int().min(1_000).max(300_000),
  /** The platform-level per-service wave size; `null` means none is set. */
  perServiceMaxOffers: perServiceMaxOffersSchema,
});
export type AdminGlobalDispatch = z.infer<typeof adminGlobalDispatchSchema>;

/** One zone's overrides, as the admin sees them. */
export const adminZoneDispatchSchema = z.object({
  zoneId: z.uuid(),
  zoneName: z.string(),
  isActive: z.boolean(),
  /**
   * The RAW override, `null` when the zone has never been tuned — deliberately
   * not the resolved config. An admin editing a form pre-filled with resolved
   * values would save the code defaults as explicit overrides on their first
   * touch, and the zone would then stop tracking any future change to those
   * defaults. `resolved` below is what the engine will actually use.
   */
  override: dispatchConfigOverrideSchema.nullable(),
  /** What `resolveDispatchConfig()` produces today — shown, never submitted. */
  resolved: z.object({
    radiusLadderKm: z.array(z.number()),
    bandCRadiusLadderKm: z.array(z.number()),
    offerTimeoutSeconds: z.number().int(),
    offersPerWave: z.number().int(),
    maxSearchSeconds: z.number().int(),
  }),
});
export type AdminZoneDispatch = z.infer<typeof adminZoneDispatchSchema>;

export const adminDispatchConfigSchema = z.object({
  global: adminGlobalDispatchSchema,
  zones: z.array(adminZoneDispatchSchema),
  /** §19.8's kill switches, so one screen shows everything that can stop dispatch. */
  killSwitches: z.object({
    /** Zone ids where new searches are paused. */
    pausedZoneIds: z.array(z.uuid()),
    /** Band C offers suppressed platform-wide — the longest, riskiest jobs. */
    longDistanceDisabled: z.boolean(),
    /** Force both apps onto §19.2 REST polling by refusing socket tickets. */
    forcePolling: z.boolean(),
  }),
});
export type AdminDispatchConfig = z.infer<typeof adminDispatchConfigSchema>;

/**
 * A PARTIAL update, and every field is explicitly `.optional()` rather than
 * `.partial()`-ed.
 *
 * Phase 13 shipped a bug where `schema.partial()` kept each field's `.default()`,
 * so a one-key PUT arrived as every key and silently reset the rest — the same
 * defect `dispatchConfigOverrideSchema` documents at length. Spelling the
 * optionals out is what makes "change only the stale-ping threshold" mean that.
 */
export const adminDispatchConfigUpdateSchema = z
  .object({
    weights: scorerWeightsSchema.optional(),
    stalePingSeconds: z.number().int().min(5).max(300).optional(),
    oneActiveBookingPerCustomer: z.boolean().optional(),
    blockOnUnpaidBalance: z.boolean().optional(),
    // ── W12 ──
    redispatchPriority: redispatchPrioritySchema.optional(),
    pingOnJobMs: z.number().int().min(1_000).max(300_000).optional(),
    pingIdleMs: z.number().int().min(1_000).max(300_000).optional(),
    /** `null` CLEARS the platform per-service offers back to the code defaults. */
    perServiceMaxOffers: perServiceMaxOffersSchema.optional(),
    /**
     * Per-zone overrides. `null` CLEARS a zone back to the code defaults, which
     * is different from omitting the zone (leave it alone) — an admin must be
     * able to undo a bad ladder without knowing what the defaults were.
     */
    zones: z
      .array(
        z.object({
          zoneId: z.uuid(),
          override: dispatchConfigOverrideSchema.nullable(),
        }),
      )
      .optional(),
    killSwitches: z
      .object({
        pausedZoneIds: z.array(z.uuid()).optional(),
        longDistanceDisabled: z.boolean().optional(),
        forcePolling: z.boolean().optional(),
      })
      .optional(),
    /** Audited to `admin_actions` alongside the diff. §6.7 edits move money. */
    reason: z.string().max(500).optional(),
  })
  .refine((body) => Object.keys(body).some((key) => key !== 'reason'), {
    message: 'Nothing to update',
  });
export type AdminDispatchConfigUpdate = z.infer<typeof adminDispatchConfigUpdateSchema>;
