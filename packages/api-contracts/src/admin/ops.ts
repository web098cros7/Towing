import { z } from 'zod';
import { scorerWeightsSchema } from '../common/dispatch-config';
import { unsignedPaiseSchema } from '../common/money';
import { sosStatusSchema } from '../common/sos';
import { jobStatusSchema } from '../fleet/jobs';
import { latLngSchema } from '../fleet/trucks';
import { fleetZoneSchema } from '../realtime/positions';
import { adminOpsBadgesSchema, adminOpsKpisSchema } from './ops-kpis';

/**
 * §9.4.2's Operations dashboard and §9.4.6's live map — `/v1/admin/ops/*` (W3, W4).
 *
 * The KPIs and badges the dashboard/broadcaster exchange live in `ops-kpis.ts`
 * so this file stays the HTTP/frame surface. Three facts the rest of the system
 * depends on:
 *
 *  - `adminOpsKpisSchema` is BOTH the REST payload and the `ops:metrics` frame
 *    body. The console patches its cached query with the frame when the socket
 *    is up, so the pushed numbers and the fetched numbers cannot disagree.
 *  - `dispatchableNow` is the one nullable KPI: it is the Redis sub-count, and
 *    Redis being down must degrade the tile to "—", not fail the request.
 *  - Fill rate is `null`, not `0`, when nothing has resolved yet today — 0/0 is
 *    not 0 %, and a dashboard that renders it as one is lying.
 */

/** The frame body for the `/admin` namespace's `ops:metrics` event. */
export const adminOpsMetricsEventSchema = z.object({
  kpis: adminOpsKpisSchema,
  at: z.iso.datetime(),
});
export type AdminOpsMetricsEvent = z.infer<typeof adminOpsMetricsEventSchema>;

/** The frame body for the `/admin` namespace's `ops:badges` event. */
export const adminOpsBadgesEventSchema = z.object({
  badges: adminOpsBadgesSchema,
  at: z.iso.datetime(),
});
export type AdminOpsBadgesEvent = z.infer<typeof adminOpsBadgesEventSchema>;

export const adminOpsDashboardResponseSchema = z.object({
  kpis: adminOpsKpisSchema,
  at: z.iso.datetime(),
  /**
   * True when Redis was unreachable, so `dispatchableNow` is null and the
   * numbers otherwise come from Postgres alone. Slower but correct — the
   * console shows a degraded chip, not an error (§19.2's rule, same as the map).
   */
  degraded: z.boolean(),
});
export type AdminOpsDashboardResponse = z.infer<typeof adminOpsDashboardResponseSchema>;

export const adminOpsBadgesResponseSchema = z.object({
  badges: adminOpsBadgesSchema,
  at: z.iso.datetime(),
});
export type AdminOpsBadgesResponse = z.infer<typeof adminOpsBadgesResponseSchema>;

// ---------------------------------------------------------------------------
// Activity feed (§9.4.2 "live activity feed")
// ---------------------------------------------------------------------------

/**
 * One feed row. Deliberately loose — the three sources are genuinely different
 * things (a transition, a creation, an admin action) and a discriminated union
 * per source would force three renderers for one two-line list. Nullable fields
 * say "this source has nothing here", and the client renders the one line that
 * applies.
 */
export const adminActivityItemSchema = z.object({
  /** Stable dedupe key — `{kind}:{subject}:{at}`; lets the client merge REST + frames. */
  id: z.string().min(1),
  kind: z.enum(['booking_status', 'booking_created', 'admin_action', 'sos_alert']),
  at: z.iso.datetime(),
  bookingId: z.uuid().nullable(),
  zoneId: z.uuid().nullable(),
  /** Booking kinds: the status entered (creation enters `searching`). */
  status: jobStatusSchema.nullable(),
  /** SOS rows (W14): the incident's status, so the feed can say "acknowledged". */
  sosStatus: sosStatusSchema.nullable(),
  /** Creation only — set for a scheduled booking, which sits dormant in `searching`. */
  scheduledAt: z.iso.datetime().nullable(),
  /** Admin actions: the dotted verb, e.g. `driver.kyc.approve`. */
  action: z.string().nullable(),
  subjectType: z.string().nullable(),
  subjectId: z.uuid().nullable(),
  adminId: z.uuid().nullable(),
});
export type AdminActivityItem = z.infer<typeof adminActivityItemSchema>;

