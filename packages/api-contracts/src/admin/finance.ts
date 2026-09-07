import { z } from 'zod';
import { unsignedPaiseSchema } from '../common/money';
import { pageEnvelopeSchema, pageQuerySchema } from '../common/pagination';
import { payoutApprovalStateSchema, payoutStatusSchema } from '../fleet/payouts';

/**
 * §9.4.10's Finance surface — `/v1/admin/finance/*`.
 *
 * The `finance` sub-role has existed in `AdminSubRole` since Phase 10 with
 * **zero consumers**; this is its first, and its first with any authority at
 * all (`admin-config` reads and writes settings, this moves money).
 *
 * The queue covers BOTH owner types. Fleet payouts bypassed approval entirely
 * from Phase 7 until Phase 19 — bringing them under one threshold rather than
 * leaving a second, unapproved path is the point of the rule, and it is a
 * behaviour change for existing fleets rather than a new feature.
 */

export const adminPayoutOwnerTypeSchema = z.enum(['fleet', 'driver']);
export type AdminPayoutOwnerType = z.infer<typeof adminPayoutOwnerTypeSchema>;

/**
 * A queue row carries who is owed, not just how much.
 *
 * Approving a payout on an id alone is not a decision anybody can defend —
 * Finance needs the name, the destination bank and how long it has waited, or
 * the queue is a list of UUIDs with an Approve button beside each.
 */
export const adminPayoutSchema = z.object({
  id: z.uuid(),
  ownerType: adminPayoutOwnerTypeSchema,
  ownerId: z.uuid(),
  ownerName: z.string().nullable(),
  amountPaise: unsignedPaiseSchema,
  status: payoutStatusSchema,
  approvalState: payoutApprovalStateSchema,
  requestedAt: z.iso.datetime(),
  approvedAt: z.iso.datetime().nullable(),
  rejectionReason: z.string().nullable(),
  failureReason: z.string().nullable(),
  /** Redacted destination, so a reviewer can sanity-check where it is going. */
  destinationLast4: z.string().nullable(),
  bankName: z.string().nullable(),
});
export type AdminPayoutDto = z.infer<typeof adminPayoutSchema>;

export const adminPayoutsQuerySchema = pageQuerySchema.extend({
  /** Defaults to the queue itself — the thing somebody opened this page to do. */
  state: payoutApprovalStateSchema.or(z.literal('all')).default('pending_approval'),
  ownerType: adminPayoutOwnerTypeSchema.optional(),
});
export type AdminPayoutsQuery = z.infer<typeof adminPayoutsQuerySchema>;

export const adminPayoutsListResponseSchema = pageEnvelopeSchema(adminPayoutSchema);
export type AdminPayoutsListResponse = z.infer<typeof adminPayoutsListResponseSchema>;

/**
 * Rejection requires a reason, approval does not.
 *
 * The same asymmetry `adminDocumentReviewSchema` uses for KYC, for the same
 * reason: approval is the expected outcome and needs no justification, while a
 * rejection is a thing somebody will have to explain later — to the driver
 * whose money it is, and to whoever audits `admin_actions`.
 */
export const adminPayoutRejectSchema = z.object({
  reason: z.string().trim().min(5).max(500),
});
export type AdminPayoutRejectRequest = z.infer<typeof adminPayoutRejectSchema>;

/**
 * §9.4.10's Finance config. The threshold is one number and it lives on
 * `charge_config` beside the rest of the money policy, so it changes without a
 * deploy and lands in the same audited change history as the pricing knobs.
 */
export const adminFinanceConfigSchema = z.object({
  payoutAutoApproveMaxPaise: unsignedPaiseSchema,
  /** §14 GST on the fare. Zero until an accountant says otherwise. */
  taxPct: z.number().min(0).max(28),
  taxLabel: z.string().min(1).max(24),
  /** §3.5's knobs, previously TypeScript constants. */
  cancelFreeMinutes: z.number().int().min(0),
  cancelPartialMinutes: z.number().int().min(0),
  cancelPartialFeePaise: unsignedPaiseSchema,
  cancelDriverCompPct: z.number().min(0).max(100),
});
export type AdminFinanceConfigDto = z.infer<typeof adminFinanceConfigSchema>;

export const adminFinanceConfigUpdateSchema = adminFinanceConfigSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Provide at least one field to update',
  })
  .refine(
    (value) =>
      value.cancelFreeMinutes === undefined ||
      value.cancelPartialMinutes === undefined ||
      value.cancelPartialMinutes >= value.cancelFreeMinutes,
    { message: 'The partial-fee window must not start before the free window ends' },
  );
export type AdminFinanceConfigUpdate = z.infer<typeof adminFinanceConfigUpdateSchema>;
