ALTER TABLE "bookings" ADD COLUMN "booking_otp_hash" text;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "otp_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "truck_id" uuid;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "search_wave" integer;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "dispatch_deadline_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "scheduled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "contact_name" text;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "contact_mobile" text;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "note" text;--> statement-breakpoint
ALTER TABLE "dispatch_config" ADD COLUMN "block_on_unpaid_balance" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_truck_id_fleet_trucks_id_fk" FOREIGN KEY ("truck_id") REFERENCES "public"."fleet_trucks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_bookings_user_feed" ON "bookings" USING btree ("user_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);;--> statement-breakpoint
-- Merged from the second generate pass. DROP + ADD, never a rename: the old
-- column held PLAINTEXT codes, and carrying those into a column named
-- `_hash` would be worse than the bug being fixed.
ALTER TABLE "bookings" DROP COLUMN "booking_otp";

--
-- ===========================================================================
-- Hand-written from here down: drizzle-kit emits neither CHECK constraints nor
-- partial indexes (same reason 0002/0004/0005/0007/0008/0009/0010/0011 carry
-- theirs).
-- ===========================================================================
--

-- ---------------------------------------------------------------------------
-- §3.8 — one active booking per customer
-- ---------------------------------------------------------------------------

-- §19.4 asks for "unique constraints as the final backstop". The service check
-- is what produces a friendly error; THIS is what makes the rule true. Two
-- confirm requests racing each other both pass a SELECT-then-INSERT check, and
-- the loser has to be rejected by the database or the customer ends up with two
-- fare-locked bookings and two dispatches hunting for them.
--
-- Partial, over exactly the non-terminal states: `completed`, `paid`,
-- `cancelled`, `no_drivers_found` and `disputed` are all finished, and a
-- customer must of course be able to book again after any of them.
CREATE UNIQUE INDEX "uq_bookings_one_active_per_user"
  ON "bookings" ("user_id")
  WHERE "status" IN ('searching', 'assigned', 'en_route', 'arrived', 'in_progress');--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- §11.7 — the share-trip token
-- ---------------------------------------------------------------------------

-- Plain nullable text with no index until now: every public /track/:token
-- lookup was a sequential scan, and nothing stopped two bookings being handed
-- the same token. Phase 18 serves the route; the guarantee belongs with the
-- column.
CREATE UNIQUE INDEX "uq_bookings_share_token"
  ON "bookings" ("share_token")
  WHERE "share_token" IS NOT NULL;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- §5.1 / §9.1.7 — the booking OTP
-- ---------------------------------------------------------------------------

-- A booking cannot be marked OTP-verified when there is no code to have
-- verified against. §5.1 reaches IN_PROGRESS only through OTP verification, so
-- this is the schema-level half of "the job cannot start without a valid OTP".
ALTER TABLE "bookings" ADD CONSTRAINT "ck_bookings_otp_verified_needs_hash"
  CHECK ("otp_verified" = false OR "booking_otp_hash" IS NOT NULL);--> statement-breakpoint

ALTER TABLE "bookings" ADD CONSTRAINT "ck_bookings_otp_attempts_non_negative"
  CHECK ("otp_attempts" >= 0);--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- §6.4 — durable dispatch state
-- ---------------------------------------------------------------------------

ALTER TABLE "bookings" ADD CONSTRAINT "ck_bookings_search_wave_positive"
  CHECK ("search_wave" IS NULL OR "search_wave" >= 1);--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- §3.5 — cancellation
-- ---------------------------------------------------------------------------

-- A fee without a cancellation is a charge nobody can explain. (The reverse is
-- fine and common: every free cancellation is exactly that.)
ALTER TABLE "bookings" ADD CONSTRAINT "ck_bookings_cancellation_fee_needs_cancel"
  CHECK ("cancellation_fee" = 0 OR "cancelled_by" IS NOT NULL);
