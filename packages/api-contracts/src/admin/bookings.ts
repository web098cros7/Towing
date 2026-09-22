import { z } from 'zod';
import { serviceTypeSchema } from '../common/enums';
import { unsignedPaiseSchema } from '../common/money';
import { pageEnvelopeSchema, pageQuerySchema } from '../common/pagination';
import { commissionBandSchema, jobStatusSchema } from '../fleet/jobs';
import { vehicleClassSchema } from '../fleet/trucks';
import { invoiceLinkSchema, paymentPurposeSchema, paymentStatusSchema } from '../customer/payments';
import { refundKindSchema, refundStatusSchema } from './finance';

/**
 * W8's bookings console — `/v1/admin/bookings/*` (§9.4.7, §5.1, §6.5, §14.2).
 *
 * The list/detail/actions surface an operator runs the money and dispatch
 * exceptions from. Two rules this file carries on its face:
 *
 *  - **The manual override never touches money.** `ADMIN_TRANSITION_EDGES` is
 *    the complete allowlist, enforced by the service against the FROM status as
 *    well as the TO status; `paid` is not a target on any edge. Settlement is
 *    the only writer of `→ paid` (§9.4.7, decision G7-adjacent).
 *  - **Cancel is pre-payment only.** `completed` / `paid` / `disputed` refuse
 *    with a 409 pointing at the dispute route — the exit table in the guide is
 *    where money-bearing endings live.
 */

/**
 * Repeated query params arrive as a bare string, an array, or nothing at all.
 * `status[]=assigned&status[]=en_route` on the wire means "any of these";
 * normalize the singleton case before validating so `?status=assigned` and
 * `?status[]=assigned` are the same request.
 */
function multiQuery<T extends z.ZodType>(item: T) {
  return z
    .preprocess(
      (value) => (value === undefined ? undefined : Array.isArray(value) ? value : [value]),
      z.array(item).min(1).max(20),
    )
    .optional();
}

/** `feeMode` on the admin cancel — G4 waives by default. */
export const BOOKING_CANCEL_FEE_MODES = ['waive', 'apply_policy'] as const;
export const bookingCancelFeeModeSchema = z.enum(BOOKING_CANCEL_FEE_MODES);
export type BookingCancelFeeMode = z.infer<typeof bookingCancelFeeModeSchema>;

/**
 * The manual override allowlist (§9.4.7), edge by edge.
 *
 * `in_progress → completed` is allowed but routed through the real completion
 * service, so §7.4's waiting charge bills from the snapshot; `no_drivers_found
 * → searching` reopens the search. Everything else — including every edge into
 * `paid` and `disputed` — belongs to the dispatch, driver, customer or dispute
 * paths, not to this table.
 */
export const ADMIN_TRANSITION_EDGES = [
  { from: 'assigned', to: 'arrived' },
  { from: 'en_route', to: 'arrived' },
  { from: 'arrived', to: 'in_progress' },
  { from: 'in_progress', to: 'completed' },
  { from: 'no_drivers_found', to: 'searching' },
] as const;

/** The actor column of `booking_status_history`, mirrored as a contract. */
export const bookingActorSchema = z.enum(['customer', 'driver', 'fleet_owner', 'admin', 'system']);
export type BookingActorValue = z.infer<typeof bookingActorSchema>;

/** `bookings.payment_method` — the method settlement recorded. */
export const bookingPaymentMethodSchema = z.enum(['upi', 'card', 'cash', 'wallet']);

// ---------------------------------------------------------------------------
// List (§9.4.7 filters: status, date, user, driver, zone, band)
// ---------------------------------------------------------------------------

export const adminBookingsQuerySchema = pageQuerySchema.extend({
  /** Any-of. `searching` + `no_drivers_found` is the "live problems" chip. */
  status: multiQuery(jobStatusSchema),
  /** Inclusive IST date bounds on `created_at`. */
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  userId: z.uuid().optional(),
  driverId: z.uuid().optional(),
  fleetId: z.uuid().optional(),
  zoneId: z.uuid().optional(),
  band: commissionBandSchema.optional(),
  serviceType: serviceTypeSchema.optional(),
  /** Trigram over booking code prefix, addresses and the customer's name/mobile. */
  q: z.string().trim().min(1).optional(),
});
export type AdminBookingsQuery = z.infer<typeof adminBookingsQuerySchema>;

/**
 * A list row carries who and where — a table of UUIDs with a status chip is
 * not a bookings console.
 */
