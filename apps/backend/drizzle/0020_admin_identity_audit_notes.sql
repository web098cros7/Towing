--
-- ===========================================================================
-- W1 — foundation schema: admin identity (2FA/authz/ops-alerts), recovery
-- codes, the audit cursor index, admin notes, and the history actor.
--
-- Five groups of change, all behaviour-neutral until W1/W2 code lands:
--
--   1. `admin_users` gains the W2 identity columns. `twofa_secret` (migration
--      0007) is RESERVED-but-unread and stays untouched — W2 migrates enrolment
--      onto `twofa_secret_enc` (env-key-encrypted, never a bare secret) rather
--      than repurposing a column whose contents are undefined. `authz_version`
--      (0018) and its trigger (0019) are untouched.
--   2. `admin_recovery_codes` — single-use hashed codes (W2). Codes die with
--      the admin (CASCADE): unlike audit rows they are live auth material, and
--      a deleted admin must not leave valid codes behind.
--   3. `idx_admin_actions_created` on `(created_at DESC, id DESC)` — the audit
--      viewer's cursor. The two existing indexes are admin- and subject-scoped;
--      the unscoped feed would sort without one.
--   4. `admin_notes` (W21, hosted here so W6 detail screens can join it from
--      day one). `subject_id` is FK-free and paired with `subject_type`, the
--      same polymorphic shape as `admin_actions.subject_id` — one notes panel
--      targets drivers, bookings, disputes and everything else.
--   5. `booking_status_history.actor_id` — which admin overrode the status
--      (W8). Nullable: every existing row was written by the system or a
--      non-admin actor. No cascade: history must outlive the admin.
--
-- Hand-written, like every migration from 0002 onward: one separator line
-- between statements, journal idx 20, backfills last (none required — every
-- new column is nullable or carries a NOT NULL DEFAULT).
-- ===========================================================================
--

-- ---------------------------------------------------------------------------
-- 1 · `admin_users` identity columns
-- ---------------------------------------------------------------------------

ALTER TABLE "admin_users" ADD COLUMN IF NOT EXISTS "twofa_enabled" boolean NOT NULL DEFAULT false;--> statement-breakpoint
ALTER TABLE "admin_users" ADD COLUMN IF NOT EXISTS "twofa_secret_enc" text;--> statement-breakpoint
ALTER TABLE "admin_users" ADD COLUMN IF NOT EXISTS "twofa_confirmed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "admin_users" ADD COLUMN IF NOT EXISTS "created_by" uuid REFERENCES "admin_users"("id");--> statement-breakpoint
ALTER TABLE "admin_users" ADD COLUMN IF NOT EXISTS "deactivated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "admin_users" ADD COLUMN IF NOT EXISTS "deactivated_by" uuid REFERENCES "admin_users"("id");--> statement-breakpoint
ALTER TABLE "admin_users" ADD COLUMN IF NOT EXISTS "receives_ops_alerts" boolean NOT NULL DEFAULT false;--> statement-breakpoint
-- An enabled second factor with nowhere to verify against is a lockout, not
-- security. The DB refuses that state even if the service forgets to check.
ALTER TABLE "admin_users"
  ADD CONSTRAINT "ck_admin_users_twofa_secret" CHECK ("twofa_enabled" = false OR "twofa_secret_enc" IS NOT NULL);--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 2 · `admin_recovery_codes`
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "admin_recovery_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"admin_id" uuid NOT NULL REFERENCES "admin_users"("id") ON DELETE cascade,
	"code_hash" text NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_admin_recovery_codes_admin_hash" ON "admin_recovery_codes" ("admin_id","code_hash");--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 3 · Audit cursor index
-- ---------------------------------------------------------------------------

-- Backs `GET /v1/admin/audit`'s unscoped cursor: ORDER BY created_at DESC,
-- id DESC. `DESC NULLS LAST` spelled out — drizzle-kit emits DESC indexes as
-- NULLS LAST, so an ORDER BY that only says `desc` gets a Sort node bolted on
-- (the same reason `idx_admin_actions_admin` spells it out).
CREATE INDEX IF NOT EXISTS "idx_admin_actions_created" ON "admin_actions" USING btree ("created_at" DESC NULLS LAST,"id" DESC);--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 4 · `admin_notes`
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "admin_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" uuid NOT NULL,
	"admin_id" uuid NOT NULL REFERENCES "admin_users"("id"),
	"body" text NOT NULL,
	"pinned" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "ck_admin_notes_subject_type" CHECK ("subject_type" IN ('user','driver','fleet','booking','dispute','sos_alert','support_ticket','truck','payout','deletion_request'))
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_admin_notes_subject" ON "admin_notes" USING btree ("subject_type","subject_id","created_at" DESC NULLS LAST);--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 5 · `booking_status_history.actor_id`
-- ---------------------------------------------------------------------------

ALTER TABLE "booking_status_history" ADD COLUMN IF NOT EXISTS "actor_id" uuid REFERENCES "admin_users"("id");--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 6 · Backfills — none required
-- ---------------------------------------------------------------------------

-- Every new column is nullable or carries a NOT NULL DEFAULT, so existing rows
-- already satisfy every constraint above (including the two new CHECKs: all
-- existing admins read as `twofa_enabled = false`, and `admin_notes` is empty).
-- No UPDATE, and nothing for a backfill to repair.
