import { z } from 'zod';
import { jobStatusSchema } from '../fleet/jobs';

/**
 * The `/customer` namespace (§16.6) — Phase 17.
 *
 * WHY A THIRD NAMESPACE RATHER THAN A THIRD ROOM. The three realms differ in
 * what they may SEND, not only in what they receive: `/fleet` accepts nothing,
 * `/driver` accepts a location stream, and this one accepts nothing either.
 * Collapsing them would mean one `ClientToServerEvents` union covering all
 * three, and the guarantee "a customer socket cannot send anything" would
 * become a runtime check instead of a type.
 *
 * Phase 18 inherits this namespace for live driver position — the same
 * arrangement that had Phase 16 build `driver:{id}` for Phase 17's offers.
 */

export const CUSTOMER_NAMESPACE = '/customer';

/**
 * The only room a customer socket joins, and it is scoped to ONE booking.
 *
 * NOT `customer:{userId}`. A customer has at most one trip in flight (§3.8), so
 * a per-user room would carry exactly one booking's traffic anyway — and the
 * booking id is what the dispatch engine has in hand when it emits. Keying on
 * the booking also means the room name is decided by a ticket the server minted
 * after proving ownership, rather than by anything the client says afterwards.
 */
export const bookingRoom = (bookingId: string): string => `booking:${bookingId}`;

/**
 * §11.7's share-link viewers get NO ROOM HERE, and this is the one place in the
 * phase that departs from the spec on purpose — recorded at the seam it departs
 * from rather than in a changelog nobody reads.
 *
 * §11.7 says the public page is "fed by the same Redis pub/sub via a
 * `track:{shareToken}` channel (read-only)". It is instead fed by a 10-second
 * poll of `GET /v1/track/:shareToken`, for two reasons:
 *
 *   · Every socket in this system is authenticated by a single-use ticket minted
 *     after an ownership check. A share-token room has no owner to check — the
 *     whole point is that a stranger holds the link — so it would be the first
 *     unauthenticated socket surface in the product, with a connection budget
 *     and a room namespace reachable by anyone who was ever forwarded a link.
 *   · A poll is not a downgrade in kind. It is the §19.2 rung the customer's own
 *     app falls back to, and the page's job is to show a truck moving on a map;
 *     10 s is well inside the interpolation window the client already animates
 *     across.
 *
 * If it is ever wanted, the room helper is one line and the frame is
 * `publicTrackSchema` — the shape already exists and is already the thing the
 * poll returns.
 */

/** Server→customer event names. Client→server is deliberately empty. */
export const CUSTOMER_EVENT = {
  READY: 'realtime:ready',
  SEARCH_PROGRESS: 'search:progress',
  BOOKING_STATUS: 'booking:status',
  /** §11.4 — the assigned driver's live position (Phase 18). */
  LOCATION_UPDATE: 'location:update',
  /** §11.5 — the smoothed arrival estimate (Phase 18). */
  ETA_UPDATE: 'eta:update',
} as const;
export type CustomerEventName = (typeof CUSTOMER_EVENT)[keyof typeof CUSTOMER_EVENT];

export const customerReadySchema = z.object({
  bookingId: z.uuid(),
  serverTime: z.iso.datetime(),
});
export type CustomerReadyEvent = z.infer<typeof customerReadySchema>;

/**
 * §9.1.6's "wave transitions reflect the actual engine state (no fake
 * progress)".
 *
 * TowGo's search screen used to run a `setTimeout` ladder that invented a driver
 * after 6.5 seconds; Phase 15 deleted it and left the screen honestly saying
 * "searching" forever. This is what replaces it — every field is read from the
 * engine at the moment it advances a wave, and the same numbers are available on
 * `GET /bookings/:id` for §19.2's polling fallback, so the two channels cannot
 * tell the customer different stories.
 */
export const searchProgressSchema = z.object({
  bookingId: z.uuid(),
  /** 1-based rung of the §6.4 ladder. */
  wave: z.number().int().positive(),
  radiusKm: z.number().positive(),
  /**
   * Drivers offered this booking SO FAR, cumulative across waves — not the
   * current wave's count. The customer is being reassured that effort is being
   * expended, and a number that reset to 3 on every wave would read as progress
   * going backwards.
   */
  driversContacted: z.number().int().nonnegative(),
  /**
   * When the search gives up (§6.4's ~180 s). Sent so the client can show a
   * finite wait rather than an unbounded spinner, and so a reconnecting client
   * knows how much of it is left.
   */
  deadlineAt: z.iso.datetime(),
  at: z.iso.datetime(),
});
export type SearchProgressEvent = z.infer<typeof searchProgressSchema>;

