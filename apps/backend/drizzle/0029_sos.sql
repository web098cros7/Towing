--
-- ===========================================================================
-- W14 — SOS: the alert, its contact snapshot, and the audited timeline.
--
-- §13 asks for a 2-tap arm, an ops alert, an SMS/WhatsApp location link to the
-- subject's emergency contacts, and a full ops workflow (acknowledge → contact
-- → resolve) whose every step is reconstructable afterwards. Nothing of that
-- existed: no table, no route, no trigger. This migration is the persistence
-- half; the fan-out lives in the notification registry and the console in the
-- `sos` module.
--
-- Three groups:
--   1 · `sos_alerts` — the incident, with ONE OPEN alert per subject enforced
--       by a partial unique index. A second panic tap while an alert is live
--       is the same incident, not a parallel one;
--   2 · `sos_alert_contacts` — a SNAPSHOT of the subject's emergency contacts
--       taken inside the trigger transaction. Contacts can be edited mid-
--       incident and the notification spine re-resolves recipients at delivery
--       time; the snapshot is what makes "who was told" reconstructable;
--   3 · `sos_alert_events` — §13's full timeline and the source of the ack-time
--       KPI. `kind` and `actor_type` are CHECK-pinned to the contract unions.
--
-- Hand-written, like every migration from 0002 onward. Journal idx 29.
-- ===========================================================================
--

-- ---------------------------------------------------------------------------
-- 1 · sos_alerts — the incident
-- ---------------------------------------------------------------------------

CREATE TABLE "sos_alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" uuid NOT NULL,
	"booking_id" uuid REFERENCES "bookings"("id") ON DELETE set null,
	"lat" double precision NOT NULL,
	"lng" double precision NOT NULL,
	"accuracy_m" double precision,
	"source" text NOT NULL,
	"status" text NOT NULL DEFAULT 'triggered',
	"acknowledged_by" uuid REFERENCES "admin_users"("id"),
	"acknowledged_at" timestamp with time zone,
	"resolved_by" uuid REFERENCES "admin_users"("id"),
	"resolved_at" timestamp with time zone,
	"resolution" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_sos_alerts_subject_type" CHECK ("subject_type" IN ('user', 'driver')),
	CONSTRAINT "ck_sos_alerts_source" CHECK ("source" IN ('app', 'ops', 'sms_fallback')),
	CONSTRAINT "ck_sos_alerts_status" CHECK ("status" IN ('triggered', 'acknowledged', 'resolved', 'cancelled')),
	-- The stamp and its author travel together or not at all — a half-written
	-- acknowledgement would make the response-time KPI a guess.
	CONSTRAINT "ck_sos_alerts_ack_pair" CHECK (("acknowledged_at" IS NULL) = ("acknowledged_by" IS NULL)),
	CONSTRAINT "ck_sos_alerts_resolve_pair" CHECK (("resolved_at" IS NULL) = ("resolved_by" IS NULL))
);--> statement-breakpoint

-- One OPEN incident per subject. This is also what makes a duplicate trigger
-- race-safe: the second insert loses to the index and the service answers with
-- the alert that already exists.
CREATE UNIQUE INDEX "uq_sos_alerts_open_per_subject"
  ON "sos_alerts" ("subject_type", "subject_id")
  WHERE "status" IN ('triggered', 'acknowledged');--> statement-breakpoint

-- The queue's only read: open alerts, newest first.
CREATE INDEX "idx_sos_alerts_status_created"
  ON "sos_alerts" ("status", "created_at" DESC NULLS LAST);--> statement-breakpoint

CREATE INDEX "idx_sos_alerts_subject"
  ON "sos_alerts" ("subject_type", "subject_id", "created_at" DESC NULLS LAST);--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 2 · sos_alert_contacts — the snapshot taken at trigger time
-- ---------------------------------------------------------------------------

CREATE TABLE "sos_alert_contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"alert_id" uuid NOT NULL REFERENCES "sos_alerts"("id") ON DELETE cascade,
	"name" text NOT NULL,
	"phone" text NOT NULL,
	"relation" text,
	"notified_channels" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE INDEX "idx_sos_alert_contacts_alert" ON "sos_alert_contacts" ("alert_id");--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 3 · sos_alert_events — the audited timeline
-- ---------------------------------------------------------------------------

CREATE TABLE "sos_alert_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"alert_id" uuid NOT NULL REFERENCES "sos_alerts"("id") ON DELETE cascade,
	"kind" text NOT NULL,
	"actor_type" text NOT NULL,
	"actor_id" uuid,
	"note" text,
	"data" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_sos_alert_events_kind" CHECK ("kind" IN ('triggered', 'contacts_notified', 'ops_alerted', 'acknowledged', 'contacted', 'note', 'broadcast', 'resolved', 'cancelled')),
	CONSTRAINT "ck_sos_alert_events_actor_type" CHECK ("actor_type" IN ('subject', 'admin', 'system'))
);--> statement-breakpoint

CREATE INDEX "idx_sos_alert_events_alert"
  ON "sos_alert_events" ("alert_id", "created_at");
