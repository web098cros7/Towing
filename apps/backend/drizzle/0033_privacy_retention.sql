--
-- W19: privacy, erasure and retention (§20.4 DPDP).
--
-- Three tables' worth of change, all of them things Phase 12 deliberately left
-- for the phase that actually executes erasure:
--
--   1. `deletion_requests` gains the workflow the console drives: a hold, a
--      decision, and the two instants that prove the job ran. `status` was a
--      one-value vocabulary (`requested`) since 0009 — widening it is what
--      turns the request row into a queue rowable by an operator.
--   2. `retention_policies` — the G16 retention schedule AS DATA. The sweep
--      below reads the same table the console edits, so "what does the policy
--      say" and "what does the job do" cannot drift apart.
--   3. `erasure_jobs` — one row per execution, carrying the ordered step log.
--      The alternative (log lines) would make the console's "what exactly was
--      deleted" panel a grep.
--

ALTER TABLE "deletion_requests" ADD COLUMN "hold_reason" text;--> statement-breakpoint
ALTER TABLE "deletion_requests" ADD COLUMN "decided_by" uuid REFERENCES "admin_users"("id");--> statement-breakpoint
ALTER TABLE "deletion_requests" ADD COLUMN "decided_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "deletion_requests" ADD COLUMN "executed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "deletion_requests" ADD COLUMN "anonymised_at" timestamp with time zone;--> statement-breakpoint

CREATE TABLE "retention_policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"policy_key" text NOT NULL,
	"retention_days" integer NOT NULL,
	"description" text NOT NULL,
	"updated_by" uuid REFERENCES "admin_users"("id"),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "erasure_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL REFERENCES "deletion_requests"("id"),
	"subject_type" text NOT NULL,
	"subject_id" uuid NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"steps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"error" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "uq_retention_policies_key" ON "retention_policies" USING btree ("policy_key");--> statement-breakpoint
CREATE INDEX "idx_erasure_jobs_request" ON "erasure_jobs" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "idx_erasure_jobs_subject" ON "erasure_jobs" USING btree ("subject_type","subject_id");

--
-- ===========================================================================
-- Hand-written from here down: CHECK constraints, the restated partial unique
-- index, and the G16 seed rows (drizzle-kit emits none of these).
-- ===========================================================================
--

-- The workflow vocabulary. `on_hold` is the one that matters: an erasure can
-- be legally due and operationally impossible (a live booking, an un-settled
-- payout), and a queue that can only say "old" and "done" forces operators to
-- refuse outright instead of parking it with a reason.
ALTER TABLE "deletion_requests" ADD CONSTRAINT "ck_deletion_requests_status" CHECK ("status" IN ('requested', 'on_hold', 'approved', 'executing', 'completed', 'rejected'));--> statement-breakpoint

-- Restated from 0009: "one OPEN request per subject" now spans four statuses,
-- not one. Dropping and recreating (rather than adding a second index) keeps
-- exactly one index of this name, which is what a later migration editing the
-- predicate will look for.
DROP INDEX "uq_deletion_requests_one_open_per_subject";--> statement-breakpoint
CREATE UNIQUE INDEX "uq_deletion_requests_one_open_per_subject" ON "deletion_requests" USING btree ("subject_type","subject_id") WHERE "status" IN ('requested', 'on_hold', 'approved', 'executing');--> statement-breakpoint

ALTER TABLE "erasure_jobs" ADD CONSTRAINT "ck_erasure_jobs_status" CHECK ("status" IN ('queued', 'running', 'completed', 'failed'));--> statement-breakpoint
ALTER TABLE "erasure_jobs" ADD CONSTRAINT "ck_erasure_jobs_subject_type" CHECK ("subject_type" IN ('user', 'driver'));--> statement-breakpoint

-- G16's schedule, seeded here rather than in the seed script for the same
-- reason `charge_config` ships its defaults in a migration: these are the
-- values production is legally operating under, not fixture data.
--
-- KYC documents and `admin_actions` carry 7-year rows and NO sweep touches
-- them: KYC retention is a regulatory floor (deleting earlier is the offence,
-- not keeping it), and the audit trail is the one table the erasure runner is
-- forbidden to write. Their policy rows exist so the console shows the whole
-- schedule in one place instead of a table half-populated by what happens to
-- be enforceable today.
INSERT INTO "retention_policies" ("policy_key", "retention_days", "description") VALUES
  ('kyc_documents', 2555, 'KYC documents and versions — 7 years, regulatory floor. Policy-only: no sweep deletes them.'),
  ('audit_logs', 2555, 'admin_actions — 7 years. Policy-only: the erasure runner must never touch the audit trail.'),
  ('location_paths', 180, 'booking_location_path samples — 180 days. Swept nightly.'),
  ('delivery_logs', 90, 'notification_deliveries and notification_events — 90 days. Swept nightly.'),
  ('wave_logs', 30, 'dispatch_wave_logs — 30 days, purged by the analytics rollup job (§22.2).'),
  ('webhook_events', 90, 'Raw provider webhook payloads — 90 days. Swept nightly.');
