--
-- ===========================================================================
-- W5 — the dispatch inspector: per-wave decision log.
--
-- The §6.2 score is computed in memory and thrown away; exclusion counts go to
-- a log line nobody can read after the fact. §9.4.6 needs the opposite: for any
-- booking, what each wave saw (who was in range, who was excluded and why),
-- what it scored them (the four weighted terms, the weights in force), and who
-- was actually offered. This table is that record, written once per wave by the
-- wave runner AFTER offers go out — in a try/catch, because an inspector that
-- can fail a search is worse than an inspector with a gap in it.
--
-- APPEND-ONLY AUDIT, NOT STATE. The durable wave position stays on
-- `bookings.search_wave` / `dispatch_deadline_at`; nothing reconstructs "where
-- is the search now" from these rows. Rows are written from this deploy onward,
-- so earlier bookings have no history — the endpoint says so rather than
-- inventing one.
--
-- The unique `(booking_id, wave, ran_at)` is a collision backstop, not an
-- idempotency key: two workers racing the same wave are already excluded by the
-- search lock, and `ran_at` makes an accidental duplicate a new row rather than
-- an error worth failing a wave over.
--
-- Retention: W17's analytics job purges rows older than 30 days; the `ran_at`
-- index exists for that sweep.
-- ===========================================================================
--

CREATE TABLE "dispatch_wave_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" uuid NOT NULL,
	"wave" integer NOT NULL,
	"radius_km" numeric(6, 2) NOT NULL,
	"considered" integer NOT NULL,
	"eligible" integer NOT NULL,
	"offered" integer NOT NULL,
	"degraded" boolean DEFAULT false NOT NULL,
	"weights" jsonb NOT NULL,
	"config" jsonb NOT NULL,
	"excluded" jsonb NOT NULL,
	"candidates" jsonb NOT NULL,
	"ran_at" timestamp with time zone DEFAULT now() NOT NULL,
	"duration_ms" integer NOT NULL
);
--> statement-breakpoint

ALTER TABLE "dispatch_wave_logs" ADD CONSTRAINT "dispatch_wave_logs_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_dispatch_wave_logs_wave_ran" ON "dispatch_wave_logs" USING btree ("booking_id","wave","ran_at");--> statement-breakpoint
CREATE INDEX "idx_dispatch_wave_logs_booking_wave" ON "dispatch_wave_logs" USING btree ("booking_id","wave");--> statement-breakpoint
CREATE INDEX "idx_dispatch_wave_logs_ran_at" ON "dispatch_wave_logs" USING btree ("ran_at");--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 2 · `reassigned` — the outcome 0014 said would come
-- ---------------------------------------------------------------------------

-- 0014 chose a CHECK over a Postgres enum expressly so this could be one
-- reversible line; 0015 widened it with `unable`. W8's admin reassignment adds
-- `reassigned` here — one more try at the ladder the CHECK said would happen.
--
-- W5 ships the value and the widened constraint, not the writer: the reassign
-- route is W8's. Nothing writes `reassigned` yet, and that is deliberate —
-- widening first means W8 does not have to coordinate a migration with its
-- route. Like `unable`, it sits OUTSIDE the acceptance-rate denominator
-- (`accepted + rejected + expired`): a reassignment is an admin decision, not a
-- driver's refusal.
ALTER TABLE "dispatch_attempts"
  DROP CONSTRAINT IF EXISTS "ck_dispatch_attempts_outcome";--> statement-breakpoint

ALTER TABLE "dispatch_attempts"
  ADD CONSTRAINT "ck_dispatch_attempts_outcome"
  CHECK ("outcome" IN ('offered', 'accepted', 'rejected', 'expired', 'revoked', 'unable', 'reassigned'));--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 3 · Backfills — none required
-- ---------------------------------------------------------------------------
-- The table starts empty on purpose: wave history begins at the deploy that
-- wrote the first row, and earlier bookings show an honest "no waves recorded"
-- in the inspector rather than a fabricated reconstruction.
