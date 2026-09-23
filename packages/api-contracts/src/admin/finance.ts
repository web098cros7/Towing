import { z } from 'zod';
import { unsignedPaiseSchema } from '../common/money';
import { pageEnvelopeSchema, pageQuerySchema } from '../common/pagination';
import { paymentPurposeSchema, paymentStatusSchema } from '../customer/payments';
import { payoutApprovalStateSchema, payoutStatusSchema } from '../fleet/payouts';
import { partialRefundTermsSchema } from './disputes';

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
  /** W9: name/email search over the payee, and the IST requested-at window. */
  q: z.string().trim().min(1).optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
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

// ---------------------------------------------------------------------------
// W8: refunds — the money the dispute exits move (W9 adds the console around it)
// ---------------------------------------------------------------------------

/**
 * Migration 0025 added `refunds.kind`: a full reversal and a partial one are
 * different operations with different ledger consequences. A full refund
 * reverses every settlement credit leg and the booking leaves `paid`; a
 * partial refund claws back the liable party's share and the booking STAYS
 * `paid` — `ledgerDrift` sums only credits and `reversalDrift` only bounds
 * them, so a partially-refunded paid booking is drift-free by construction.
 */
export const REFUND_KINDS = ['full', 'partial'] as const;
export const refundKindSchema = z.enum(REFUND_KINDS);
export type RefundKind = z.infer<typeof refundKindSchema>;

export const refundStatusSchema = z.enum(['pending', 'processed', 'failed']);
export type RefundStatus = z.infer<typeof refundStatusSchema>;

// ---------------------------------------------------------------------------
// W9 — the console reads: transactions, the ledger, refunds, invariants, SLA
// ---------------------------------------------------------------------------

/**
 * Mirrors `bookings.payment_method` / `payments.method`. Declared here rather
 * than imported from `./bookings` on purpose: `bookings.ts` already imports
 * THIS file (the refund kinds), and a second arrow back would make the pair a
 * cycle whose zod init order is a coin toss.
 */
export const financePaymentMethodSchema = z.enum(['upi', 'card', 'cash', 'wallet']);

/** Every payment that ever touched a booking, method and all. */
export const adminTransactionSchema = z.object({
  id: z.uuid(),
  bookingId: z.uuid(),
  bookingCode: z.string(),
  purpose: paymentPurposeSchema,
  status: paymentStatusSchema,
  method: financePaymentMethodSchema,
  amountPaise: unsignedPaiseSchema,
  /** The GST component, mirrored from the booking. Zero until a rate is set. */
  taxPaise: unsignedPaiseSchema,
  /** The running total of refunds against this payment (W8's recompute). */
  refundedAmountPaise: unsignedPaiseSchema,
  gatewayRef: z.string().nullable(),
  customerName: z.string().nullable(),
  failureReason: z.string().nullable(),
  capturedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
});
export type AdminTransactionDto = z.infer<typeof adminTransactionSchema>;

export const adminTransactionsQuerySchema = pageQuerySchema.extend({
  status: paymentStatusSchema.optional(),
  purpose: paymentPurposeSchema.optional(),
  /** Inclusive IST day bounds on the payment's own timestamp (capture, else creation). */
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  /** Booking code/address or the customer name — the same trigram story as bookings. */
  q: z.string().trim().min(1).optional(),
});
export type AdminTransactionsQuery = z.infer<typeof adminTransactionsQuerySchema>;

export const adminTransactionsResponseSchema = pageEnvelopeSchema(adminTransactionSchema);
export type AdminTransactionsResponse = z.infer<typeof adminTransactionsResponseSchema>;

// ── the wallet ledger feed ──────────────────────────────────────────────────

/** The DB enum, mirrored so the web can label a leg without guessing. */
export const WALLET_TXN_TYPES = [
  'fare_credit',
  'commission_debit',
  'fleet_share_credit',
  'driver_share_credit',
  'payout_debit',
  'refund_debit',
  'refund_credit',
  'adjustment',
] as const;
export const walletTxnTypeSchema = z.enum(WALLET_TXN_TYPES);
export type WalletTxnType = z.infer<typeof walletTxnTypeSchema>;