export const adminOpsActivityResponseSchema = z.object({
  items: z.array(adminActivityItemSchema),
  /**
   * True when the live Redis list was empty or unreachable and the rows were
   * reconstructed from `booking_status_history` + `admin_actions` +
   * `sos_alerts` (the last joined the union in W14). The DB cannot show
   * creations that announced nothing, so a backfilled feed is
   * newer-history-poorer by exactly that much — which is why the flag is on
   * the payload rather than silent.
   */
  backfilled: z.boolean(),
});
export type AdminOpsActivityResponse = z.infer<typeof adminOpsActivityResponseSchema>;

// ---------------------------------------------------------------------------
// Live map snapshot (§9.4.6)
// ---------------------------------------------------------------------------

/**
 * The four statuses a job is worth drawing on the map under — `ACTIVE_JOB_STATUSES`.
 * `searching` is not here on purpose: a search has no driver to follow and is
 * W5's dispatch inspector, not a marker.
 */
export const adminLiveJobStatusSchema = z.enum(['assigned', 'en_route', 'arrived', 'in_progress']);

export const adminOpsLiveQuerySchema = z.object({
  /** Narrows to drivers whose last known zone is this one, and bookings in it. */
  zoneId: z.uuid().optional(),
  status: adminLiveJobStatusSchema.optional(),
});
export type AdminOpsLiveQuery = z.infer<typeof adminOpsLiveQuerySchema>;

/**
 * One driver on the admin map. `lat` is nullable for the same reason the fleet
 * snapshot's is: a driver who has gone online but never pinged is a real state,
 * and dropping the row would make them invisible in the rail too.
 */
export const adminLiveDriverSchema = z.object({
  driverId: z.uuid(),
  name: z.string().nullable(),
  zoneId: z.uuid().nullable(),
  lat: z.number().min(-90).max(90).nullable(),
  lng: z.number().min(-180).max(180).nullable(),
  headingDeg: z.number().nullable(),
  speedKph: z.number().nullable(),
  /** Ping timestamp; null when only the PostGIS fallback exists. */
  at: z.iso.datetime().nullable(),
  /** True when this row came from the driver's PostGIS column, not the hot Redis hash. */
  fromFallback: z.boolean(),
  /**
   * W6: whether a fresh offer could actually reach this driver right now.
   * False for a shelved suspension, a suspended fleet, or a §6.10 restriction
   * on their current zone — the map draws them distinctly rather than hiding
   * them, so an operator can see why supply disappeared (W4's rule).
   */
  dispatchable: z.boolean(),
});
export type AdminLiveDriver = z.infer<typeof adminLiveDriverSchema>;

export const adminLiveBookingSchema = z.object({
  bookingId: z.uuid(),
  status: jobStatusSchema,
  serviceType: z.string(),
  zoneId: z.uuid().nullable(),
  driverId: z.uuid().nullable(),
  pickup: latLngSchema,
  /** Null for services with no destination (jumpstart, fuel, tyre). */
  drop: latLngSchema.nullable(),
  createdAt: z.iso.datetime(),
});
export type AdminLiveBooking = z.infer<typeof adminLiveBookingSchema>;

