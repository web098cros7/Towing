import { z } from 'zod';
import { serviceTypeSchema, type ServiceType } from './enums';

/**
 * §6.7 "Admin-Tunable Dispatch Parameters (no deploy needed)" — the per-zone half.
 *
 * WHY THIS LIVES IN CONTRACTS AND NOT THE BACKEND. Three consumers must agree on
 * the shape byte-for-byte: Phase 14's seed (which writes
 * `service_zones.dispatch_config`), Phase 17's matcher (which reads it), and the
 * Phase 17 `PUT /v1/admin/dispatch-config` route plus its Phase 20 form (which
 * validate an edit). A schema owned by any one of them is a schema the other two
 * copy.
 *
 * TWO SCOPES, ONE NAME — read this before touching either:
 *  - the `service_zones.dispatch_config` COLUMN holds PER-ZONE overrides: the
 *    radius ladder, offer timing, wave size, and per-service variations. That is
 *    what this file models.
 *  - the `dispatch_config` TABLE holds what is GLOBAL: the §6.2 scorer weights
 *    and the stale-ping threshold (`scorerWeightsSchema` below). A radius ladder
 *    is a property of a city; a scoring weight is a property of the marketplace.
 *
 * THE COLUMN IS NULLABLE AND MUST STAY SAFE WHEN NULL. `resolveDispatchConfig`
 * is the only sanctioned reader. Phase 17's matcher reading the JSONB directly
 * and falling back to inline constants is precisely the hard-coded-ladder
 * outcome that phase is written to prevent — the constants would then live in
 * the matcher, where no admin can reach them, and the config table would be
 * decorative.
 */

/** Ladder of search radii in km, ascending. §6.4's wave search walks this in order. */
const radiusLadderSchema = z
  .array(z.number().positive().max(500))
  .min(1)
  .max(10)
  .refine((ladder) => ladder.every((km, i) => i === 0 || km > ladder[i - 1]!), {
    message: 'radius ladder must be strictly ascending',
  });

/**
 * The knobs a zone may override. **Every field is `.optional()` and NONE carries
 * `.default()`** — deliberately.
 *
 * Phase 13 shipped a bug where `schema.partial()` kept each field's `.default()`,
 * so a one-key PUT arrived as every key and silently reset the rest (the same
 * defect was found sitting in `fleetSettingsUpdateSchema`). Defaults live in
 * `DISPATCH_CONFIG_DEFAULTS` as a plain object and are applied by an explicit
 * merge, so a partial override can only ever mean "override these keys".
 */
export const dispatchConfigOverrideSchema = z.object({
  /** §6.4 wave ladder. Spec example: 2 / 4 / 7 / 10 / 15 km. */
  radiusLadderKm: radiusLadderSchema.optional(),
  /** Band C (>100 km) searches a far wider net — few drivers are opted in. */
  bandCRadiusLadderKm: radiusLadderSchema.optional(),
  /** §6.3 offer countdown, seconds. Spec default 20. */
  offerTimeoutSeconds: z.number().int().min(5).max(120).optional(),
  /** §6.4 max concurrent offers per wave. Spec says 3–4. */
  offersPerWave: z.number().int().min(1).max(10).optional(),
  /**
   * §6.4 total search deadline, seconds. ~180 at launch.
   *
   * Note the arithmetic the plan asks to be explicit about: 5 waves × 3 offers ×
   * 20 s = 300 s, so THE DEADLINE BINDS BEFORE THE LADDER EXHAUSTS. This is the
   * real terminator of a search, not the last rung.
   */
  maxSearchSeconds: z.number().int().min(30).max(900).optional(),
  /**
   * Per-service variations on the above. A fuel delivery does not need the same
   * 15 km reach as a flatbed tow.
   *
   * `z.partialRecord`, NOT `z.record`. In zod 4 a `z.record()` whose key is an
   * enum is EXHAUSTIVE — it requires every member present — so `{ fuel: {…} }`
   * fails validation and `resolveDispatchConfig` quietly returns the defaults
   * instead of the override. Caught by the round-trip assertion in
   * `dispatch-config.spec.ts`, which is why that spec asserts a partial override
   * APPLIES rather than merely that it parses.
   */
  perService: z
    .partialRecord(
      serviceTypeSchema,
      z.object({
        radiusLadderKm: radiusLadderSchema.optional(),
        offerTimeoutSeconds: z.number().int().min(5).max(120).optional(),
        offersPerWave: z.number().int().min(1).max(10).optional(),
        maxSearchSeconds: z.number().int().min(30).max(900).optional(),
      }),
    )
    .optional(),
});
export type DispatchConfigOverride = z.infer<typeof dispatchConfigOverrideSchema>;

