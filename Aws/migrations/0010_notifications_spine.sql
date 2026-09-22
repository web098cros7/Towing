CREATE TABLE "notification_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"recipient_key" text NOT NULL,
	"channel" text NOT NULL,
	"device_id" uuid,
	"destination" text,
	"status" text DEFAULT 'queued' NOT NULL,
	"skip_reason" text,
	"vendor" text,
	"vendor_ref" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event" text NOT NULL,
	"payload" jsonb NOT NULL,
	"dedupe_key" text,
	"fanned_out_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subject_id" uuid NOT NULL,
	"subject_type" text NOT NULL,
	"event_id" uuid NOT NULL,
	"event" text NOT NULL,
	"category" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "notification_prefs" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "drivers" ADD COLUMN "notification_prefs" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "installation_id" text NOT NULL;--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "revoked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "revoked_reason" text;--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_event_id_notification_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."notification_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_event_id_notification_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."notification_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_notification_deliveries_event" ON "notification_deliveries" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "idx_notification_deliveries_status" ON "notification_deliveries" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "idx_notification_events_created" ON "notification_events" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_notifications_subject" ON "notifications" USING btree ("subject_type","subject_id","created_at" DESC NULLS LAST);--> statement-breakpoint
--
-- ===========================================================================
-- Hand-written from here down: drizzle-kit emits neither CHECK constraints nor
-- partial unique indexes (same reason 0002/0004/0005/0007/0008/0009 carry
-- theirs).
-- ===========================================================================
--

-- ---------------------------------------------------------------------------
-- `devices` — normalise the subject vocabulary, then make the table registrable
-- ---------------------------------------------------------------------------

-- `devices` shipped in 0008 as the ONLY polymorphic subject table in the repo
-- spelled 'customer'. Every other one — login_challenges (0007),
-- social_identities (0007), consent_records (0009), deletion_requests (0009) —
-- pins ('user','driver'), and wallet_owner_type is ('user','driver','fleet').
--
-- Nothing has ever written a row to this table (it was schema-only in Phase 11
-- and Phase 13 is the first writer), so normalising it here costs nothing.
-- Leaving it would have meant a translation layer between the device registry
-- and every recipient resolver — and every place that layer was forgotten would
-- have resolved to zero push targets and written `skipped/no_push_target`: a
-- code path that reviews as finished and silently never delivers.
ALTER TABLE "devices" DROP CONSTRAINT "ck_devices_subject_type";--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "ck_devices_subject_type" CHECK ("subject_type" IN ('user', 'driver'));--> statement-breakpoint

ALTER TABLE "devices" ADD CONSTRAINT "ck_devices_platform" CHECK ("platform" IS NULL OR "platform" IN ('ios', 'android'));--> statement-breakpoint

-- The registration upsert target. One row per (subject, physical install) — so
-- an Expo push-token rotation UPDATES rather than inserting a second row and
-- double-notifying the same person.
--
-- Deliberately NOT unique on `installation_id` alone: one handset can legitimately
-- hold a customer registration and a driver registration at the same time (the
-- same person books tows and drives), exactly as `users.mobile` and
-- `drivers.mobile` are independent unique keys.
CREATE UNIQUE INDEX "uq_devices_subject_installation" ON "devices" USING btree ("subject_type","subject_id","installation_id");--> statement-breakpoint

-- The shared-handset guard. A push token addresses a DEVICE, not an account, so
-- two live rows holding the same token means one person's notifications render
-- on another person's lock screen. Partial on `revoked_at IS NULL` so a revoked
-- row keeps its historical token without blocking the next owner.
CREATE UNIQUE INDEX "uq_devices_push_token" ON "devices" USING btree ("push_token") WHERE "push_token" IS NOT NULL AND "revoked_at" IS NULL;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- `notification_events`
-- ---------------------------------------------------------------------------

-- Collapse key for a double-submitted producer action. Partial so the common
-- case (no dedupe wanted) stays unconstrained.
--
-- ⚠ A dedupe key must be stable across the two calls it is meant to collapse.
-- Keying on a per-call `new Date()` dedupes nothing; keying on something
-- permanent that recurs legitimately (a document id + days-left) suppresses
-- NEXT YEAR's notification forever. The registry documents the choice per row.
CREATE UNIQUE INDEX "uq_notification_events_dedupe" ON "notification_events" USING btree ("event","dedupe_key") WHERE "dedupe_key" IS NOT NULL;--> statement-breakpoint

-- The sweep's predicate: re-enqueue anything that never fanned out.
CREATE INDEX "idx_notification_events_unfanned" ON "notification_events" USING btree ("created_at") WHERE "fanned_out_at" IS NULL;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- `notifications` (the in-app centre)
-- ---------------------------------------------------------------------------

ALTER TABLE "notifications" ADD CONSTRAINT "ck_notifications_subject_type" CHECK ("subject_type" IN ('user', 'driver', 'fleet'));--> statement-breakpoint

-- Must stay in lockstep with `notificationCategorySchema` in
-- packages/api-contracts/src/common/notifications.ts. The registry spec asserts
-- every registered trigger's category is one of these, so a divergence fails a
-- test rather than a production insert.
ALTER TABLE "notifications" ADD CONSTRAINT "ck_notifications_category" CHECK ("category" IN ('transactional', 'safety', 'job', 'money', 'promotions', 'compliance'));--> statement-breakpoint

-- Unread-count predicate. Partial: the count is the only hot read and it never
-- looks at read rows.
CREATE INDEX "idx_notifications_unread" ON "notifications" USING btree ("subject_type","subject_id") WHERE "read_at" IS NULL;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- `notification_deliveries`
-- ---------------------------------------------------------------------------

ALTER TABLE "notification_deliveries" ADD CONSTRAINT "ck_notification_deliveries_channel" CHECK ("channel" IN ('push', 'sms', 'whatsapp', 'email'));--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "ck_notification_deliveries_status" CHECK ("status" IN ('queued', 'sending', 'sent', 'failed', 'skipped'));--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "ck_notification_deliveries_skip_reason" CHECK ("skip_reason" IS NULL OR "skip_reason" IN ('no_address', 'no_push_target', 'suppressed_by_pref', 'notifications_disabled'));--> statement-breakpoint

-- A row with nothing to deliver to is exactly what `skipped` means. Without
-- this pairing, `destination NOT NULL` would make a skip row physically
-- unwritable and the fan-out would have to silently drop it instead.
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "ck_notification_deliveries_destination" CHECK ("status" = 'skipped' OR "destination" IS NOT NULL);--> statement-breakpoint

-- TWO indexes, not one, and both are required.
--
-- Push fans out per DEVICE — a driver with a phone and a tablet must get two
-- pushes, which is the entire reason `devices` is a table. Every other channel
-- is single-shot per recipient.
--
-- Postgres treats NULLs as DISTINCT in a plain unique index, so a single
-- four-column index would let sms/whatsapp/email (device_id NULL) duplicate
-- freely. Splitting on `device_id IS NULL` is what makes both halves true.
CREATE UNIQUE INDEX "uq_notification_deliveries_push" ON "notification_deliveries" USING btree ("event_id","recipient_key","channel","device_id") WHERE "device_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_notification_deliveries_single" ON "notification_deliveries" USING btree ("event_id","recipient_key","channel") WHERE "device_id" IS NULL;--> statement-breakpoint

-- The sweep's second predicate: deliveries that were written but never picked
-- up, because the process died between the INSERT and the enqueue.
CREATE INDEX "idx_notification_deliveries_stranded" ON "notification_deliveries" USING btree ("created_at") WHERE "status" = 'queued';