export const adminBookingSummarySchema = z.object({
  id: z.uuid(),
  /** Display-only, derived from the id — bookings have no code column. */
  code: z.string(),
  status: jobStatusSchema,
  serviceType: serviceTypeSchema,
  vehicleClass: vehicleClassSchema,
  userId: z.uuid(),
  userName: z.string().nullable(),
  userMobile: z.string(),
  driverId: z.uuid().nullable(),
  driverName: z.string().nullable(),
  fleetId: z.uuid().nullable(),
  fleetName: z.string().nullable(),
  zoneId: z.uuid().nullable(),
  zoneName: z.string().nullable(),
  pickupAddress: z.string().nullable(),
  dropAddress: z.string().nullable(),
  distanceKm: z.number().nullable(),
  totalPaise: unsignedPaiseSchema,
  commissionPaise: unsignedPaiseSchema,
  driverPayoutPaise: unsignedPaiseSchema,
  commissionBand: commissionBandSchema.nullable(),
  commissionPct: z.number().nullable(),
  scheduledAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type AdminBookingSummary = z.infer<typeof adminBookingSummarySchema>;

export const adminBookingsResponseSchema = pageEnvelopeSchema(adminBookingSummarySchema);
export type AdminBookingsResponse = z.infer<typeof adminBookingsResponseSchema>;

// ---------------------------------------------------------------------------
// Detail (§9.4.7: items, parties, address, timeline, payment and commission
// breakdown)
// ---------------------------------------------------------------------------

export const adminBookingTimelineEntrySchema = z.object({
  status: jobStatusSchema,
  actor: bookingActorSchema,
  /** Which admin moved it, when the actor is `admin` (migration 0020's column). */
  actorId: z.uuid().nullable(),
  note: z.string().nullable(),
  at: z.iso.datetime(),
});
export type AdminBookingTimelineEntry = z.infer<typeof adminBookingTimelineEntrySchema>;

export const adminBookingPaymentSchema = z.object({
  id: z.uuid(),
  purpose: paymentPurposeSchema,
  status: paymentStatusSchema,
  method: bookingPaymentMethodSchema.nullable(),
  amountPaise: unsignedPaiseSchema,
  /** Migration 0025 — the running total of refunds against this payment. */
  refundedAmountPaise: unsignedPaiseSchema,
  capturedAt: z.iso.datetime().nullable(),
  failureReason: z.string().nullable(),
  createdAt: z.iso.datetime(),
});
export type AdminBookingPayment = z.infer<typeof adminBookingPaymentSchema>;

export const adminBookingRefundSchema = z.object({
  id: z.uuid(),
  kind: refundKindSchema,
  amountPaise: unsignedPaiseSchema,
  reason: z.string(),
  status: refundStatusSchema,
  /** Set when the refund came out of a dispute's resolution. */
  disputeId: z.uuid().nullable(),
  processedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
});
export type AdminBookingRefund = z.infer<typeof adminBookingRefundSchema>;

/**
 * The frozen fare, paisa for paisa. This is the snapshot §3.4 locks at
 * confirm — later pricing edits must not change a single number here.
 */
export const adminBookingBreakdownSchema = z.object({
  baseFarePaise: unsignedPaiseSchema,
  distanceChargePaise: unsignedPaiseSchema,
  nightChargePaise: unsignedPaiseSchema,
  highwayChargePaise: unsignedPaiseSchema,
  accidentChargePaise: unsignedPaiseSchema,
  waitingChargePaise: unsignedPaiseSchema,
  surgePaise: unsignedPaiseSchema,
  discountPaise: unsignedPaiseSchema,
  taxPct: z.number(),
  taxAmountPaise: unsignedPaiseSchema,
  totalPaise: unsignedPaiseSchema,
  commissionBand: commissionBandSchema.nullable(),
  commissionPct: z.number().nullable(),
  commissionPaise: unsignedPaiseSchema,
  driverPayoutPaise: unsignedPaiseSchema,
});
export type AdminBookingBreakdown = z.infer<typeof adminBookingBreakdownSchema>;

export const adminBookingDetailSchema = adminBookingSummarySchema.extend({
  pickupLat: z.number(),
  pickupLng: z.number(),
  dropLat: z.number().nullable(),
  dropLng: z.number().nullable(),
  note: z.string().nullable(),
  /** §9.1.5's "booking for someone else" — who the driver will actually meet. */
  contactName: z.string().nullable(),
  contactMobile: z.string().nullable(),
  /** §7.4's waiting policy, snapshotted at confirm. */
  waitingFreeMinutes: z.number().int().nullable(),
  waitingPerMinutePaise: unsignedPaiseSchema.nullable(),
  completedAt: z.iso.datetime().nullable(),
  paidAt: z.iso.datetime().nullable(),
  cancelledBy: bookingActorSchema.nullable(),
  cancellationReason: z.string().nullable(),
  cancellationFeePaise: unsignedPaiseSchema,
  driverCompensationPaise: unsignedPaiseSchema,
  unableReason: z.string().nullable(),
  /** §6.4 wave state — the dispatch tab explains it via W5's inspector. */
  searchWave: z.number().int().nullable(),
  dispatchDeadlineAt: z.iso.datetime().nullable(),
  breakdown: adminBookingBreakdownSchema,
  timeline: z.array(adminBookingTimelineEntrySchema),
  payments: z.array(adminBookingPaymentSchema),
  refunds: z.array(adminBookingRefundSchema),
  /**
   * The open dispute, when one exists — the partial unique index guarantees at
   * most one. Null when none is open (resolved ones live in `refunds`/audit).
   */
  openDisputeId: z.uuid().nullable(),
});
export type AdminBookingDetail = z.infer<typeof adminBookingDetailSchema>;

/**
 * `GET /v1/admin/bookings/:id/invoice` — the same signed link the customer
 * gets, through an admin path that skips the ownership check. Every view is
 * audited (`booking.invoice.view`); the link itself expires like any other.
 */
export const adminBookingInvoiceSchema = invoiceLinkSchema;
export type AdminBookingInvoice = z.infer<typeof adminBookingInvoiceSchema>;

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

/**
 * Cancel — pre-payment states only (§9.4.7, G4 waives by default).
 *
 * `apply_policy` mirrors the customer-cancel policy tiers from the booking's
 * current status; the fee is recorded on the booking and the driver
 * compensation posts when the policy says so (or when `compensateDriver` is
 * explicitly true, even under `waive`). Collection from the customer is not
 * part of M3 — the fee is a recorded, auditable number.
 */
export const adminBookingCancelBodySchema = z.object({
  reason: z.string().trim().min(4).max(500),
  feeMode: bookingCancelFeeModeSchema.default('waive'),
  compensateDriver: z.boolean().default(false),
});
export type AdminBookingCancelBody = z.infer<typeof adminBookingCancelBodySchema>;

export const adminBookingCancelResponseSchema = z.object({
  bookingId: z.uuid(),
  status: z.literal('cancelled'),
  feePaise: unsignedPaiseSchema,
  driverCompensationPaise: unsignedPaiseSchema,
  /** §9.4.11 — a cancelled search returns the coupon; the response says so. */
  couponReleased: z.boolean(),
});
export type AdminBookingCancelResponse = z.infer<typeof adminBookingCancelResponseSchema>;

/**
 * Reassign (§6.5) — re-dispatch, or offer to a chosen driver with an exclusive
 * window. `driverFault` decides whether the previous driver's `dispatch_attempts`
 * row lands as `unable` (feeds their completion rate) or `reassigned` (does not).
 */
export const adminBookingReassignBodySchema = z
  .object({
    mode: z.enum(['redispatch', 'offer_to_driver']),
    /** Required for `offer_to_driver`; refused for `redispatch`. */
    driverId: z.uuid().optional(),
    reason: z.string().trim().min(4).max(500),
    driverFault: z.boolean().default(false),
  })
  .refine((body) => (body.mode === 'offer_to_driver' ? Boolean(body.driverId) : !body.driverId), {
    message: 'offer_to_driver requires a driverId; redispatch never takes one',
    path: ['driverId'],
  });
export type AdminBookingReassignBody = z.infer<typeof adminBookingReassignBodySchema>;

export const adminBookingReassignResponseSchema = z.object({
  bookingId: z.uuid(),
  status: jobStatusSchema,
  mode: z.enum(['redispatch', 'offer_to_driver']),
  attemptOutcome: z.enum(['unable', 'reassigned']),
  /** The driver the booking moved away from — excluded from the next wave. */
  previousDriverId: z.uuid().nullable(),
  /** The driver the exclusive offer went to (`offer_to_driver` only). */
  offeredDriverId: z.uuid().nullable(),
});
export type AdminBookingReassignResponse = z.infer<typeof adminBookingReassignResponseSchema>;

/** The manual override — super admin only through the `booking.override` gate. */
export const adminBookingTransitionBodySchema = z.object({
  to: jobStatusSchema,
  reason: z.string().trim().min(4).max(500),
});
export type AdminBookingTransitionBody = z.infer<typeof adminBookingTransitionBodySchema>;

export const adminBookingTransitionResponseSchema = z.object({
  bookingId: z.uuid(),
  from: jobStatusSchema,
  to: jobStatusSchema,
});
export type AdminBookingTransitionResponse = z.infer<typeof adminBookingTransitionResponseSchema>;

/** §14.2's unpaid intervention — re-poll the gateway for this one booking. */
export const adminBookingRecheckResponseSchema = z.object({
  bookingId: z.uuid(),
  bookingStatus: jobStatusSchema,
  /** The booking-purpose payment's status after the recheck; null when none exists. */
  paymentStatus: paymentStatusSchema.nullable(),
  settled: z.boolean(),
});
export type AdminBookingRecheckResponse = z.infer<typeof adminBookingRecheckResponseSchema>;

/**
 * §14.2's reminder. Deduped per booking per IST day — a double-submitted
 * button sends one message; a deliberate second nudge tomorrow is allowed.
 */
export const adminBookingRemindResponseSchema = z.object({
  bookingId: z.uuid(),
  /** False when today's reminder was already sent (the dedupe replayed). */
  sent: z.boolean(),
});
export type AdminBookingRemindResponse = z.infer<typeof adminBookingRemindResponseSchema>;
