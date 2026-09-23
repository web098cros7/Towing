import { z } from 'zod';
import { unsignedPaiseSchema } from '../common/money';
import { pageEnvelopeSchema, pageQuerySchema } from '../common/pagination';
import { jobStatusSchema } from '../fleet/jobs';

/**
 * W8's dispute lifecycle — `/v1/admin/disputes/*` and
 * `POST /v1/admin/bookings/:id/dispute` (§9.4.7, §5.6, §12.2).
 *
 * This file is the source of truth for migration 0025's CHECK constraints —
 * `migration-0025.spec.ts` pins every SQL literal list to the unions below,
 * the house rule wherever a CHECK duplicates a TypeScript union.
 *
 * The **five exits** are the whole design: every dispute must be leavable, and
 * the exit decides where the booking lands and what money moves. The resolver
 * enforces exactly this table, no more:
 *
 * | Opened from        | Resolution           | Booking ends at | Money                                      |
 * | ------------------ | -------------------- | --------------- | ------------------------------------------ |
 * | in_progress/completed | complete_and_charge | completed    | normal capture (settlement from completed) |
 * | in_progress/completed | cancel_no_charge    | cancelled    | no capture; optional platform-funded comp  |
 * | paid               | uphold_charge        | paid        | nothing — A9's settlement check guards it  |
 * | paid               | full_refund          | cancelled   | the existing full reversal                 |
 * | paid               | partial_refund       | paid        | gateway refund of X + compensating legs    |
 */

/** The eight reason codes from the guide, pinned to the DB CHECK. */
export const DISPUTE_REASON_CODES = [
  'service_not_completed',
  'vehicle_damage',
  'overcharge',
  'driver_conduct',
  'customer_conduct',
  'payment_issue',
  'unable_to_deliver',
  'other',
] as const;
export const disputeReasonCodeSchema = z.enum(DISPUTE_REASON_CODES);
export type DisputeReasonCode = z.infer<typeof disputeReasonCodeSchema>;

export const DISPUTE_STATUSES = ['open', 'under_review', 'resolved'] as const;
export const disputeStatusSchema = z.enum(DISPUTE_STATUSES);
export type DisputeStatus = z.infer<typeof disputeStatusSchema>;

/** The five exits, exactly as tabulated above. */
export const DISPUTE_RESOLUTIONS = [
  'complete_and_charge',
  'cancel_no_charge',
  'uphold_charge',
  'full_refund',
  'partial_refund',
] as const;
export const disputeResolutionSchema = z.enum(DISPUTE_RESOLUTIONS);
export type DisputeResolution = z.infer<typeof disputeResolutionSchema>;

/**
 * Who bore a partial refund's money, AS STORED on `refunds.liability` and
 * `disputes.liability`.
 *
 * `shared`, `platform` and `provider` are what ADM-6 (23 Sep) writes: see
 * `REFUND_BEARERS`. `driver` and `fleet` are the pre-ADM-6 values, when an
 * admin picked one party by hand. They are still READ, because refunds already
 * issued carry them and history is not rewritten, but nothing accepts them as
 * input any more.
 */
export const DISPUTE_LIABILITIES = ['shared', 'platform', 'provider', 'driver', 'fleet'] as const;
export const disputeLiabilitySchema = z.enum(DISPUTE_LIABILITIES);
export type DisputeLiability = z.infer<typeof disputeLiabilitySchema>;

/**
 * ADM-6 (Ehsan, 23 Sep): WHY a partial refund is being given. The cause
 * decides who pays, the way Uber, Ola and Rapido decide it, so the admin
 * states a fact about the trip rather than picking whom to charge.
 *
 * - `fare_error`: the fare itself was wrong because of the job (a longer
 *   route, a padded wait, a wrong toll). Like a fare recalculation, both sides
 *   give back their share.
 * - `platform_error`: MiTow got it wrong (bad estimate, app or pricing bug).
 * - `goodwill`: the customer is unhappy and nobody clearly did anything wrong.
 *   MiTow's cost of keeping a customer, never the driver's.
 * - `driver_misconduct`: rude, unsafe, or the job was not done properly.
 *
 * Damage to the customer's vehicle is deliberately NOT a cause: that is an
 * insurance or liability claim, not a fare refund, and it does not belong in
 * this flow.
 */