export const adminOpsLiveResponseSchema = z.object({
  drivers: z.array(adminLiveDriverSchema),
  bookings: z.array(adminLiveBookingSchema),
  /** Active zones as GeoJSON — the same unscoped `service_zones` set the fleet map draws. */
  zones: z.array(fleetZoneSchema),
  at: z.iso.datetime(),
  /** §19.2: Redis unreachable; drivers served from PostGIS instead. */
  degraded: z.boolean(),
});
export type AdminOpsLiveResponse = z.infer<typeof adminOpsLiveResponseSchema>;

// ---------------------------------------------------------------------------
// Dispatch inspector (W5, §9.4.6)
// ---------------------------------------------------------------------------

/**
 * The legal `dispatch_attempts.outcome` values — mirrors
 * `ck_dispatch_attempts_outcome` (widened by migration 0023 with `reassigned`,
 * ahead of W8's writer).
 *
 * THE SOURCE OF TRUTH IS HERE, not in the backend repo that reads it: the
 * migration spec pins this list to the CHECK's literals, so a value cannot
 * exist on one side only. `unable` and `reassigned` sit outside the
 * acceptance-rate denominator (`accepted + rejected + expired`) on purpose —
 * neither is a driver's refusal.
 */
export const dispatchAttemptOutcomes = [
  'offered',
  'accepted',
  'rejected',
  'expired',
  'revoked',
  'unable',
  'reassigned',
] as const;
export const dispatchAttemptOutcomeSchema = z.enum(dispatchAttemptOutcomes);
export type DispatchAttemptOutcome = z.infer<typeof dispatchAttemptOutcomeSchema>;

/** One scored candidate in a wave log — the per-term breakdown behind `score`. */
export const adminDispatchWaveCandidateSchema = z.object({
  driverId: z.uuid(),
  /** Straight-line metres at selection time — the proximity term's input. */
  distanceM: z.number().nonnegative(),
  /** Normalised 0–1 terms; `score` is their weighted sum (asserted in the spec). */
  proximity: z.number().min(0).max(1),
  rating: z.number().min(0).max(1),
  acceptance: z.number().min(0).max(1),
  completion: z.number().min(0).max(1),
  score: z.number().min(0).max(100),
  /** False for a candidate that was ranked but never actually reached. */
  offered: z.boolean(),
});
export type AdminDispatchWaveCandidate = z.infer<typeof adminDispatchWaveCandidateSchema>;

/** One exclusion reason's tally: the count is exact, the id list is capped. */
export const adminDispatchExclusionSchema = z.object({
  count: z.number().int().nonnegative(),
  driverIds: z.array(z.uuid()),
});
export type AdminDispatchExclusion = z.infer<typeof adminDispatchExclusionSchema>;

/**
 * The resolved per-zone dispatch config a wave ran with — mirrors the backend's
 * `DispatchConfig` after `resolveDispatchConfig()` (code defaults → zone
 * overrides → per-service overrides). Stored per wave, because resolving it
 * NOW and labelling it "what wave 3 used" would be a lie the first time an
 * admin edits a ladder.
 */
export const adminDispatchConfigViewSchema = z.object({
  radiusLadderKm: z.array(z.number()),
  bandCRadiusLadderKm: z.array(z.number()),
  offerTimeoutSeconds: z.number(),
  offersPerWave: z.number(),
  maxSearchSeconds: z.number(),
});
export type AdminDispatchConfigView = z.infer<typeof adminDispatchConfigViewSchema>;

/** One wave, exactly as `dispatch_wave_logs` stores it. */
export const adminDispatchWaveLogSchema = z.object({
  id: z.uuid(),
  wave: z.number().int().positive(),
  radiusKm: z.number(),
  considered: z.number().int().nonnegative(),
  eligible: z.number().int().nonnegative(),
  offered: z.number().int().nonnegative(),
  degraded: z.boolean(),
  /** The §6.2 weights in force when THIS wave ran (`dispatch_config`). */
  weights: scorerWeightsSchema,
  config: adminDispatchConfigViewSchema,
  excluded: z.record(z.string(), adminDispatchExclusionSchema),
  candidates: z.array(adminDispatchWaveCandidateSchema),
  ranAt: z.iso.datetime(),
  durationMs: z.number().int().nonnegative(),
});
export type AdminDispatchWaveLog = z.infer<typeof adminDispatchWaveLogSchema>;

