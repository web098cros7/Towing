--
-- ===========================================================================
-- A14 — two-mode driver suspension: the pending shelf.
--
-- Suspending a driver mid-job cannot strand the booking (A14), but it also
-- cannot finish the job first and suspend purely from memory: a restart
-- between the decision and the completion would lose a Redis-only flag and
-- leave the driver unsuspended with no trace. These three columns are the
-- durable shelf `after_current_job` waits on — set at suspend time, read by
-- dispatch eligibility and go-online, cleared when the suspension applies.
--
-- All nullable: NULL means "no suspension pending", which is every existing
-- row. Behaviour-neutral until an admin suspends a driver mid-job.
--
-- Hand-written, like every migration from 0002 onward. W6's directory
-- migration must NOT re-add these columns (it takes the NEXT number; see the
-- M0 report's renumber table).
-- ===========================================================================
--

ALTER TABLE "drivers" ADD COLUMN IF NOT EXISTS "pending_suspension_reason" text;--> statement-breakpoint
ALTER TABLE "drivers" ADD COLUMN IF NOT EXISTS "pending_suspension_by" uuid REFERENCES "admin_users"("id");--> statement-breakpoint
ALTER TABLE "drivers" ADD COLUMN IF NOT EXISTS "pending_suspension_at" timestamp with time zone;--> statement-breakpoint
