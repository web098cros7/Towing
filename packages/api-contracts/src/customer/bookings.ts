import { z } from 'zod';
import { serviceTypeSchema } from '../common/enums';
import { geoPointSchema } from '../common/geo';
import { unsignedPaiseSchema } from '../common/money';
import { commissionBandSchema, jobStatusSchema } from '../fleet/jobs';
import { vehicleClassSchema } from '../fleet/trucks';
import { fareBreakdownSchema } from './pricing-estimate';

/**
 * The customer's booking surface (§16.2, §5.1, §9.1.5–§9.1.10).
 *
 * STATUS IS `jobStatusSchema`, THE SAME TEN VALUES THE FLEET SEES. §5.1 defines
 * exactly ten states and `booking_status` in Postgres holds exactly those ten.
 * TowGo's local `statusMeta.ts` invented an eleventh — `'scheduled'` — which no
 * server can ever return; a scheduled booking is `searching` with a future
 * `scheduledAt`, and the app derives its badge from that. Declaring a second
 * status vocabulary here would make the two drift by design.
 *
 * MONEY IS INTEGER PAISE and timestamps are ISO 8601, both without exception.
 * Phase 12 corrected the contract this way and deferred the booking feature's
 * own fields to "their own phases (15 bookings)" — this is that phase.
 */

/** `POST /v1/bookings` — the §3.4 confirm. Requires an `Idempotency-Key` header (§19.4). */
export const bookingCreateSchema = z
  .object({
    /** A `services.slug` from `GET /v1/services`; the server maps it to a billable type. */
    serviceSlug: z.string().min(1),
    /** Overrides the catalogue row's default. Required when that default is null. */
    vehicleClass: vehicleClassSchema.optional(),

    pickup: geoPointSchema,
    /** Human-readable label for the pickup pin, shown back in the trip list. */
    pickupAddress: z.string().min(1).max(300),
    drop: geoPointSchema.optional(),
    dropAddress: z.string().min(1).max(300).optional(),

    /**
     * §9.1.5's "later". Recorded and honoured as a dispatch DELAY; the booking
     * is still created immediately and still enters `searching`, because §5.1
     * has no scheduled state. Must be in the future when present.
     */
    scheduledAt: z.iso.datetime().optional(),

    /** §9.1.5's note editor. */
    note: z.string().max(500).optional(),

    /**
     * §9.1.5's "booking for someone else". The person the driver will actually
     * meet, when that is not the account holder.
     */
    contact: z
      .object({
        name: z.string().min(1).max(120),
        mobile: z.string().regex(/^\+?[0-9]{10,15}$/, 'Not a valid mobile number'),
      })
      .optional(),

    /** A `saved_vehicles` row, so the driver knows what they are collecting. */
    savedVehicleId: z.uuid().optional(),

    /**
     * §9.4.11's coupon, applied inside the SAME transaction that locks the fare.
     *
     * The code the app validated with `POST /v1/coupons/validate` is ADVISORY:
     * confirm re-validates from scratch and computes its own discount. A fare
     * lock based on a number the client carried is not a lock.
     */
    couponCode: z.string().trim().min(3).max(32).optional(),
  })
  .refine((body) => !body.drop || Boolean(body.dropAddress), {
    message: 'dropAddress is required when a drop is given',
    path: ['dropAddress'],
  });
export type BookingCreate = z.infer<typeof bookingCreateSchema>;

/**
 * A booking as its own customer sees it.
 *
 * NO COMMISSION FIELDS, for the same §7.6 reason the estimate has none — the
 * booking row carries `commission_band`, `commission_pct`, `commission_amount`
 * and `driver_payout`, and none of them is the customer's business. The mapper
 * builds this field by field rather than spreading the row.
 */