export const REFUND_CAUSES = [
  'fare_error',
  'platform_error',
  'goodwill',
  'driver_misconduct',
] as const;
export const refundCauseSchema = z.enum(REFUND_CAUSES);
export type RefundCause = z.infer<typeof refundCauseSchema>;

/**
 * Who bears a partial refund.
 *
 * - `shared`: in proportion to what each side received from the customer's
 *   payment. The driver/fleet give back their share, MiTow gives back its
 *   commission. The fare-recalculation rule.
 * - `platform`: MiTow bears all of it; the driver keeps every rupee.
 * - `provider`: the driver's side bears all of it (the driver, or their fleet
 *   and the driver in the proportion the trip paid them). NEVER more than they
 *   were credited for the trip: a driver cannot pay back more than they earned.
 *
 * There is no way to name "fleet" by hand: the engine reads who was actually
 * paid for the trip, so a fleet that does not exist cannot be charged.
 */
export const REFUND_BEARERS = ['shared', 'platform', 'provider'] as const;
export const refundBearerSchema = z.enum(REFUND_BEARERS);
export type RefundBearer = z.infer<typeof refundBearerSchema>;

/** Who pays when the admin does not override. */
export const DEFAULT_BEARER_BY_CAUSE = {
  fare_error: 'shared',
  platform_error: 'platform',
  goodwill: 'platform',
  driver_misconduct: 'provider',
} as const satisfies Record<RefundCause, RefundBearer>;

/**
 * Where the refunded money goes.
 *
 * `original`: back the way it came (the card or UPI refund, plus any wallet
 * part back to the wallet). `wallet`: all of it as MiTow wallet credit, which
 * is instant, costs no gateway fee, and stays spendable on the next booking.
 * A cash trip refunds to the wallet whichever is chosen, because the driver
 * already holds the notes.
 */
export const REFUND_DELIVERIES = ['original', 'wallet'] as const;
export const refundDeliverySchema = z.enum(REFUND_DELIVERIES);
export type RefundDelivery = z.infer<typeof refundDeliverySchema>;

/**
 * The terms of a partial refund, shared by Finance's refund and a dispute's
 * `partial_refund` resolution.
 *
 * `bearer` is an OVERRIDE and costs a written reason: the cause's default is
 * the policy, and departing from it is exactly the decision a later reader of
 * the audit trail needs explained. Sending the default as `bearer` is not an
 * override and needs no reason.
 */
export const partialRefundTermsSchema = z
  .object({
    cause: refundCauseSchema,
    bearer: refundBearerSchema.optional(),
    overrideReason: z.string().trim().min(10).max(500).optional(),
    delivery: refundDeliverySchema.default('original'),
  })
  .superRefine((terms, ctx) => {
    const overriding =
      terms.bearer !== undefined && terms.bearer !== DEFAULT_BEARER_BY_CAUSE[terms.cause];
    if (overriding && !terms.overrideReason) {
      ctx.addIssue({
        code: 'custom',
        path: ['overrideReason'],
        message: 'Changing who pays from the default for this cause needs a written reason',
      });
    }
    if (!overriding && terms.overrideReason) {
      ctx.addIssue({
        code: 'custom',
        path: ['overrideReason'],
        message: 'An override reason is only for changing who pays',
      });
    }
  });
export type PartialRefundTerms = z.infer<typeof partialRefundTermsSchema>;
export type PartialRefundTermsInput = z.input<typeof partialRefundTermsSchema>;

/** Resolve the bearer the terms actually mean: the override, or the cause's default. */
export function bearerFor(terms: Pick<PartialRefundTerms, 'cause' | 'bearer'>): RefundBearer {
  return terms.bearer ?? DEFAULT_BEARER_BY_CAUSE[terms.cause];
}

/**
 * Who opened it. Only `admin` is wired today (the console route); the app-side
 * openers arrive with the customer/driver dispute entry points, and the column
 * is polymorphic so they will not need a migration.
 */
export const DISPUTE_OPENED_BY_TYPES = ['admin', 'customer', 'driver'] as const;
export const disputeOpenedByTypeSchema = z.enum(DISPUTE_OPENED_BY_TYPES);
export type DisputeOpenedByType = z.infer<typeof disputeOpenedByTypeSchema>;

