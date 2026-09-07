import { index, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { money, primaryId, timestamps } from './columns';
import {
  paymentMethodEnum,
  paymentStatusEnum,
  payoutStatusEnum,
  refundStatusEnum,
  walletOwnerTypeEnum,
  walletTxnTypeEnum,
} from './enums';
import { bookings } from './bookings';
import { adminUsers } from './admin';

/**
 * Money is ledger-first (§3.4): `wallets.balance` is a cached projection and
 * `wallet_transactions` is the source of truth. Every balance must be
 * reconstructible by summing its entries — that is what the ledger invariant
 * test asserts.
 */
export const wallets = pgTable(
  'wallets',
  {
    id: primaryId(),
    ownerId: uuid('owner_id').notNull(),
    ownerType: walletOwnerTypeEnum('owner_type').notNull(),
    balance: money('balance').notNull().default('0'),
    ...timestamps,
  },
  (t) => [unique('uq_wallets_owner').on(t.ownerType, t.ownerId)],
);

export const walletTransactions = pgTable(
  'wallet_transactions',
  {
    id: primaryId(),
    walletId: uuid('wallet_id')
      .notNull()
      .references(() => wallets.id, { onDelete: 'cascade' }),
    type: walletTxnTypeEnum('type').notNull(),
    // Signed: credits positive, debits negative, so SUM(amount) == balance.
    amount: money('amount').notNull(),
    reason: text('reason'),
    refId: uuid('ref_id'),
    /**
     * NOT NULL since migration 0006. Postgres unique indexes treat NULLs as
     * distinct, so a keyless leg was silently exempt from the dedup that §14.1
     * ("all money mutations carry an idempotency key") requires. Every writer
     * already set it; making it a database fact closes the hole.
     */
    idempotencyKey: text('idempotency_key').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // §17 requires this unique key — it is what makes a retried credit a no-op.
    unique('uq_wallet_transactions_idempotency_key').on(t.idempotencyKey),
    index('idx_wallet_transactions_wallet').on(t.walletId, t.createdAt),
    index('idx_wallet_transactions_ref').on(t.refId),
  ],
);

export const payments = pgTable(
  'payments',
  {
    id: primaryId(),
    bookingId: uuid('booking_id')
      .notNull()
      .references(() => bookings.id),
    /** Razorpay `pay_…`, set once the gateway confirms a capture. */
    gatewayRef: text('gateway_ref'),
    /**
     * Razorpay `order_…`. A different object with a different lifetime from
     * `gateway_ref`, and a webhook can legitimately arrive keyed on either —
     * which is why both carry their own partial unique index.
     */
    gatewayOrderRef: text('gateway_order_ref'),
    amount: money('amount').notNull(),
    /** The GST component of `amount`, mirrored from the booking. Zero today. */
    taxAmount: money('tax_amount').notNull().default('0'),
    method: paymentMethodEnum('method').notNull(),
    status: paymentStatusEnum('status').notNull().default('pending'),
    /**
     * `booking` or `cancellation_fee`. §3.5's fee is a genuinely separate
     * collection against the same booking, so it needs its own row — and
     * `uq_payments_one_captured_per_booking` is scoped to `booking` so the two
     * can coexist.
     */
    purpose: text('purpose').notNull().default('booking'),
    /** Which adapter created it — `dev` rows must be obvious in a prod dump. */
    provider: text('provider'),
    /** Populated on `failed`; rendered verbatim to the customer. */
    failureReason: text('failure_reason'),
    /**
     * NOT NULL since 0016. It was nullable under a GLOBAL unique index from
     * 0001, and Postgres treats NULLs as distinct — so a keyless payment was
     * exempt from the dedup §14.1 requires. The same hole 0006 closed on
     * `wallet_transactions`.
     */
    idempotencyKey: text('idempotency_key').notNull(),
    capturedAt: timestamp('captured_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('uq_payments_idempotency_key').on(t.idempotencyKey),
    index('idx_payments_booking').on(t.bookingId),
  ],
);

/**
 * §5.5 `payout_requested → processing (Route) → paid | failed`.
 *
 * There is deliberately **no `fleet_id`**: `owner_id` IS the fleet id when
 * `owner_type = 'fleet'` (the same polymorphic shape as `wallets` and
 * `payout_accounts`), a `fleet_id` column would be NULL for every Phase 19
 * driver row and need a CHECK to stay consistent with `owner_id`, and
 * `idx_payouts_owner` already serves the tenant-scoped history.
 *
 * The money is debited from the wallet at REQUEST time, not at `paid` — see
 * `PayoutsService`. In a signed append-only ledger a hold *is* a debit; a
 * failure writes a compensating `adjustment` credit rather than removing it,
 * per §14.5's "compensating ledger entries (never edits)".
 */
export const payouts = pgTable(
  'payouts',
  {
    id: primaryId(),
    ownerId: uuid('owner_id').notNull(),
    ownerType: walletOwnerTypeEnum('owner_type').notNull(),
    amount: money('amount').notNull(),
    /** Provider payout reference (Razorpay `pout_…`) once accepted. */
    routeRef: text('route_ref'),
    status: payoutStatusEnum('status').notNull().default('requested'),
    idempotencyKey: text('idempotency_key'),
    /** Populated on `failed`; rendered verbatim in the row and the alert. */
    failureReason: text('failure_reason'),
    /** Which adapter created it — `dev` rows must be obvious in a prod dump. */
    provider: text('provider'),
    /** Last time the reconciliation poll asked the provider for the truth. */
    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
    /**
     * §14.4's Finance gate, and deliberately NOT a `payout_status` value.
     *
     * `payout_status` is the VENDOR lifecycle; approval decides whether the
     * vendor is called at all. Keeping them on separate axes means a payout
     * awaiting approval is still `status = 'requested'` and is therefore
     * already inside `uq_payouts_one_open_per_owner`'s predicate — so an owner
     * cannot queue five while Finance sleeps, with no change to that index.
     *
     * `auto_approved` is the default because everything at or below
     * `charge_config.payout_auto_approve_max` skips the queue entirely.
     */
    approvalState: text('approval_state').notNull().default('auto_approved'),
    approvedBy: uuid('approved_by').references(() => adminUsers.id),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    /** Required on reject; surfaced to the owner so they know what to fix. */
    rejectionReason: text('rejection_reason'),
    requestedAt: timestamp('requested_at', { withTimezone: true }).notNull().defaultNow(),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('uq_payouts_idempotency_key').on(t.idempotencyKey),
    index('idx_payouts_owner').on(t.ownerType, t.ownerId, t.requestedAt),
  ],
);

/**
 * §14.5. Phase 19 gave this table its first writer (`RefundsService`) and, with
 * it, the `idempotency_key` the previous docstring deferred to "whichever phase
 * ships refunds". The grammar it invented is `rf:v1:<bookingId>:<reason>` —
 * booking-scoped because there is at most one refund per booking per reason,
 * while the LEDGER leg keys are refund-scoped (`rf:v1:<refundId>:driver`)
 * because one booking can carry a cancellation refund and later a dispute one.
 *
 * A reversal is always a NEW leg with the opposite sign, never an edit — §14.5's
 * "compensating ledger entries (never edits)", which `sole-writer.spec.ts`
 * enforces mechanically.
 */
export const refunds = pgTable(
  'refunds',
  {
    id: primaryId(),
    bookingId: uuid('booking_id')
      .notNull()
      .references(() => bookings.id),
    amount: money('amount').notNull(),
    reason: text('reason'),
    gatewayRef: text('gateway_ref'),
    status: refundStatusEnum('status').notNull().default('pending'),
    idempotencyKey: text('idempotency_key').notNull(),
    /** `system` for the §3.5 cancellation path, an admin id for a dispute. */
    initiatedBy: text('initiated_by').notNull().default('system'),
    failureReason: text('failure_reason'),
    processedAt: timestamp('processed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('uq_refunds_idempotency_key').on(t.idempotencyKey),
    index('idx_refunds_booking').on(t.bookingId),
  ],
);