/** A fully-resolved config — no optional fields, safe for the matcher to read directly. */
export interface DispatchConfig {
  radiusLadderKm: number[];
  bandCRadiusLadderKm: number[];
  offerTimeoutSeconds: number;
  offersPerWave: number;
  maxSearchSeconds: number;
}

/**
 * The code-level default the plan requires: what a zone with a NULL
 * `dispatch_config` resolves to. Values are §6.4/§6.7's stated launch numbers.
 */
export const DISPATCH_CONFIG_DEFAULTS: DispatchConfig = {
  radiusLadderKm: [2, 4, 7, 10, 15],
  bandCRadiusLadderKm: [10, 25, 50],
  offerTimeoutSeconds: 20,
  offersPerWave: 3,
  maxSearchSeconds: 180,
};

/**
 * The ONLY sanctioned way to read `service_zones.dispatch_config`.
 *
 * Resolution order: code defaults → the zone's own overrides → the zone's
 * per-service overrides. Invalid stored JSON resolves to the defaults rather
 * than throwing: a dispatch that refuses to run because someone saved a bad
 * ladder is worse than one that runs on the documented default, and the write
 * path validates with `dispatchConfigOverrideSchema` so bad JSON can only get in
 * by hand.
 *
 * RESOLUTION ORDER, W12: code defaults → the PLATFORM's per-service
 * `offersPerWave` → the zone's own overrides → the zone's per-service overrides.
 * That order is the promise: a zone that overrides nothing keeps tracking every
 * future change to the platform default, and a zone that overrides one key still
 * tracks the others.
 */
export function resolveDispatchConfig(
  raw: unknown,
  service?: ServiceType,
  globalPerServiceOffers?: PerServiceMaxOffers,
): DispatchConfig {
  if (raw === null || raw === undefined) {
    return {
      ...DISPATCH_CONFIG_DEFAULTS,
      offersPerWave:
        perServiceOffer(globalPerServiceOffers, service) ?? DISPATCH_CONFIG_DEFAULTS.offersPerWave,
    };
  }

  const parsed = dispatchConfigOverrideSchema.safeParse(raw);
  if (!parsed.success) return { ...DISPATCH_CONFIG_DEFAULTS };

  const zone = parsed.data;
  const perService = service ? zone.perService?.[service] : undefined;

  return {
    radiusLadderKm:
      perService?.radiusLadderKm ?? zone.radiusLadderKm ?? DISPATCH_CONFIG_DEFAULTS.radiusLadderKm,
    bandCRadiusLadderKm: zone.bandCRadiusLadderKm ?? DISPATCH_CONFIG_DEFAULTS.bandCRadiusLadderKm,
    offerTimeoutSeconds:
      perService?.offerTimeoutSeconds ??
      zone.offerTimeoutSeconds ??
      DISPATCH_CONFIG_DEFAULTS.offerTimeoutSeconds,
    offersPerWave:
      perService?.offersPerWave ??
      zone.offersPerWave ??
      perServiceOffer(globalPerServiceOffers, service) ??
      DISPATCH_CONFIG_DEFAULTS.offersPerWave,
    maxSearchSeconds:
      perService?.maxSearchSeconds ??
      zone.maxSearchSeconds ??
      DISPATCH_CONFIG_DEFAULTS.maxSearchSeconds,
  };
}

function perServiceOffer(
  offers: PerServiceMaxOffers | undefined,
  service: ServiceType | undefined,
): number | undefined {
  if (!offers || !service) return undefined;
  return offers[service];
}