/**
 * The three statuses a dispute can open FROM — the exit table's origins, and
 * the CHECK on `opened_from_status`. Pinned rather than derived from
 * `jobStatusSchema` on purpose: a dispute opened from `assigned` has no
 * defined exit, so the database refuses it instead of the resolver guessing.
 */
export const DISPUTE_OPENED_FROM_STATUSES = ['in_progress', 'completed', 'paid'] as const;

/** Evidence uploads ride the same presign→confirm shape as KYC documents. */
export const DISPUTE_EVIDENCE_KINDS = ['photo', 'document'] as const;
export const disputeEvidenceKindSchema = z.enum(DISPUTE_EVIDENCE_KINDS);
export type DisputeEvidenceKind = z.infer<typeof disputeEvidenceKindSchema>;

// ---------------------------------------------------------------------------
// Open
// ---------------------------------------------------------------------------

/**
 * `POST /v1/admin/bookings/:id/dispute` — the only thing that can reach
 * `DISPUTED`. A description is required: the queue's first reader has to know
 * what the dispute is about without opening the audit trail.
 */
export const adminDisputeOpenBodySchema = z.object({
  reasonCode: disputeReasonCodeSchema,
  description: z.string().trim().min(4).max(2000),
});
export type AdminDisputeOpenBody = z.infer<typeof adminDisputeOpenBodySchema>;

export const adminDisputeOpenResponseSchema = z.object({
  disputeId: z.uuid(),
  bookingId: z.uuid(),
  status: disputeStatusSchema,
  /** Where the booking was when the dispute opened — pinned by the resolver. */
  openedFromStatus: jobStatusSchema,
});
export type AdminDisputeOpenResponse = z.infer<typeof adminDisputeOpenResponseSchema>;

// ---------------------------------------------------------------------------
// Queue + detail
// ---------------------------------------------------------------------------

/**
 * The booking context a queue row shows. Deliberately small — the queue is
 * for picking what to work on next, the detail for deciding it.
 */
export const adminDisputeBookingSchema = z.object({
  id: z.uuid(),
  code: z.string(),
  status: jobStatusSchema,
  totalPaise: unsignedPaiseSchema,
  customerName: z.string().nullable(),
  driverName: z.string().nullable(),
  createdAt: z.iso.datetime(),
});
export type AdminDisputeBooking = z.infer<typeof adminDisputeBookingSchema>;

export const adminDisputeSchema = z.object({
  id: z.uuid(),
  bookingId: z.uuid(),
  status: disputeStatusSchema,
  reasonCode: disputeReasonCodeSchema,
  description: z.string(),
  openedByType: disputeOpenedByTypeSchema,
  openedById: z.uuid().nullable(),
  openedFromStatus: jobStatusSchema,
  assignedAdminId: z.uuid().nullable(),
  assignedAdminName: z.string().nullable(),
  resolution: disputeResolutionSchema.nullable(),
  liability: disputeLiabilitySchema.nullable(),
  refundId: z.uuid().nullable(),
  refundAmountPaise: unsignedPaiseSchema.nullable(),
  resolutionNote: z.string().nullable(),
  resolvedBy: z.uuid().nullable(),
  resolvedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  booking: adminDisputeBookingSchema,
});
export type AdminDispute = z.infer<typeof adminDisputeSchema>;

export const adminDisputesQuerySchema = pageQuerySchema.extend({
  status: disputeStatusSchema.optional(),
  /** "Assigned to me" — the caller's own admin id comes from the web session. */
  assignedAdminId: z.uuid().optional(),
  reasonCode: disputeReasonCodeSchema.optional(),
});
export type AdminDisputesQuery = z.infer<typeof adminDisputesQuerySchema>;

export const adminDisputesResponseSchema = pageEnvelopeSchema(adminDisputeSchema);
export type AdminDisputesResponse = z.infer<typeof adminDisputesResponseSchema>;

// ---------------------------------------------------------------------------
// Evidence
// ---------------------------------------------------------------------------