export const bookingSchema = z.object({
  id: z.uuid(),
  /** Human-quotable short code, e.g. `TW-3F9A21B4`. Matches what the fleet console shows. */
  reference: z.string(),
  status: jobStatusSchema,

  serviceSlug: z.string(),
  serviceType: serviceTypeSchema,
  vehicleClass: vehicleClassSchema,

  pickupAddress: z.string().nullable(),
  pickup: geoPointSchema,
  dropAddress: z.string().nullable(),
  drop: geoPointSchema.nullable(),
  distanceKm: z.number().nullable(),

  /** The fare LOCKED at confirm (§3.4). Admin edits afterwards never touch it. */
  breakdown: fareBreakdownSchema,
  /** §3.3 tier. A label, not a take rate. */
  band: commissionBandSchema.nullable(),

  /** Future-dated when the customer chose "later"; null for an immediate tow. */
  scheduledAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type Booking = z.infer<typeof bookingSchema>;

/** `GET /v1/bookings/:id` — everything in the list row plus what only the detail screen needs. */
export const bookingDetailSchema = bookingSchema.extend({
  note: z.string().nullable(),
  contactName: z.string().nullable(),
  contactMobile: z.string().nullable(),
  cancellationReason: z.string().nullable(),
  cancelledBy: z.enum(['customer', 'driver', 'fleet_owner', 'admin', 'system']).nullable(),
  cancellationFeePaise: unsignedPaiseSchema,
  /**
   * Whether the booking OTP can be fetched yet (§9.1.7 — never before
   * assignment). Sent so the app can show or hide the OTP card without probing
   * a route that would 409.
   */
  otpAvailable: z.boolean(),
  /**
   * Live §6.4 search state, or `null` once the booking is no longer searching.
   *
   * §19.2's REST fallback carries the SAME facts the `/customer` socket pushes,
   * so a client on the 10-second poll and a client on a socket cannot tell the
   * customer different stories about how the search is going. §9.1.6's AC is
   * "wave transitions reflect the actual engine state" — polled real state is
   * real state; only invented state is forbidden.
   */
  search: z
    .object({
      wave: z.number().int().positive(),
      radiusKm: z.number().positive(),
      /** Cumulative across waves — see `searchProgressSchema` for why. */
      driversContacted: z.number().int().nonnegative(),
      deadlineAt: z.iso.datetime().nullable(),
    })
    .nullable(),
});
export type BookingDetail = z.infer<typeof bookingDetailSchema>;

/** `GET /v1/bookings` — keyset paginated, newest first. */
export const bookingListResponseSchema = z.object({
  items: z.array(bookingSchema),
  nextCursor: z.string().nullable(),
});
export type BookingListResponse = z.infer<typeof bookingListResponseSchema>;

/**
 * `GET /v1/bookings/:id/otp` (§9.1.7).
 *
 * `expiresAt` is 30 minutes from THIS retrieval. Fetching again inside the
 * window returns the same code; fetching after it mints a new one and restarts
 * the clock, so a slow search or heavy traffic can never leave the customer
 * holding a dead code at the handover.
 */
export const bookingOtpResponseSchema = z.object({
  code: z.string().length(6),
  expiresAt: z.iso.datetime(),
});
export type BookingOtpResponse = z.infer<typeof bookingOtpResponseSchema>;

/** `POST /v1/bookings/:id/cancel`. */
export const bookingCancelSchema = z.object({
  reason: z.string().max(500).optional(),
  /**
   * §3.5's fee, already collected.
   *
   * REQUIRED ON A CHARGEABLE TIER, absent on a free one. The two-call shape is
   * deliberate: a cancellation fee has to be collected BEFORE the trip is
   * cancelled, or the platform cancels and then chases the customer for money
   * it can no longer hold anything against. So the app opens an intent with
   * `purpose: 'cancellation_fee'`, runs the sheet, and passes the result here.
   */
  payment: z
    .object({
      gatewayRef: z.string().min(1),
      orderRef: z.string().min(1),
      signature: z.string().min(1),
    })
    .optional(),
});
export type BookingCancel = z.infer<typeof bookingCancelSchema>;

/**
 * §3.5's tiers. Phase 15 permitted only `free` and refused the rest; Phase 19
 * gave the chargeable tiers the ledger legs and the collection path they were
 * waiting for, so all three now proceed.
 */
export const cancellationTierSchema = z.enum(['free', 'partial', 'full']);
export type CancellationTier = z.infer<typeof cancellationTierSchema>;

export const bookingCancelResponseSchema = z.object({
  id: z.uuid(),
  status: jobStatusSchema,
  tier: cancellationTierSchema,
  feePaise: unsignedPaiseSchema,
  /**
   * §3.5's share of the fee credited to the driver, when there was one on the
   * booking. Surfaced so the customer can see the fee was not simply pocketed.
   */
  driverCompensationPaise: unsignedPaiseSchema,
});
export type BookingCancelResponse = z.infer<typeof bookingCancelResponseSchema>;

/**
 * `GET /v1/bookings/:id/cancellation-quote` — §9.1.7's "cancel button
 * (policy-aware, shows fee before confirming)".
 *
 * THE SAME `cancellationPolicy()` THE CANCEL ROUTE RUNS, called with the same
 * arguments, returned before the customer commits. Two implementations of §3.5 —
 * one to quote and one to charge — is the arrangement where a customer is shown
 * ₹0 and billed ₹150, and the phase after this one is the one that starts
 * actually collecting the fee.
 *
 * `reason` is the policy's own explanation ("the driver is already on the way"),
 * which is why it exists on the server-side result in the first place.
 */
export const cancellationQuoteSchema = z.object({
  tier: cancellationTierSchema,
  feePaise: unsignedPaiseSchema,
  reason: z.string(),
  /**
   * Whether cancelling can actually proceed at this tier.
   *
   * TRUE FOR EVERY TIER SINCE PHASE 19. It stays in the contract because the
   * distinction it draws is real and the app still branches on it: a `false`
   * here means "we cannot take this fee, so cancelling here is not possible",
   * and that is the honest thing to render if collection is ever unavailable —
   * a gateway outage, say. Quoting a charge that cannot be taken is honest;
   * hiding one that is about to be taken is not.
   */
  chargeable: z.boolean(),
  /** §3.5's share of the fee that would reach the driver. */
  driverCompensationPaise: unsignedPaiseSchema,
});
export type CancellationQuote = z.infer<typeof cancellationQuoteSchema>;

/**
 * §11.6's honesty states, in one number.
 *
 * The client is given the AGE of the last fix, not a boolean, and compares it
 * against `PRESENCE_STALE_MS`/`PRESENCE_OFFLINE_MS` from `realtime/presence.ts`
 * itself. A server-computed "isStale" would be a third definition of the
 * thresholds alongside the console's and the app's, and the one that silently
 * wins.
 */
export const trackedPositionSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  headingDeg: z.number().nullable(),
  speedKph: z.number().nullable(),
  /** Pre-computed against `LOW_ACCURACY_METERS` — halo vs dot, decided once. */
  lowAccuracy: z.boolean(),
  at: z.iso.datetime(),
});
export type TrackedPosition = z.infer<typeof trackedPositionSchema>;

