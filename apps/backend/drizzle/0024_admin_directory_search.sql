--
-- ===========================================================================
-- W6 — the admin directory: search, suspension, impersonation groundwork.
--
-- Five groups, in order:
--   1 · pg_trgm + GIN indexes — partial-name search for the directory lists;
--   2 · bookings list indexes — the admin feed's three access paths;
--   3 · suspension metadata on users / drivers / fleets (`suspended_at`,
--       `suspended_by`, `suspension_reason`) — drivers' operational suspension
--       lives on kyc_status plus the A14 shelf (0017); these columns record
--       WHO decided and WHY, on every subject, uniformly;
--   4 · suspension_requests — support may REQUEST a suspension, not perform
--       one (§4.2). The partial unique index makes "one open request per
--       subject" a database fact, not a service convention;
--   5 · driver_zone_restrictions (excludes from dispatch in those zones,
--       does not hide), driver_document_versions (written by W7; created here
--       so W7 does not have to coordinate a migration with its upload path),
--       and impersonation_sessions (G8: server-rendered reads only, 30 min,
--       fully audited — no token is ever minted for a subject).
--
-- Hand-written, like every migration from 0002 onward. Journal idx 24.
--
-- ⚠ Do NOT re-add `drivers.pending_suspension_*` — migration 0017 owns them
-- (its own header says so, and `migration-0024.spec.ts` asserts this file does
-- not touch them).
-- ===========================================================================
--

-- ---------------------------------------------------------------------------
-- 1 · Trigram search — names are fuzzy, mobiles are exact, ids are prefixes
-- ---------------------------------------------------------------------------

CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint

-- `name` is nullable on users and drivers; NULL rows simply never match a
-- trigram probe, which is the truthful behaviour for an unnamed account.
CREATE INDEX "idx_users_name_trgm" ON "users" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "idx_users_mobile_trgm" ON "users" USING gin ("mobile" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "idx_drivers_name_trgm" ON "drivers" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "idx_drivers_mobile_trgm" ON "drivers" USING gin ("mobile" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "idx_fleets_business_name_trgm" ON "fleets" USING gin ("business_name" gin_trgm_ops);--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 2 · Bookings list indexes — the admin feed's three access paths
-- ---------------------------------------------------------------------------

CREATE INDEX "idx_bookings_created_at" ON "bookings" ("created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_bookings_zone_created" ON "bookings" ("zone_id","created_at" DESC NULLS LAST);--> statement-breakpoint
-- Partial: only paid bookings ever sort by `paid_at`, and the predicate keeps
-- the index to the rows the finance views actually read.
CREATE INDEX "idx_bookings_paid_at" ON "bookings" ("paid_at" DESC NULLS LAST) WHERE "status" = 'paid';--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 3 · Suspension metadata on all three subjects
-- ---------------------------------------------------------------------------

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "suspended_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "suspended_by" uuid REFERENCES "admin_users"("id");--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "suspension_reason" text;--> statement-breakpoint

ALTER TABLE "drivers" ADD COLUMN IF NOT EXISTS "suspended_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "drivers" ADD COLUMN IF NOT EXISTS "suspended_by" uuid REFERENCES "admin_users"("id");--> statement-breakpoint
ALTER TABLE "drivers" ADD COLUMN IF NOT EXISTS "suspension_reason" text;--> statement-breakpoint

ALTER TABLE "fleets" ADD COLUMN IF NOT EXISTS "suspended_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "fleets" ADD COLUMN IF NOT EXISTS "suspended_by" uuid REFERENCES "admin_users"("id");--> statement-breakpoint
ALTER TABLE "fleets" ADD COLUMN IF NOT EXISTS "suspension_reason" text;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 4 · suspension_requests — support requests, ops performs (§4.2 / G6)
-- ---------------------------------------------------------------------------

CREATE TABLE "suspension_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" uuid NOT NULL,
	"requested_by" uuid NOT NULL REFERENCES "admin_users"("id"),
	"reason" text NOT NULL,
	"status" text NOT NULL DEFAULT 'open',
	"decided_by" uuid REFERENCES "admin_users"("id"),
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_suspension_requests_subject_type" CHECK ("subject_type" IN ('user', 'driver', 'fleet')),
	CONSTRAINT "ck_suspension_requests_status" CHECK ("status" IN ('open', 'approved', 'rejected'))
);
--> statement-breakpoint

-- One OPEN request per subject. This is the database half of "support may
-- request, not perform": a second attempt while one is pending is a conflict
-- the service can surface, not a duplicate an approver has to notice.
CREATE UNIQUE INDEX "uq_suspension_requests_open_subject"
  ON "suspension_requests" ("subject_type","subject_id") WHERE "status" = 'open';--> statement-breakpoint
CREATE INDEX "idx_suspension_requests_status_created"
  ON "suspension_requests" ("status","created_at" DESC NULLS LAST);--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 5 · Zone restrictions, document versions, impersonation sessions
-- ---------------------------------------------------------------------------

-- §6.10: a restricted driver is EXCLUDED from dispatch in those zones, not
-- hidden from the map — the W4 live view keeps drawing them so an operator can
-- see why supply disappeared.
CREATE TABLE "driver_zone_restrictions" (
	"driver_id" uuid NOT NULL REFERENCES "drivers"("id") ON DELETE cascade,
	"zone_id" uuid NOT NULL REFERENCES "service_zones"("id") ON DELETE cascade,
	"created_by" uuid REFERENCES "admin_users"("id"),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	PRIMARY KEY ("driver_id","zone_id")
);
--> statement-breakpoint

-- W7's upload/review path writes one row per document VERSION; created here
-- because the migration batch is the expensive part, and a resubmission that
-- overwrites `driver_documents` orphans the old object (W19 needs the history).
CREATE TABLE "driver_document_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"driver_id" uuid NOT NULL REFERENCES "drivers"("id") ON DELETE cascade,
	"doc_type" text NOT NULL,
	"file_url" text NOT NULL,
	"status" text NOT NULL,
	"rejection_reason" text,
	"verified_by" uuid REFERENCES "admin_users"("id"),
	"verified_at" timestamp with time zone,
	"superseded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

CREATE INDEX "idx_driver_document_versions_driver"
  ON "driver_document_versions" ("driver_id","created_at" DESC NULLS LAST);--> statement-breakpoint

-- G8: read-only impersonation, server-rendered, audited, 30 minutes. NO token
-- is minted for the subject — the session row is a bookmark for admin GET
-- reads, which is why no write route can "accept an impersonation session":
-- there is nothing to accept.
CREATE TABLE "impersonation_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"admin_id" uuid NOT NULL REFERENCES "admin_users"("id"),
	"subject_type" text NOT NULL,
	"subject_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone
);
--> statement-breakpoint

CREATE INDEX "idx_impersonation_sessions_subject"
  ON "impersonation_sessions" ("subject_type","subject_id","started_at" DESC NULLS LAST);--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 6 · Backfills — none required
-- ---------------------------------------------------------------------------
-- Existing rows have no suspension metadata (never suspended, or suspended
-- before W6 under a different representation); driver document history starts
-- at the deploy that writes its first version. Both are honest states.
