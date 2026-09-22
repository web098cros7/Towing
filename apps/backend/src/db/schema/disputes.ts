import { sql } from 'drizzle-orm';
import { index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { money, primaryId, timestamps } from './columns';
import { adminUsers } from './admin';
import { bookings } from './bookings';
import { refunds } from './money';

/**
 * W8 — disputes and their evidence (migration 0025).
 *
 * The `disputed` booking status has existed since 0001 and nothing could reach
 * or leave it; this table is the operator's handle on it. One OPEN dispute per
 * booking is a database fact (the partial unique index), and the five exits in
 * `packages/api-contracts/src/admin/disputes.ts` are the complete set of ways
 * out — the resolver enforces exactly those.
 *
 * `opened_by_type`/`opened_by_id` are polymorphic on purpose: only the admin
 * route writes `admin` today, and the customer/driver entry points will not
 * need a migration when they land. `opened_from_status` pins where the booking
 * was when it moved to `disputed`, because the five exits are defined per
 * origin (`in_progress`/`completed` vs `paid`) and the resolver must never have
 * to guess it from a status that has since changed.
 */
export const disputes = pgTable(
  'disputes',
  {
    id: primaryId(),
    bookingId: uuid('booking_id')
      .notNull()
      .references(() => bookings.id, { onDelete: 'cascade' }),
    openedByType: text('opened_by_type').notNull(),
    openedById: uuid('opened_by_id'),
    reasonCode: text('reason_code').notNull(),
    description: text('description').notNull(),
    status: text('status').notNull().default('open'),
    /** `in_progress` | `completed` | `paid` — pinned by a CHECK to the three the exit table covers. */
    openedFromStatus: text('opened_from_status').notNull(),
    assignedAdminId: uuid('assigned_admin_id').references(() => adminUsers.id),
    resolution: text('resolution'),
    /** Set by the money-bearing exits; `full_refund`/`partial_refund`. */
    refundId: uuid('refund_id').references(() => refunds.id),
    refundAmount: money('refund_amount'),
    /** `driver` | `fleet` | `platform` — who a PARTIAL refund's clawback lands on. */
    liability: text('liability'),
    resolutionNote: text('resolution_note'),
    resolvedBy: uuid('resolved_by').references(() => adminUsers.id),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    // One open dispute per booking — resolved history may accumulate.
    uniqueIndex('uq_disputes_open_per_booking')
      .on(t.bookingId)
      .where(sql`"status" <> 'resolved'`),
    index('idx_disputes_status_created').on(t.status, t.createdAt.desc()),
    index('idx_disputes_booking').on(t.bookingId),
  ],
);

/**
 * Evidence attached to a dispute — photos and documents, uploaded through the
 * same presign→confirm shape as KYC documents (`PresignedUploadService`).
 * `ON DELETE cascade`: evidence has no meaning without its dispute, and W19's
 * erasure walks this table with the rest.
 */
export const disputeEvidence = pgTable(
  'dispute_evidence',
  {
    id: primaryId(),
    disputeId: uuid('dispute_id')
      .notNull()
      .references(() => disputes.id, { onDelete: 'cascade' }),
    uploadedByType: text('uploaded_by_type').notNull(),
    uploadedById: uuid('uploaded_by_id'),
    kind: text('kind').notNull(),
    fileKey: text('file_key').notNull(),
    note: text('note'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('idx_dispute_evidence_dispute').on(t.disputeId, t.createdAt)],
);