/**
 * §6.7's "re-dispatch priority" — W12.
 *
 * `front` is the behaviour §6.5 describes and the engine has shipped: a
 * re-dispatch re-enters the matcher immediately (the customer has already spent
 * one full search through no fault of their own). `normal` makes it wait for the
 * next ordinary cadence instead — the knob exists so a platform drowning in
 * cancel-and-redispatch loops can slow them down without a deploy.
 */
export const redispatchPrioritySchema = z.enum(['front', 'normal']);
export type RedispatchPriority = z.infer<typeof redispatchPrioritySchema>;

/**
 * §6.2's weighted scorer + §6.1's liveness threshold — the GLOBAL half of §6.7,
 * held in the `dispatch_config` table.
 *
 * Created in Phase 14 rather than Phase 17 on purpose. Phase 17's matcher is
 * required to read every weight at query time; if the table does not exist when
 * that matcher is written, the weights become constants and retrofitting a
 * config service afterwards is a matcher rewrite.
 */
export const scorerWeightsSchema = z
  .object({
    /** §6.2: proximity/ETA 60 %, rating 15 %, acceptance 15 %, completion 10 %. */
    proximity: z.number().min(0).max(100),
    rating: z.number().min(0).max(100),
    acceptance: z.number().min(0).max(100),
    completion: z.number().min(0).max(100),
  })
  .refine((w) => Math.abs(w.proximity + w.rating + w.acceptance + w.completion - 100) < 0.005, {
    message: 'scorer weights must sum to 100',
  });
export type ScorerWeights = z.infer<typeof scorerWeightsSchema>;

/**
 * Per-service `offersPerWave` at the PLATFORM level — the global layer W12 added.
 *
 * The zone column has carried a per-service override since Phase 14; what was
 * missing was a default for zones nobody has tuned, so a city zone with no
 * override still offered a fuel delivery the same number of drivers as a
 * long-haul flatbed. `partialRecord`, not `record`: a full record would require
 * every service to be present, which is the zod-4 trap documented above.
 */
export const perServiceMaxOffersSchema = z
  .partialRecord(serviceTypeSchema, z.number().int().min(1).max(10))
  .nullable();
export type PerServiceMaxOffers = z.infer<typeof perServiceMaxOffersSchema>;

/** The full global row. §6.7's "stale-ping threshold" and "one-active-booking toggle". */
export const globalDispatchConfigSchema = z.object({
  weights: scorerWeightsSchema,
  /**
   * §6.1: liveness is PING FRESHNESS, not socket connectivity. A driver whose
   * last ping is older than this is excluded from candidate selection.
   */
  stalePingSeconds: z.number().int().min(5).max(300),
  /** §3.8 / §6.7. Enforced by Phase 15's booking-creation guard. */
  oneActiveBookingPerCustomer: z.boolean(),
  /** W12 — §6.7's missing knob. See `redispatchPrioritySchema`. */
  redispatchPriority: redispatchPrioritySchema,
  /** §11.3's cadence on an active job, milliseconds. Pushed over `config:update`. */
  pingOnJobMs: z.number().int().min(1_000).max(300_000),
  /** §11.3's cadence while online and idle. */
  pingIdleMs: z.number().int().min(1_000).max(300_000),
  /** W12 — the platform-level per-service wave size. `null` means "none set". */
  perServiceMaxOffers: perServiceMaxOffersSchema,
});
export type GlobalDispatchConfig = z.infer<typeof globalDispatchConfigSchema>;

export const GLOBAL_DISPATCH_CONFIG_DEFAULTS: GlobalDispatchConfig = {
  weights: { proximity: 60, rating: 15, acceptance: 15, completion: 10 },
  stalePingSeconds: 15,
  oneActiveBookingPerCustomer: true,
  // §6.5's shipped behaviour: a re-dispatch goes to the front.
  redispatchPriority: 'front',
  // `PING_CADENCE` from `realtime/presence.ts` — the values every handset has
  // been told since Phase 16. Duplicated as literals rather than imported, so
  // this file stays free of the realtime module (the two are read by different
  // sides of the build and a cycle here would be silent).
  pingOnJobMs: 3_000,
  pingIdleMs: 10_000,
  perServiceMaxOffers: null,
};