export const walletOwnerKindSchema = z.enum(['user', 'driver', 'fleet']);
export type WalletOwnerKind = z.infer<typeof walletOwnerKindSchema>;

/**
 * One append-only ledger leg.
 *
 * `amountPaise` is SIGNED — credits positive, debits negative, which is what
 * makes `SUM(amount) == wallets.balance` the walletDrift invariant. Rendering
 * it through an unsigned schema would quietly turn every debit into a credit.
 */
export const adminLedgerEntrySchema = z.object({
  id: z.uuid(),
  ownerType: walletOwnerKindSchema,
  ownerId: z.uuid(),
  ownerName: z.string().nullable(),
  type: walletTxnTypeSchema,
  amountPaise: z.int(),
  reason: z.string().nullable(),
  refId: z.uuid().nullable(),
  /** Set when `refId` names a booking — the display handle. */
  bookingCode: z.string().nullable(),
  idempotencyKey: z.string(),
  createdAt: z.iso.datetime(),
});
export type AdminLedgerEntryDto = z.infer<typeof adminLedgerEntrySchema>;

/**
 * Cursor-paginated, deliberately NOT page-numbered: the ledger is append-only,
 * so "page 3" shifts under a reading operator every time a rupee lands. The
 * cursor is opaque (server-encoded) and walks BACKWARDS in time.
 */
export const adminLedgerQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().optional(),
  ownerType: walletOwnerKindSchema.optional(),
  ownerId: z.uuid().optional(),
  type: walletTxnTypeSchema.optional(),
  refId: z.uuid().optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
});
export type AdminLedgerQuery = z.infer<typeof adminLedgerQuerySchema>;

export const adminLedgerResponseSchema = z.object({
  items: z.array(adminLedgerEntrySchema),
  /** Pass back verbatim; null means the feed is exhausted. */
  nextCursor: z.string().nullable(),
});
export type AdminLedgerResponse = z.infer<typeof adminLedgerResponseSchema>;

// ── refunds: the list and the issue action ──────────────────────────────────

export const adminRefundRowSchema = z.object({
  id: z.uuid(),
  bookingId: z.uuid(),
  bookingCode: z.string(),
  kind: refundKindSchema,
  amountPaise: unsignedPaiseSchema,
  reason: z.string().nullable(),
  status: refundStatusSchema,
  disputeId: z.uuid().nullable(),
  liability: z.string().nullable(),
  /** `system` for the §3.5 path, an admin id for a dispute or Finance. */
  initiatedBy: z.string(),
  gatewayRef: z.string().nullable(),
  processedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
});
export type AdminRefundRowDto = z.infer<typeof adminRefundRowSchema>;

export const adminRefundsQuerySchema = pageQuerySchema.extend({
  status: refundStatusSchema.optional(),
  kind: refundKindSchema.optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  q: z.string().trim().min(1).optional(),
});
export type AdminRefundsQuery = z.infer<typeof adminRefundsQuerySchema>;

export const adminRefundsResponseSchema = pageEnvelopeSchema(adminRefundRowSchema);
export type AdminRefundsResponse = z.infer<typeof adminRefundsResponseSchema>;

/**
 * `POST /v1/admin/finance/refunds` — the ONE refund request shape, full or
 * partial, and the only money write in the console that REQUIRES an
 * `Idempotency-Key` header.
 *
 * The key is required because a refund has no state guard to replay against:
 * cancel and reassign refuse a second run because the booking already moved,
 * but "refund ₹500 again" is a request the API cannot tell from a genuine
 * second refund without the caller pinning their intent. The key is hashed
 * with the issuing admin's id (`sha256(adminId:clientKey)`), so two operators
 * sending `1` do not collide.
 *
 * Omitting `amountPaise` refunds the REMAINING captured balance in full
 * (booking leaves `paid` → `cancelled`). Supplying it is a partial: the amount
 * and the party bearing it are both required, the booking STAYS `paid`, and
 * the liable party's wallet is debited by their share (capped at what the
 * settlement credited them).
 */
