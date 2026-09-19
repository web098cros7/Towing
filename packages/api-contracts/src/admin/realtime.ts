import { z } from 'zod';
import { adminSubRoleSchema } from '../common/enums';
import { jobStatusSchema } from '../fleet/jobs';
import { adminOpsBadgesSchema, adminOpsKpisSchema } from './ops-kpis';

/**
 * The `/admin` namespace (W1, §3.4).
 *
 * A FOURTH socket realm: the fleet console's namespace is tenant-scoped and the
 * admin console watches the whole marketplace, so the two cannot share a room
 * vocabulary. `/admin` carries positions and status changes platform-wide;
 * nothing client-supplied ever reaches a room name — room membership comes from
 * the redeemed ticket plus the zod-validated `ops:subscribe` handler.
 */
export const ADMIN_NAMESPACE = '/admin';

/**
 * Every admin socket. The location relay checks a node's LOCAL membership in
 * this room before doing any work: a node with no operators connected drops the
 * entire ping stream instead of serialising frames nobody will read.
 */
export const adminOpsRoom = (): string => 'admin:ops';

/** Filter rooms, joined through `ops:subscribe`. */
export const adminZoneRoom = (zoneId: string): string => `admin:zone:${zoneId}`;
export const adminBookingRoom = (bookingId: string): string => `admin:booking:${bookingId}`;

/** `admin:user:{id}` — so deactivating an admin disconnects them across nodes. */
export const adminUserRoom = (adminId: string): string => `admin:user:${adminId}`;

/** Server→client event names (§3.4). */
export const ADMIN_REALTIME_EVENT = {
  READY: 'realtime:ready',
  BOOKING_STATUS: 'booking:status',
  LOCATION_UPDATE: 'location:update',
  OPS_METRICS: 'ops:metrics',
  OPS_BADGES: 'ops:badges',
  SOS_ALERT: 'sos:alert',
  DISPATCH_WAVE: 'dispatch:wave',
  OPS_BANNER: 'ops:banner',
} as const;

/** Sent once on connect, like the fleet namespace's — "connected" ≠ "subscribed". */
export const adminReadyEventSchema = z.object({
  adminId: z.uuid(),
  subRole: adminSubRoleSchema,
  serverTime: z.iso.datetime(),
});
export type AdminReadyEvent = z.infer<typeof adminReadyEventSchema>;

/**
 * One driver's position on the admin map. `zoneId` rides along so W4's zone
 * filter can be a room join; it is nullable because an out-of-zone ping is a
 * real state (`driver_zone_restrictions` excludes, it does not hide).
 */
export const adminDriverPositionSchema = z.object({
  driverId: z.uuid(),
  zoneId: z.uuid().nullable(),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  headingDeg: z.number().nullable(),
  speedKph: z.number().nullable(),
  /** Ping timestamp, not relay time — `emittedAt` minus this is the latency. */
  at: z.iso.datetime(),
});
export type AdminDriverPosition = z.infer<typeof adminDriverPositionSchema>;

/** A batch, like the fleet frame: <=1 entry per driver per flush window. */
export const adminLocationUpdateSchema = z.object({
  positions: z.array(adminDriverPositionSchema),
  emittedAt: z.iso.datetime(),
});
export type AdminLocationUpdateEvent = z.infer<typeof adminLocationUpdateSchema>;

/**
 * A platform-wide status change. Richer than the fleet's two-field frame on
 * purpose: an admin map must patch a marker (zone/driver) without a refetch,
 * where a tenant map already has both ids in hand.
 */
export const adminBookingStatusSchema = z.object({
  bookingId: z.uuid(),
  status: jobStatusSchema,
  zoneId: z.uuid().nullable(),
  driverId: z.uuid().nullable(),
  at: z.iso.datetime(),
});
export type AdminBookingStatusEvent = z.infer<typeof adminBookingStatusSchema>;

/**
 * The ONE inbound admin message (§3.4). Bounded on purpose: an unbounded
 * `zoneIds` array would let a client ask a node to join thousands of rooms and
 * turn one socket into an amplifier.
 */
export const opsSubscribeSchema = z.object({
  zoneIds: z.array(z.uuid()).max(20).optional(),
  bookingId: z.uuid().optional(),
});
export type OpsSubscribe = z.infer<typeof opsSubscribeSchema>;

// ---------------------------------------------------------------------------
// `ops:events` — the Redis channel behind every admin feed (A18, W1)
// ---------------------------------------------------------------------------

/**
 * Platform-wide operational events on `ops:events` (A18, §12.1 admin feed).
 *
 * Every booking status change is visible to an admin subscriber regardless of
 * fleet — the tenant-scoped `fleet:events` cannot serve a console that watches
 * the whole marketplace. W1 (badges, activity, live map) and W14 (SOS alerts)
 * extend this union; the channel stays one.
 */
export const opsBookingStatusEventSchema = z.object({
  kind: z.literal('booking_status'),
  bookingId: z.uuid(),
  from: jobStatusSchema,
  to: jobStatusSchema,
  zoneId: z.uuid().nullable(),
  driverId: z.uuid().nullable(),
  userId: z.uuid(),
  fleetId: z.uuid().nullable(),
  at: z.iso.datetime(),
});
export type OpsBookingStatusEvent = z.infer<typeof opsBookingStatusEventSchema>;

/** A booking entered the system — no transition performs this edge. */
export const opsBookingCreatedEventSchema = z.object({
  kind: z.literal('booking_created'),
  bookingId: z.uuid(),
  zoneId: z.uuid(),
  userId: z.uuid(),
  /**
   * Lets a consumer that only counts states treat creation as entering
   * `searching` without a special case for a transition that never ran.
   */
  status: z.literal('searching'),
  /**
   * Set for scheduled bookings, which sit in `searching` while dormant — the
   * W3 dashboard must not count them as an active search.
   */
  scheduledAt: z.iso.datetime().nullable(),
  at: z.iso.datetime(),
});
export type OpsBookingCreatedEvent = z.infer<typeof opsBookingCreatedEventSchema>;

/**
 * The metrics/badge broadcaster's payloads (W3, §3.4), riding the SAME channel
 * as the booking events — the guide's producer table lists the broadcaster as
 * an `ops:events` producer, and one channel keeps the fan-out the bridge's job
 * rather than N subscriptions.
 *
 * These are the Redis ENVELOPES; the socket frames (`ops:metrics` / `ops:badges`)
 * carry the same bodies without `kind`, so a frame and its envelope cannot
 * drift (`adminOpsMetricsEventSchema` / `adminOpsBadgesEventSchema` in `ops.ts`).
 */
export const opsAdminMetricsEventSchema = z.object({
  kind: z.literal('ops_metrics'),
  kpis: adminOpsKpisSchema,
  at: z.iso.datetime(),
});
export type OpsAdminMetricsEvent = z.infer<typeof opsAdminMetricsEventSchema>;

export const opsAdminBadgesEventSchema = z.object({
  kind: z.literal('ops_badges'),
  badges: adminOpsBadgesSchema,
  at: z.iso.datetime(),
});
export type OpsAdminBadgesEvent = z.infer<typeof opsAdminBadgesEventSchema>;

export const opsEventSchema = z.discriminatedUnion('kind', [
  opsBookingStatusEventSchema,
  opsBookingCreatedEventSchema,
  opsAdminMetricsEventSchema,
  opsAdminBadgesEventSchema,
]);
export type OpsEvent = z.infer<typeof opsEventSchema>;
