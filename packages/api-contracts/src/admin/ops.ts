import { z } from 'zod';
import { unsignedPaiseSchema } from '../common/money';
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
  kind: z.enum(['booking_status', 'booking_created', 'admin_action']),
  at: z.iso.datetime(),
  bookingId: z.uuid().nullable(),
  zoneId: z.uuid().nullable(),
  /** Booking kinds: the status entered (creation enters `searching`). */
  status: jobStatusSchema.nullable(),
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
   * reconstructed from `booking_status_history` + `admin_actions` (W14 adds
   * `sos_alerts` to that union). The DB cannot show creations that announced
   * nothing, so a backfilled feed is newer-history-poorer by exactly that much —
   * which is why the flag is on the payload rather than silent.
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
export const adminLiveJobStatusSchema = z.enum([
  'assigned',
  'en_route',
  'arrived',
  'in_progress',
]);

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