/** §9.1.7's driver card. No mobile number — that is `GET /:id/contact`, behind telephony. */
export const trackedDriverSchema = z.object({
  name: z.string(),
  photoUrl: z.string().nullable(),
  rating: z.number().nullable(),
  totalTrips: z.number().int().nonnegative(),
  vehiclePlate: z.string().nullable(),
  vehicleClass: vehicleClassSchema.nullable(),
});
export type TrackedDriver = z.infer<typeof trackedDriverSchema>;

/**
 * `GET /v1/bookings/:id/tracking` — §19.2's polling rung for §9.1.7.
 *
 * CARRIES EXACTLY WHAT THE `/customer` SOCKET PUSHES, which is the whole point:
 * §9.1.6 established the rule when `search` was added to the booking detail —
 * "a client on the 10-second poll and a client on a socket cannot tell the
 * customer different stories". This is that rule applied to the tracking half.
 *
 * Separate from `GET /bookings/:id` rather than folded into it because this is
 * polled every 10 s in the degraded path while the detail is a heavier read
 * nothing needs at that cadence.
 */
export const bookingTrackingSchema = z.object({
  bookingId: z.uuid(),
  status: jobStatusSchema,
  driver: trackedDriverSchema.nullable(),
  /** `null` before assignment, or when no fix has arrived yet. */
  position: trackedPositionSchema.nullable(),
  /** Seconds to the ACTIVE leg's destination — pickup, then drop after `start`. */
  etaSeconds: z.number().int().nonnegative().nullable(),
  /** Labelled, never laundered: a straight-line ETA says so. */
  etaSource: z.enum(['google_directions', 'haversine']).nullable(),
  /** Encoded Google polylines, §11.4. */
  routePolyline: z.string().nullable(),
  routeDropPolyline: z.string().nullable(),
  pickup: geoPointSchema,
  drop: geoPointSchema.nullable(),
  /** §5.2's instants, so the timeline renders without a second request. */
  assignedAt: z.iso.datetime().nullable(),
  arrivedAt: z.iso.datetime().nullable(),
  startedAt: z.iso.datetime().nullable(),
  completedAt: z.iso.datetime().nullable(),
  /** Whether a share link is live right now (§11.7) — drives the share button's state. */
  shared: z.boolean(),
  at: z.iso.datetime(),
});
export type BookingTracking = z.infer<typeof bookingTrackingSchema>;

/**
 * `POST /v1/bookings/:id/share` and `DELETE` the same path — §11.7.
 *
 * The server returns the whole URL, not just the token. The public origin is a
 * backend env var (`PUBLIC_TRACK_BASE_URL`), exactly as `wsUrl` rides the
 * realtime ticket response: relocating the share page must not need a mobile
 * release, and two apps composing the URL themselves would eventually compose it
 * differently.
 */
export const bookingShareResponseSchema = z.object({
  token: z.string(),
  url: z.string(),
  /** Null while the trip is live; set to completion + 30 min by the finalizer. */
  expiresAt: z.iso.datetime().nullable(),
});
export type BookingShareResponse = z.infer<typeof bookingShareResponseSchema>;