export const adminRefundIssueSchema = z
  .object({
    bookingId: z.uuid(),
    amountPaise: z.int().min(1).optional(),
    reason: z.string().trim().min(4).max(500),
    /** ADM-6: required with `amountPaise` (a partial), refused without it. */
    terms: partialRefundTermsSchema.optional(),
  })
  .superRefine((body, ctx) => {
    if (body.amountPaise !== undefined && body.terms === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['terms'],
        message: 'A partial refund needs its cause (terms)',
      });
    }
    if (body.amountPaise === undefined && body.terms !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['terms'],
        message: 'Only a partial refund takes terms',
      });
    }
  });
export type AdminRefundIssue = z.infer<typeof adminRefundIssueSchema>;

export const adminRefundIssueResponseSchema = z.object({
  refundId: z.uuid(),
  kind: refundKindSchema,
  amountPaise: unsignedPaiseSchema,
  status: refundStatusSchema,
  /** True when this key had already produced the refund — nothing moved twice. */
  replayed: z.boolean(),
});
export type AdminRefundIssueResponse = z.infer<typeof adminRefundIssueResponseSchema>;

// ── reconciliation, invariants, payout SLA ──────────────────────────────────

/** The reconciliation CSV covers one IST day, named explicitly. */
export const adminReconciliationQuerySchema = z.object({
  date: z.iso.date().optional(),
});
export type AdminReconciliationQuery = z.infer<typeof adminReconciliationQuerySchema>;

export const INVARIANT_KEYS = [
  'walletDrift',
  'bookingDrift',
  'ledgerDrift',
  'reversalDrift',
  'couponDrift',
] as const;
export const invariantKeySchema = z.enum(INVARIANT_KEYS);
export type InvariantKey = z.infer<typeof invariantKeySchema>;

/**
 * §14.1's five invariants, served to the console. `drift` is a COUNT of
 * offending rows — zero is the only healthy value, and these are exact by
 * construction, so a non-zero number is a bug and never rounding noise.
 */
export const adminInvariantsResponseSchema = z.object({
  checkedAt: z.iso.datetime(),
  ok: z.boolean(),
  invariants: z.array(
    z.object({
      key: invariantKeySchema,
      label: z.string(),
      drift: z.int(),
    }),
  ),
  /** The offending wallets behind a non-zero walletDrift, bounded server-side. */
  driftedWallets: z.array(
    z.object({
      walletId: z.uuid(),
      ownerType: walletOwnerKindSchema,
      ownerId: z.uuid(),
      balancePaise: z.int(),
      ledgerPaise: z.int(),
      deltaPaise: z.int(),
    }),
  ),
});
export type AdminInvariantsResponse = z.infer<typeof adminInvariantsResponseSchema>;

export const adminPayoutSlaQuerySchema = z.object({
  windowDays: z.coerce.number().int().min(1).max(365).default(30),
});
export type AdminPayoutSlaQuery = z.infer<typeof adminPayoutSlaQuerySchema>;

/**
 * §14.4's payout SLA: how long decisions (approval OR rejection) actually
 * took inside the window, at the two percentiles something is read at, plus
 * the two failure counts — decisions slower than 24 h, and the queue depth of
 * payouts that have waited longer than that without a decision at all.
 */
export const adminPayoutSlaResponseSchema = z.object({
  windowDays: z.int(),
  decided: z.int(),
  p50Minutes: z.number().nullable(),
  p95Minutes: z.number().nullable(),
  breaches24h: z.int(),
  pendingOver24h: z.int(),
  generatedAt: z.iso.datetime(),
});
export type AdminPayoutSlaResponse = z.infer<typeof adminPayoutSlaResponseSchema>;
