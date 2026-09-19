import { z } from 'zod';
import { jobOfferSchema } from '../driver/jobs';

/**
 * The `/driver` namespace (§16.6) — Phase 16.
 *
 * WHY A SECOND NAMESPACE RATHER THAN A SECOND ROOM ON `/fleet`. `/fleet` ships
 * an intentionally EMPTY `ClientToServerEvents`: room membership there is
 * derived solely from a verified handshake claim and nothing client-supplied
 * can reach a room name. The driver surface needs the opposite — an inbound
 * message every few seconds — so putting it on `/fleet` would delete that
 * property for the console as collateral. Two namespaces keep the fleet
 * guarantee intact and make "this namespace accepts input" a visible fact.
 */

export const DRIVER_NAMESPACE = '/driver';

/**
 * The only room a driver socket ever joins. Derived from the redeemed ticket's
 * subject, never from a payload — the same rule `fleetRoom` follows.
 *
 * Phase 17's `job:offer` targets exactly this room, which is why it is created
 * here rather than there: an offer surface is not the place to be inventing a
 * room scheme for the first time.
 */
export const driverRoom = (driverId: string): string => `driver:${driverId}`;

/** Server→driver event names (§16.6). */
export const DRIVER_EVENT = {
  READY: 'realtime:ready',
  CONFIG_UPDATE: 'config:update',
  /** §6.3's offer (Phase 17). The room this lands in is why it was built in 16. */
  JOB_OFFER: 'job:offer',
  /** The offer is gone — someone else took it, it expired, or the customer cancelled. */
  JOB_REVOKED: 'job:revoked',
} as const;
export type DriverEventName = (typeof DRIVER_EVENT)[keyof typeof DRIVER_EVENT];

/** Driver→server event names. The first inbound socket messages in the system. */
export const DRIVER_INBOUND_EVENT = {
  LOCATION_UPDATE: 'location:update',
} as const;

/** Sent once on connect, mirroring `/fleet`'s own ready frame. */
export const driverReadySchema = z.object({
  driverId: z.uuid(),
  serverTime: z.iso.datetime(),
});
export type DriverReadyEvent = z.infer<typeof driverReadySchema>;

/**
 * §16.6 `config:update` — the runtime knobs the handset obeys.
 *
 * Sent on connect and on every state change that moves the cadence (going
 * online, going offline, a job starting or ending). The handset must treat the
 * most recent frame as authoritative rather than merging: a partial update is
 * how two conflicting cadences end up running at once.
 */
export const driverConfigUpdateSchema = z.object({
  /** `null` means stop capturing entirely (§20.4), not "capture rarely". */
  pingIntervalMs: z.number().int().positive().nullable(),
  /** Echoed so the app can show its own honest "your position is stale" state. */
  staleAfterMs: z.number().int().positive(),
  /** Above this, report the fix but render it as a halo (§11.3). */
  lowAccuracyMeters: z.number().int().positive(),
  at: z.iso.datetime(),
});
export type DriverConfigUpdateEvent = z.infer<typeof driverConfigUpdateSchema>;

/**
 * What the ping pipeline publishes on the internal `location:driver` channel.
 *
 * The DRIVER-shaped fact, as opposed to the truck-shaped one the fleet console
 * has consumed since Phase 5. Both are published for every ping: the fleet
 * adapter translates so `<FleetMap>` stays untouched, and this carries what a
 * consumer following a PERSON needs — Phase 18's customer tracking, which
 * watches a driver approach a pickup and has no truck id to key on until an
 * assignment exists.
 *
 * Schema'd rather than left as an ad-hoc object for the reason `events.ts`
 * states: `JSON.parse` is `any`, and the wire is the one place a shape change is
 * silent instead of a type error.
 */
export const driverLocationEventSchema = z.object({
  driverId: z.uuid(),
  /** The §6.1 candidate-store partition this fix landed in. */
  zoneId: z.uuid(),
  /** Null for an independent driver. */
  fleetId: z.uuid().nullable(),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  headingDeg: z.number().nullable(),
  speedKph: z.number().nullable(),
  accuracyM: z.number().nullable(),
  /**
   * Pre-computed against `LOW_ACCURACY_METERS` rather than left to each
   * consumer to derive from `accuracyM`. A client comparing raw metres against
   * its own constant is how two surfaces end up disagreeing about whether the
   * same fix is trustworthy — and this is the flag that decides halo vs dot.
   */
  lowAccuracy: z.boolean(),
  seq: z.number().int().nonnegative(),
  at: z.iso.datetime(),
});
export type DriverLocationEvent = z.infer<typeof driverLocationEventSchema>;

/**
 * §6.3's `job:offer` frame.
 *
 * The payload IS `jobOfferSchema` — the same object `GET /v1/driver/offers/current`
 * returns. That is deliberate: the socket and the REST resync are two deliveries
 * of one fact, and a client that had to reconcile two shapes would eventually
 * render them differently. Declared in `driver/jobs.ts` rather than here because
 * the REST route is its primary home; this re-exports the wire binding.
 */
export const jobOfferEventSchema = jobOfferSchema;
export type JobOfferEvent = z.infer<typeof jobOfferEventSchema>;

/**
 * The offer is no longer available.
 *
 * SENT RATHER THAN LEFT TO THE COUNTDOWN, because the countdown is not the only
 * way an offer dies: another driver accepted first, the customer cancelled mid
 * -search, or an admin paused the zone. A takeover screen that sat there until
 * its timer ran out would let a driver tap Accept on a job that has been gone
 * for fifteen seconds and take a 409 for their trouble.
 */
export const jobRevokedSchema = z.object({
  bookingId: z.uuid(),
  /**
   * Why, so the client can say something true. `taken` is by far the most
   * common and is the one worth naming — "someone got there first" is a
   * different feeling from "you were too slow". `fleet_suspended` (W6) is
   * A15's: the fleet was suspended while the offer was still live, and the
   * frame reaching the driver beats the offer timing out against their rate.
   * `reassigned` (W8) is an operator moving the job: the driver did nothing
   * wrong, and the app must not render it as a cancellation.
   */
  reason: z.enum(['taken', 'expired', 'cancelled', 'paused', 'fleet_suspended', 'reassigned']),
  at: z.iso.datetime(),
});
export type JobRevokedEvent = z.infer<typeof jobRevokedSchema>;
