import { z } from 'zod';
import { jobStatusSchema } from '../fleet/jobs';

/**
 * §11.7's public share-trip projection — `GET /v1/track/:shareToken`.
 *
 * THE ONLY UNAUTHENTICATED READ OF A BOOKING IN THE SYSTEM. Everything else on
 * the customer surface sits behind `JwtAuthGuard` and an ownership check; this
 * one is reachable by anyone holding a link that was forwarded through WhatsApp,
 * screenshotted, or pasted into a group chat. It is therefore defined as its own
 * schema rather than as a `.pick()` or `.omit()` of the booking DTO.
 *
 * That is the entire design decision here, and it is worth being explicit about
 * why. A derived schema inherits every field added upstream: the day someone adds
 * `contactMobile` to `bookingDetailSchema` — a perfectly reasonable thing to do —
 * an `omit()` list that was not updated in the same commit silently starts
 * publishing a phone number to the public internet. A hand-written allowlist
 * cannot fail that way; a new field is invisible here until somebody deliberately
 * types it in. `track-projection.spec.ts` asserts the key list is exactly this,
 * so widening it is a decision with a failing test attached.
 *
 * §11.7's own words, which this schema is a transcription of: "shows live truck
 * position, pickup area, ETA, driver first name + vehicle plate, trip status —
 * **no phone numbers, no exact customer address**".
 *
 * Deliberately absent, each for a stated reason:
 *   · the fare and its breakdown — a link recipient is not a party to the money
 *   · any phone number, either party's — §11.7 names this first
 *   · the exact pickup or drop coordinate — coarsened below
 *   · the customer's name — the sharer knows who they are; nobody else needs to
 *   · the booking id, driver id or reference — nothing correlatable to another API
 *   · the collection OTP — it starts the trip; a leaked one is a stolen vehicle
 */

/**
 * A position coarsened to ~100 m, the same treatment §11.9 gives anonymous
 * nearby drivers pre-booking.
 *
 * NOT the raw fix. A live-precision coordinate on an unauthenticated endpoint is
 * a tracking beacon for whoever holds the link, and the link outlives the reason
 * it was sent — the recipient of a "here is my tow" message at 9pm should not be
 * able to watch a driver's exact doorstep an hour later. 100 m is enough to see
 * a truck approaching on a map and not enough to see which building it stopped
 * at. Heading is kept because a rotated marker is what makes the map readable;
 * speed is dropped because nothing on the page renders it.
 */
export const coarsePositionSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  headingDeg: z.number().nullable(),
  at: z.iso.datetime(),
});
export type CoarsePosition = z.infer<typeof coarsePositionSchema>;

export const publicTrackSchema = z.object({
  status: jobStatusSchema,
  /**
   * FIRST NAME ONLY, split server-side. Sending the full name and trimming it in
   * the browser would put the surname in the JSON either way.
   */
  driverFirstName: z.string().nullable(),
  /** §11.7 names the plate explicitly — it is how the viewer identifies the truck. */
  vehiclePlate: z.string().nullable(),
  /** ~100 m coarse, per `coarsePositionSchema`. Null until the first fix. */
  position: coarsePositionSchema.nullable(),
  /** "pickup area" — the same coarsening, so the neighbourhood shows and the address does not. */
  pickupArea: coarsePositionSchema.omit({ headingDeg: true, at: true }).nullable(),
  etaSeconds: z.number().int().nonnegative().nullable(),
  /** §11.4's route line. Drawn from the driver to the pickup area, never to a drop address. */
  routePolyline: z.string().nullable(),
  /**
   * When this link stops working. Rendered so a viewer looking at a stale page
   * knows it is over rather than assuming the truck stopped moving.
   */
  expiresAt: z.iso.datetime().nullable(),
  at: z.iso.datetime(),
});
export type PublicTrack = z.infer<typeof publicTrackSchema>;

/**
 * The exact key list, exported so the contract test can assert it without
 * re-deriving it from the schema it is meant to be checking.
 */
export const PUBLIC_TRACK_FIELDS = [
  'status',
  'driverFirstName',
  'vehiclePlate',
  'position',
  'pickupArea',
  'etaSeconds',
  'routePolyline',
  'expiresAt',
  'at',
] as const;

/** ~100 m at the equator, and the grid the coarsener snaps to. */
export const TRACK_COARSEN_DEGREES = 0.001;
