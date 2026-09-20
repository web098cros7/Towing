--
-- ===========================================================================
-- W15 — support tickets and content: the requester's way in, the console's
-- way to work it, and the FAQ/legal pages the apps currently hardcode.
--
-- §9.4.12 asks for tickets from customers/drivers/fleets with a status
-- workflow, assignment and notes; §6.6 wants "Get help" from a booking. The
-- customer app's Support screen is UI only today (menu cards and a phone
-- number) and its legal links go nowhere — this migration is the persistence
-- that replaces both.
--
-- Four tables:
--   1 · `support_tickets` — one reference a human can quote, the polymorphic
--       requester, the workflow columns, and the stamps the SLA colouring
--       reads. `requester_id` is FK-free by design (three subject types, one
--       column, same shape as `admin_notes`);
--   2 · `support_ticket_messages` — `public|internal` visibility. INTERNAL IS
--       THE LOAD-BEARING HALF: it must never reach a requester payload, and
--       the repository excludes it by construction;
--   3 · `support_ticket_events` — the audited trail (assign, status, first
--       response), so "who moved this" is answerable without the audit feed;
--   4 · `content_pages` — FAQ and legal bodies an operator can edit without a
--       release (ToBeDoneEhsan D-v).
--
-- Hand-written, like every migration from 0002 onward. Journal idx 30.
-- ===========================================================================
--

-- ---------------------------------------------------------------------------
-- 1 · support_tickets
-- ---------------------------------------------------------------------------

CREATE TABLE "support_tickets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reference" text NOT NULL,
	"requester_type" text NOT NULL,
	"requester_id" uuid NOT NULL,
	"booking_id" uuid REFERENCES "bookings"("id") ON DELETE set null,
	"category" text NOT NULL,
	"subject" text NOT NULL,
	"status" text NOT NULL DEFAULT 'open',
	"priority" text NOT NULL DEFAULT 'normal',
	"assigned_admin_id" uuid REFERENCES "admin_users"("id"),
	"first_response_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_support_tickets_requester_type" CHECK ("requester_type" IN ('user', 'driver', 'fleet')),
	CONSTRAINT "ck_support_tickets_category" CHECK ("category" IN ('booking', 'payment', 'kyc', 'app', 'safety', 'other')),
	CONSTRAINT "ck_support_tickets_status" CHECK ("status" IN ('open', 'pending_requester', 'in_progress', 'resolved', 'closed')),
	CONSTRAINT "ck_support_tickets_priority" CHECK ("priority" IN ('low', 'normal', 'high', 'urgent'))
);--> statement-breakpoint

-- The reference is what a human quotes on the phone; duplicates would make it
-- worthless as a key.
CREATE UNIQUE INDEX "uq_support_tickets_reference" ON "support_tickets" ("reference");--> statement-breakpoint

-- The console queue: newest first, usually filtered by status.
CREATE INDEX "idx_support_tickets_status_created"
  ON "support_tickets" ("status", "created_at" DESC NULLS LAST);--> statement-breakpoint

-- The requester's own list.
CREATE INDEX "idx_support_tickets_requester"
  ON "support_tickets" ("requester_type", "requester_id", "created_at" DESC NULLS LAST);--> statement-breakpoint

CREATE INDEX "idx_support_tickets_assigned" ON "support_tickets" ("assigned_admin_id");--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 2 · support_ticket_messages — public vs internal
-- ---------------------------------------------------------------------------

CREATE TABLE "support_ticket_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ticket_id" uuid NOT NULL REFERENCES "support_tickets"("id") ON DELETE cascade,
	"author_type" text NOT NULL,
	"author_id" uuid,
	"body" text NOT NULL,
	"visibility" text NOT NULL DEFAULT 'public',
	"attachments" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_support_ticket_messages_author_type" CHECK ("author_type" IN ('requester', 'admin', 'system')),
	CONSTRAINT "ck_support_ticket_messages_visibility" CHECK ("visibility" IN ('public', 'internal'))
);--> statement-breakpoint

CREATE INDEX "idx_support_ticket_messages_ticket"
  ON "support_ticket_messages" ("ticket_id", "created_at");--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 3 · support_ticket_events — the audited trail
-- ---------------------------------------------------------------------------

CREATE TABLE "support_ticket_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ticket_id" uuid NOT NULL REFERENCES "support_tickets"("id") ON DELETE cascade,
	"kind" text NOT NULL,
	"actor_type" text NOT NULL,
	"actor_id" uuid,
	"data" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_support_ticket_events_kind" CHECK ("kind" IN ('created', 'assigned', 'status_changed', 'message', 'note', 'linked_booking')),
	CONSTRAINT "ck_support_ticket_events_actor_type" CHECK ("actor_type" IN ('requester', 'admin', 'system'))
);--> statement-breakpoint

CREATE INDEX "idx_support_ticket_events_ticket"
  ON "support_ticket_events" ("ticket_id", "created_at");--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 4 · content_pages — the FAQ/legal surface the apps fetch
-- ---------------------------------------------------------------------------

CREATE TABLE "content_pages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"body_md" text NOT NULL,
	"locale" text NOT NULL DEFAULT 'en',
	"is_published" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"updated_by" uuid REFERENCES "admin_users"("id"),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_content_pages_kind" CHECK ("kind" IN ('faq', 'legal'))
);--> statement-breakpoint

CREATE UNIQUE INDEX "uq_content_pages_slug" ON "content_pages" ("slug");--> statement-breakpoint

CREATE INDEX "idx_content_pages_kind_order" ON "content_pages" ("kind", "sort_order");
