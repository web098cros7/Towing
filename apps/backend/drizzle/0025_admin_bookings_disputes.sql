--
-- ===========================================================================
-- W8 — bookings, interventions and disputes: the money-handle tables.
--
-- Four groups, in order:
--   1 · disputes — the operator's handle on the `disputed` status that has
--       existed since 0001 and that nothing could reach or leave. One OPEN
--       dispute per booking is a database fact (partial unique). The five
--       exits are defined per ORIGIN, which is why `opened_from_status` is
--       written at open time and pinned by a CHECK to the three origins the
--       exit table covers (`in_progress` / `completed` / `paid`);
--   2 · dispute_evidence — presigned-upload rows (photos/documents), cascade
--       with their dispute;
--   3 · payments.refunded_amount — an amount-aware refund record, so a
--       PARTIALLY refunded payment stays `captured` and its booking stays
--       `paid` without drift (`ledgerDrift` sums only credits,
--       `reversalDrift` only bounds them);
--   4 · refunds.dispute_id + refunds.kind — which dispute ordered the money,
--       and whether the reversal was full (booking leaves `paid`) or partial
--       (booking stays `paid`).
--
-- Hand-written, like every migration from 0002 onward. Journal idx 25.
-- The CHECK literal lists are pinned to the exported contract unions by
-- `migration-0025.spec.ts` — the house rule wherever a CHECK duplicates a
-- TypeScript union.
--
-- Backfills — none required: existing `refunds` rows take `kind = 'full'`
-- (their only shape today) and `payments.refunded_amount` defaults to 0.
-- ===========================================================================
--

-- ---------------------------------------------------------------------------
-- 1 · disputes
-- ---------------------------------------------------------------------------

CREATE TABLE "disputes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" uuid NOT NULL REFERENCES "bookings"("id") ON DELETE cascade,
	"opened_by_type" text NOT NULL,
	"opened_by_id" uuid,
	"reason_code" text NOT NULL,
	"description" text NOT NULL,
	"status" text NOT NULL DEFAULT 'open',
	"opened_from_status" text NOT NULL,
	"assigned_admin_id" uuid REFERENCES "admin_users"("id"),
	"resolution" text,
	"refund_id" uuid REFERENCES "refunds"("id"),
	"refund_amount" numeric(12, 2),
	"liability" text,
	"resolution_note" text,
	"resolved_by" uuid REFERENCES "admin_users"("id"),
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_disputes_opened_by_type" CHECK ("opened_by_type" IN ('admin', 'customer', 'driver')),
	CONSTRAINT "ck_disputes_reason_code" CHECK ("reason_code" IN ('service_not_completed', 'vehicle_damage', 'overcharge', 'driver_conduct', 'customer_conduct', 'payment_issue', 'unable_to_deliver', 'other')),
	CONSTRAINT "ck_disputes_status" CHECK ("status" IN ('open', 'under_review', 'resolved')),
	CONSTRAINT "ck_disputes_opened_from_status" CHECK ("opened_from_status" IN ('in_progress', 'completed', 'paid')),
	CONSTRAINT "ck_disputes_resolution" CHECK ("resolution" IN ('complete_and_charge', 'cancel_no_charge', 'uphold_charge', 'full_refund', 'partial_refund')),
	CONSTRAINT "ck_disputes_liability" CHECK ("liability" IN ('driver', 'fleet', 'platform')),
	CONSTRAINT "ck_disputes_refund_amount_positive" CHECK ("refund_amount" IS NULL OR "refund_amount" > 0)
);
--> statement-breakpoint

-- One OPEN dispute per booking. A resolved one may be followed by a new one —
-- "this is still wrong after the last resolution" is a real support call, and
-- the partial predicate permits exactly that while making a double-open a
-- database conflict rather than a queue with twins.
CREATE UNIQUE INDEX "uq_disputes_open_per_booking"
  ON "disputes" ("booking_id") WHERE "status" <> 'resolved';--> statement-breakpoint
CREATE INDEX "idx_disputes_status_created"
  ON "disputes" ("status","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_disputes_booking"
  ON "disputes" ("booking_id");--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 2 · dispute_evidence
-- ---------------------------------------------------------------------------

CREATE TABLE "dispute_evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dispute_id" uuid NOT NULL REFERENCES "disputes"("id") ON DELETE cascade,
	"uploaded_by_type" text NOT NULL,
	"uploaded_by_id" uuid,
	"kind" text NOT NULL,
	"file_key" text NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_dispute_evidence_uploaded_by_type" CHECK ("uploaded_by_type" IN ('admin', 'customer', 'driver')),
	CONSTRAINT "ck_dispute_evidence_kind" CHECK ("kind" IN ('photo', 'document'))
);
--> statement-breakpoint

CREATE INDEX "idx_dispute_evidence_dispute"
  ON "dispute_evidence" ("dispute_id","created_at");--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 3 · payments.refunded_amount — the amount-aware refund record
-- ---------------------------------------------------------------------------

ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "refunded_amount" numeric(12, 2) NOT NULL DEFAULT '0';--> statement-breakpoint

-- The cap is a database fact, not a service convention: no path may refund
-- more than the payment captured, and `markRefunded` only flips `status` to
-- `refunded` at full coverage.
ALTER TABLE "payments" DROP CONSTRAINT IF EXISTS "ck_payments_refunded_within_amount";--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "ck_payments_refunded_within_amount" CHECK ("refunded_amount" >= 0 AND "refunded_amount" <= "amount");--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 4 · refunds.dispute_id + refunds.kind + refunds.payment_id
-- ---------------------------------------------------------------------------

ALTER TABLE "refunds" ADD COLUMN IF NOT EXISTS "dispute_id" uuid REFERENCES "disputes"("id");--> statement-breakpoint
ALTER TABLE "refunds" ADD COLUMN IF NOT EXISTS "kind" text NOT NULL DEFAULT 'full';--> statement-breakpoint

-- Which payment the money came off. `payments.refunded_amount` is maintained
-- from the refund rows for that payment (`status <> 'failed'`), which is what
-- makes the amount update IDEMPOTENT — a replayed refund recomputes the same
-- sum instead of adding itself twice, and W9's carry-forward ("a replay must
-- resume the remaining idempotent steps") has a table to resume from.
ALTER TABLE "refunds" ADD COLUMN IF NOT EXISTS "payment_id" uuid REFERENCES "payments"("id");--> statement-breakpoint

-- PARTIAL refunds only: who bore X. Stored on the refund (not read through
-- `dispute_id`) because a finance-issued partial has no dispute to read from,
-- and a resume must be able to re-post the clawback without asking the caller.
ALTER TABLE "refunds" ADD COLUMN IF NOT EXISTS "liability" text;--> statement-breakpoint

ALTER TABLE "refunds" DROP CONSTRAINT IF EXISTS "ck_refunds_kind";--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "ck_refunds_kind" CHECK ("kind" IN ('full', 'partial'));--> statement-breakpoint

ALTER TABLE "refunds" DROP CONSTRAINT IF EXISTS "ck_refunds_liability";--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "ck_refunds_liability" CHECK ("liability" IS NULL OR "liability" IN ('driver', 'fleet', 'platform'));--> statement-breakpoint

-- Resolution refunds are read back per dispute (the detail's money section).
CREATE INDEX "idx_refunds_dispute"
  ON "refunds" ("dispute_id") WHERE "dispute_id" IS NOT NULL;