/** One `dispatch_attempts` row, joined to the driver it names. */
export const adminDispatchAttemptSchema = z.object({
  driverId: z.uuid().nullable(),
  driverName: z.string().nullable(),
  driverMobile: z.string().nullable(),
  wave: z.number().int(),
  radiusKm: z.number(),
  outcome: dispatchAttemptOutcomeSchema,
  offeredAt: z.iso.datetime(),
  respondedAt: z.iso.datetime().nullable(),
});
export type AdminDispatchAttempt = z.infer<typeof adminDispatchAttemptSchema>;

/** The booking under inspection — the inspector page's header. */
export const adminDispatchInspectorBookingSchema = z.object({
  bookingId: z.uuid(),
  status: jobStatusSchema,
  serviceType: z.string(),
  vehicleClass: z.string(),
  zoneId: z.uuid().nullable(),
  userId: z.uuid(),
  customerName: z.string().nullable(),
  customerMobile: z.string().nullable(),
  pickup: latLngSchema,
  pickupAddress: z.string().nullable(),
  drop: latLngSchema.nullable(),
  longDistance: z.boolean(),
  searchWave: z.number().int().nullable(),
  deadlineAt: z.iso.datetime().nullable(),
  scheduledAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
});
export type AdminDispatchInspectorBooking = z.infer<typeof adminDispatchInspectorBookingSchema>;

/**
 * `GET /v1/admin/ops/dispatch/:bookingId` — "why did this driver win".
 *
 * `waves` is empty for a booking dispatched before W5's writer shipped — an
 * honest "no waves recorded", not a fabricated reconstruction. The top-level
 * `config`/`weights` are what they resolve to NOW, beside the per-wave copies
 * that say what each wave actually used.
 */
export const adminDispatchInspectorResponseSchema = z.object({
  booking: adminDispatchInspectorBookingSchema,
  waves: z.array(adminDispatchWaveLogSchema),
  attempts: z.array(adminDispatchAttemptSchema),
  config: adminDispatchConfigViewSchema,
  weights: scorerWeightsSchema,
  /** The stored search position; `null` for a booking whose search never ran. */
  liveWave: z.number().int().nullable(),
  deadlineAt: z.iso.datetime().nullable(),
});
export type AdminDispatchInspectorResponse = z.infer<typeof adminDispatchInspectorResponseSchema>;

/** The only parameter the guide names; literal so a widening is deliberate. */
export const adminDispatchInspectorListQuerySchema = z.object({
  status: z.literal('searching').default('searching'),
});
export type AdminDispatchInspectorListQuery = z.infer<typeof adminDispatchInspectorListQuerySchema>;

/** One live search on the inspector list — enough to pick the interesting one. */
export const adminDispatchLiveSearchSchema = z.object({
  bookingId: z.uuid(),
  zoneId: z.uuid().nullable(),
  serviceType: z.string(),
  vehicleClass: z.string(),
  /** Stored wave position; null for a booking whose search has never run. */
  wave: z.number().int().nullable(),
  /** The radius that wave runs at, resolved against the zone's ladder now. */
  radiusKm: z.number().nullable(),
  /** Distinct drivers ever offered this booking. */
  contacted: z.number().int().nonnegative(),
  longDistance: z.boolean(),
  deadlineAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
});
export type AdminDispatchLiveSearch = z.infer<typeof adminDispatchLiveSearchSchema>;

export const adminDispatchInspectorListResponseSchema = z.object({
  items: z.array(adminDispatchLiveSearchSchema),
  at: z.iso.datetime(),
});
export type AdminDispatchInspectorListResponse = z.infer<
  typeof adminDispatchInspectorListResponseSchema
>;