export const adminDisputeEvidenceSchema = z.object({
  id: z.uuid(),
  kind: disputeEvidenceKindSchema,
  note: z.string().nullable(),
  uploadedByType: disputeOpenedByTypeSchema,
  uploadedById: z.uuid().nullable(),
  createdAt: z.iso.datetime(),
  /** Short-TTL presigned GET — re-fetch the detail once it expires. The raw key is never returned. */
  url: z.url(),
});
export type AdminDisputeEvidence = z.infer<typeof adminDisputeEvidenceSchema>;

/**
 * `POST /v1/admin/disputes/:id/evidence/presign` — mint a slot, upload bytes
 * to it, then confirm with `.../evidence`.
 */
export const adminDisputeEvidencePresignResponseSchema = z.object({
  uploadUrl: z.url(),
  key: z.string(),
  expiresAt: z.iso.datetime(),
});
export type AdminDisputeEvidencePresignResponse = z.infer<
  typeof adminDisputeEvidencePresignResponseSchema
>;

export const adminDisputeEvidenceConfirmBodySchema = z.object({
  key: z.string().min(1),
  kind: disputeEvidenceKindSchema,
  note: z.string().trim().max(500).optional(),
});
export type AdminDisputeEvidenceConfirmBody = z.infer<typeof adminDisputeEvidenceConfirmBodySchema>;

export const adminDisputeDetailSchema = adminDisputeSchema.extend({
  evidence: z.array(adminDisputeEvidenceSchema),
});
export type AdminDisputeDetail = z.infer<typeof adminDisputeDetailSchema>;

// ---------------------------------------------------------------------------
// Workflow: assign, note, resolve
// ---------------------------------------------------------------------------

/** `POST /:id/assign` — no body means "assign to me". */
export const adminDisputeAssignBodySchema = z.object({
  adminId: z.uuid().optional(),
});
export type AdminDisputeAssignBody = z.infer<typeof adminDisputeAssignBodySchema>;

/** `POST /:id/note` — lands in `admin_notes` (subject `dispute`) and the audit trail. */
export const adminDisputeNoteBodySchema = z.object({
  note: z.string().trim().min(2).max(2000),
});
export type AdminDisputeNoteBody = z.infer<typeof adminDisputeNoteBodySchema>;

/**
 * `POST /:id/resolve` — one shape, five exits.
 *
 * `partial_refund` requires the amount and its `terms` (ADM-6: the cause, and
 * optionally an overridden bearer and the delivery); `full_refund` refuses an
 * amount (the payment's full captured value is the amount);
 * `cancel_no_charge` may ask for platform-funded driver compensation. The
 * rest takes only the note.
 */
export const adminDisputeResolveBodySchema = z
  .object({
    resolution: disputeResolutionSchema,
    note: z.string().trim().min(4).max(2000),
    refundAmountPaise: unsignedPaiseSchema.optional(),
    terms: partialRefundTermsSchema.optional(),
    /** `cancel_no_charge` only: post a platform-funded driver compensation leg. */
    compensateDriver: z.boolean().optional(),
  })
  .superRefine((body, ctx) => {
    if (body.resolution === 'partial_refund') {
      if (body.refundAmountPaise === undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['refundAmountPaise'],
          message: 'A partial refund needs its amount',
        });
      }
      if (body.terms === undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['terms'],
          message: 'A partial refund needs its cause (terms)',
        });
      }
    } else {
      if (body.refundAmountPaise !== undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['refundAmountPaise'],
          message: 'Only a partial refund takes an amount',
        });
      }
      if (body.terms !== undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['terms'],
          message: 'Only a partial refund takes terms',
        });
      }
    }
    if (body.compensateDriver !== undefined && body.resolution !== 'cancel_no_charge') {
      ctx.addIssue({
        code: 'custom',
        path: ['compensateDriver'],
        message: 'Driver compensation only applies to cancel_no_charge',
      });
    }
  });
export type AdminDisputeResolveBody = z.infer<typeof adminDisputeResolveBodySchema>;

export const adminDisputeResolveResponseSchema = z.object({
  disputeId: z.uuid(),
  status: disputeStatusSchema,
  resolution: disputeResolutionSchema,
  bookingStatus: jobStatusSchema,
  refundId: z.uuid().nullable(),
  refundAmountPaise: unsignedPaiseSchema.nullable(),
});
export type AdminDisputeResolveResponse = z.infer<typeof adminDisputeResolveResponseSchema>;