/**
 * §5.1 status changes for this booking.
 *
 * Shares its name with the fleet console's `booking:status` and deliberately
 * NOT its shape — that one carries `fleetId` for tenant routing, which is
 * meaningless here and is not the customer's business. Same event name because
 * it is the same fact.
 */
export const customerBookingStatusSchema = z.object({
  bookingId: z.uuid(),
  status: jobStatusSchema,
  at: z.iso.datetime(),
});
export type CustomerBookingStatusEvent = z.infer<typeof customerBookingStatusSchema>;

/**
 * §11.4's moving truck — the assigned driver's position, for this booking only.
 *
 * SHARES ITS NAME WITH `/fleet`'s `location:update` AND NOT ITS SHAPE, the same
 * arrangement `booking:status` above already has. The fleet frame is a BATCH of
 * trucks (`{ positions: [...] }`) because the console renders a whole fleet; a
 * customer is watching exactly one person and a one-element array would be
 * ceremony. Same event name because it is the same underlying fact — a ping.
 *
 * `lowAccuracy` arrives pre-computed against `LOW_ACCURACY_METERS`, carried
 * through from `driverLocationEventSchema` rather than re-derived: the app draws
 * a halo instead of a dot on the strength of it, and two surfaces disagreeing
 * about whether a fix is trustworthy is a bug nobody would ever look for.
 *
 * `at` is the ping's own timestamp, NOT the relay's. §11.6's ghost-marker and
 * support-banner thresholds are ages measured from this value, so stamping it at
 * fan-out time would make a driver whose phone died sixty seconds ago look live
 * for as long as the relay kept re-sending the last fix.
 */
export const customerLocationUpdateSchema = z.object({
  bookingId: z.uuid(),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  headingDeg: z.number().nullable(),
  speedKph: z.number().nullable(),
  lowAccuracy: z.boolean(),
  at: z.iso.datetime(),
});
export type CustomerLocationUpdateEvent = z.infer<typeof customerLocationUpdateSchema>;

/**
 * §11.5's ETA, already smoothed.
 *
 * THE SERVER SMOOTHS, NOT THE CLIENT. §11.5's ±40 % rule exists to prevent the
 * "7 min → 21 min → 8 min" whiplash that destroys trust, and there are three
 * consumers of this number (TowGo, the public share page, and the §19.2 poll).
 * Smoothing on each of them means three implementations of one rule, drifting,
 * and a customer who sees a different estimate depending on whether their socket
 * happened to be up. The blend runs once, where the previous value lives.
 *
 * The client still counts DOWN between updates (§11.4's "ETA chip counts down
 * between recomputes so it never appears frozen") — that is presentation, not
 * estimation, and it never invents a new estimate.
 */
export const etaUpdateSchema = z.object({
  bookingId: z.uuid(),
  /** To the ACTIVE leg's destination: pickup before `in_progress`, drop after. */
  etaSeconds: z.number().int().nonnegative(),
  /**
   * Which leg this estimate is for. Sent because the number alone is ambiguous
   * at exactly the moment it matters — 4 minutes to the pickup and 4 minutes to
   * the drop mean opposite things to the person waiting.
   */
  leg: z.enum(['pickup', 'drop']),
  /**
   * Labelled degradation (§19.2). `haversine` means no Directions route backed
   * this — the app says "estimated" rather than presenting it as a routed ETA.
   */
  source: z.enum(['google_directions', 'haversine']),
  at: z.iso.datetime(),
});
export type EtaUpdateEvent = z.infer<typeof etaUpdateSchema>;

/**
 * §11.5's smoothing bound, exported so the engine and its test share one number.
 * A displayed ETA never moves more than 40 % of its previous value in one step.
 */
export const ETA_SMOOTHING_FACTOR = 0.4;

/**
 * §11.5's recompute triggers, in one place because the engine, the tests and the
 * driver-side cadence all have to agree on them.
 */
export const ETA_RECOMPUTE = {
  /** "every 60s". */
  intervalMs: 60_000,
  /** "driver deviates > 200 m from polyline". */
  deviationMeters: 200,
  /** "driver stationary > 90s (traffic)". */
  stationaryMs: 90_000,
} as const;

