import { z } from 'zod';
import { unsignedPaiseSchema } from '../common/money';
import { pageEnvelopeSchema, pageQuerySchema } from '../common/pagination';

/**
 * `POST /v1/fleet/payouts` + `GET /v1/fleet/payouts` (§9.3.7, §14.4).
 *
 * The status vocabulary is §5.5's, verbatim: `payout_requested → processing
 * (Route) → paid | failed`. The Phase 2 mock typed the first state as
 * `pending`; that was mock-only and shipped to nobody, so the DB enum wins and
 * clients derive their type from this schema rather than hand-declaring one.
 */
export const payoutStatusSchema = z.enum(['requested', 'processing', 'paid', 'failed']);
export type PayoutStatus = z.infer<typeof payoutStatusSchema>;

/**
 * §14.4's Finance gate, on its own axis — deliberately NOT a fifth
 * `payout_status` value.
 *
 * `payout_status` above is the VENDOR lifecycle. Approval decides whether the
 * vendor is called at all, so it is a different question with a different
 * owner, and folding it in would make the reconciliation poll start asking
 * Razorpay about payouts that were never sent. Keeping them separate also means
 * a payout awaiting approval is still `requested`, and therefore still inside
 * `uq_payouts_one_open_per_owner`'s predicate — which is what stops an owner
 * queueing five while Finance sleeps, at no cost to that index.
 *
 * `auto_approved` is the common case: anything at or below
 * `charge_config.payout_auto_approve_max` skips the queue entirely.
 */
export const PAYOUT_APPROVAL_STATES = [
  'auto_approved',
  'pending_approval',
  'approved',
  'rejected',
] as const;
export const payoutApprovalStateSchema = z.enum(PAYOUT_APPROVAL_STATES);
export type PayoutApprovalState = z.infer<typeof payoutApprovalStateSchema>;

export const payoutSchema = z.object({
  id: z.uuid(),
  amountPaise: unsignedPaiseSchema,
  status: payoutStatusSchema,
  /**
   * Load-bearing in the UI, not decoration. Without it an owner above the
   * threshold watches `requested` sit there indefinitely with no explanation
   * and files a support ticket — the row has to be able to say
   * "awaiting Finance approval" and "declined: <reason>".
   */
  approvalState: payoutApprovalStateSchema,
  rejectionReason: z.string().nullable(),
  requestedAt: z.iso.datetime(),
  paidAt: z.iso.datetime().nullable(),
  /** Provider reference (Razorpay Route payout id) once accepted, else null. */
  providerRef: z.string().nullable(),
  /** Populated only for `failed` — rendered verbatim in the alert and the row. */
  failureReason: z.string().nullable(),
});
export type PayoutDto = z.infer<typeof payoutSchema>;

/**
 * The body carries only the amount. The idempotency key travels in the
 * `Idempotency-Key` header — the one the interceptor already keys on and the
 * BFF already forwards. A body field would be a *second* key that can disagree
 * with the header, and then which one wins is a coin flip.
 */
export const payoutRequestSchema = z.object({
  amountPaise: unsignedPaiseSchema.min(1),
});
export type PayoutRequest = z.infer<typeof payoutRequestSchema>;

export const payoutsQuerySchema = pageQuerySchema.extend({
  status: payoutStatusSchema.optional(),
});
export type PayoutsQuery = z.infer<typeof payoutsQuerySchema>;

export const payoutsListResponseSchema = pageEnvelopeSchema(payoutSchema);
export type PayoutsListResponse = z.infer<typeof payoutsListResponseSchema>;
