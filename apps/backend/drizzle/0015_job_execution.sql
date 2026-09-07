--
-- ===========================================================================
-- Phase 18 — job execution, live tracking & share trip.
--
-- Four groups of change, and every one of them exists because something in the
-- §5.2 chain (arrive → OTP → start → complete) has nowhere to write today:
--
--   1. Lifecycle instants on `bookings`. The chain's timestamps live only in
--      `booking_status_history` right now, which is the right home for an audit
--      and the wrong one for a value both apps render every 250 ms.
--   2. A snapshot of the §7.4 waiting rules, so the one fare component that is
--      computed AFTER confirm still obeys §3.4's lock.
--   3. The ETA/route result, so the socket, the §19.2 poll and the public share
--      page cannot tell three different stories about the same trip.
--   4. `unable` as a `dispatch_attempts` outcome, plus the index the
--      `completion_rate` recompute needs.
--
-- Hand-written, like every migration from 0002 onward: drizzle-kit emits
-- neither partial indexes, nor CHECK constraints, nor DESC index ordering.
-- ===========================================================================
--

-- ---------------------------------------------------------------------------
-- 1 · §5.2 lifecycle instants
-- ---------------------------------------------------------------------------

-- DENORMALISED FROM `booking_status_history`, DELIBERATELY, AND THIS IS THE ONE
-- PLACE IN THE SCHEMA WHERE THAT IS THE RIGHT ANSWER.
--
-- Two consumers make the history table unworkable as the source:
--
--   * TowPartner's waiting-charge ticker recomputes `now - arrived_at` four
--     times a second. `useOfferCountdown`'s rule — never start a client clock,
--     always recompute against an absolute SERVER instant — means `arrived_at`
--     has to travel on the job payload, and deriving it from a history scan on
--     every `GET /v1/driver/jobs/current` is a join per poll for a value that
--     never changes once written.
--   * `complete` finalizes the fare from `started_at - arrived_at`. A fare
--     computed off a subquery over an append-only log is a fare that changes if
--     anybody ever writes a corrective history row.
--
-- History stays authoritative for "what happened and who did it". These are the
-- three instants the product quotes back, written by the same UPDATE the
-- transition itself runs, inside the same transaction — so they cannot drift.
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "arrived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "completed_at" timestamp with time zone;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 2 · §3.4's lock, extended to the one charge that cannot be locked at confirm
-- ---------------------------------------------------------------------------

-- Every other fare component is frozen on the row at confirm: base, distance,
-- night, highway, accident, surge, discount, total, commission. Waiting is the
-- exception — nobody knows at confirm how long the driver will stand at the
-- pickup — so it has always been computed later, and "later" meant reading
-- `charge_config` live.
--
-- That quietly breaks the §3.4 promise. An admin who raises `waiting_per_minute`
-- from ₹5 to ₹8 at 14:00 changes the bill of every trip that started at 13:40
-- and has not completed yet. The customer agreed to a rate card; they did not
-- agree to that one.
--
-- So the two waiting knobs are snapshotted onto the booking at confirm and the
-- finalizer reads them from here, never from `charge_config`. NULL means a
-- pre-Phase-18 row, and the backfill below gives every one of them the values
-- in force today — which is exactly what they would have been billed at.
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "waiting_free_minutes" integer;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "waiting_per_minute" numeric(12, 2);--> statement-breakpoint

UPDATE "bookings" b
   SET "waiting_free_minutes" = c."waiting_free_minutes",
       "waiting_per_minute"   = c."waiting_per_minute"
  FROM "charge_config" c
 WHERE b."waiting_free_minutes" IS NULL;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 3 · §11.4/§11.5 — the route and the ETA
-- ---------------------------------------------------------------------------

-- ONE DIRECTIONS RESULT PER BOOKING, STORED ON THE ROW.
--
-- The alternative — recomputing per subscriber, or holding it only in Redis —
-- fails the same way twice. Three surfaces read this: the `/customer` socket,
-- `GET /v1/bookings/:id/tracking` (the §19.2 polling rung) and the public
-- `GET /v1/track/:shareToken` page. If the polyline is not durable, a customer
-- on the poll and a customer on the socket see two different route lines for the
-- same trip, which is precisely the class of bug §19.2 exists to prevent.
--
-- It is also the cost decision made visible. Directions is billed per call and
-- Google Maps has no hard spend cap (SETUP-CHECKLIST item 7); the engine issues
-- exactly one request at assignment, with the pickup as a waypoint, and gets
-- both legs back together. Everything after that is derived locally.
--
-- `route_source` is carried for the same reason `RouteDistance.source` is: a
-- straight-line fallback must be LABELLED, not passed off as a routed answer.
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "route_polyline" text;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "route_drop_polyline" text;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "route_source" text;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "eta_seconds" integer;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "eta_updated_at" timestamp with time zone;--> statement-breakpoint

ALTER TABLE "bookings"
  ADD CONSTRAINT "ck_bookings_route_source"
  CHECK ("route_source" IS NULL OR "route_source" IN ('google_directions', 'haversine'));--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 4 · `unable` — the outcome 0014 said would come
-- ---------------------------------------------------------------------------

-- 0014 chose a CHECK over a Postgres enum specifically so this could be one
-- reversible line: "Phase 18's `unable` outcome and Phase 20's admin
-- reassignment may both want a word here".
--
-- WHY `unable` IS A DISPATCH ATTEMPT AT ALL, when the driver already accepted.
-- `DispatchRepo.excludedDrivers()` reads this table to answer "who has already
-- been asked about this booking", and §6.5's re-dispatch must not hand the job
-- straight back to the driver who just failed to deliver it. Writing the row is
-- how that driver becomes excluded without inventing a second exclusion store.
--
-- It does NOT disturb the acceptance rate: `recomputeAcceptanceRate` counts
-- `accepted / (accepted + rejected + expired)`, and the original `accepted` row
-- stays exactly where it is. An unable-to-deliver is a COMPLETION failure, and
-- it is `drivers.completion_rate` — which gets its first writer in this phase —
-- that is supposed to move.
ALTER TABLE "dispatch_attempts"
  DROP CONSTRAINT IF EXISTS "ck_dispatch_attempts_outcome";--> statement-breakpoint

ALTER TABLE "dispatch_attempts"
  ADD CONSTRAINT "ck_dispatch_attempts_outcome"
  CHECK ("outcome" IN ('offered', 'accepted', 'rejected', 'expired', 'revoked', 'unable'));--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 5 · The `completion_rate` window
-- ---------------------------------------------------------------------------

-- `drivers.completion_rate` is 10 % of the §6.2 score and has never had a writer
-- — `candidate-selection.service.ts` still carries the comment saying a quarter
-- of that score runs on seed fixtures. Phase 18 recomputes it from a rolling
-- 30-day window over this driver's own bookings on every completion and every
-- `unable`, the same self-healing shape `recomputeAcceptanceRate` uses.
--
-- `idx_bookings_driver` is `driver_id` ALONE, so without this the recompute
-- walks a driver's entire trip history and sorts it, on the hot path of
-- finishing a job. Partial on `driver_id IS NOT NULL` because most of the table
-- is `searching`/`cancelled` rows that were never assigned to anybody.
--
-- `DESC NULLS LAST` spelled out — a bare DESC gets a Sort node bolted on top
-- (engineering note 5).
CREATE INDEX IF NOT EXISTS "idx_bookings_driver_outcome"
  ON "bookings" ("driver_id", "updated_at" DESC NULLS LAST)
  WHERE "driver_id" IS NOT NULL;
