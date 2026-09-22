--
-- ===========================================================================
-- Phase 17 — the dispatch engine.
--
-- NO NEW TABLES, AND THAT IS NOT A COINCIDENCE. `dispatch_attempts` has existed
-- since migration 0001 with zero readers and zero writers, and 0012 added
-- `bookings.search_wave` / `dispatch_deadline_at` for exactly this phase
-- ("durable §6.4 wave state; in-memory search progress does not survive a
-- Fargate task recycling"). What is missing is not storage — it is the
-- protection and the index support that make the engine safe and fast.
--
-- Hand-written, like every migration from 0002 onward: drizzle-kit emits
-- neither partial indexes, nor CHECK constraints, nor DESC index ordering.
-- ===========================================================================
--

-- ---------------------------------------------------------------------------
-- §19.4 — "unique constraints as the final backstop", the DRIVER side
-- ---------------------------------------------------------------------------

-- Migration 0012 added `uq_bookings_one_active_per_user` for §3.8: one live trip
-- per customer. This is its mirror, and it guards a race that no amount of
-- application care can see.
--
-- The accept transaction takes `SELECT … FOR UPDATE` on the BOOKING row, which
-- serialises two drivers racing to accept THE SAME job — exactly one wins and
-- the loser gets a graceful 409. It does nothing whatsoever about one driver
-- accepting TWO DIFFERENT bookings in the same instant, because those are two
-- different rows and neither transaction ever looks at the other. The offer lock
-- in Redis makes that vanishingly unlikely (a driver holding a pending offer is
-- invisible to every other search) — but a Redis eviction, a lock expiring a
-- millisecond early, or a manual admin assignment all route around it, and the
-- outcome is a driver committed to two customers at once.
--
-- The status set is `ACTIVE_JOB_STATUSES` from `booking-state-machine.service.ts`.
-- `searching` is deliberately absent: a searching booking has no driver at all.
-- If that constant changes, this predicate must change with it —
-- `dispatch-invariants.spec.ts` parses this file and asserts they match, the same
-- mechanism `booking-state-machine.spec.ts` already uses for the customer index.
CREATE UNIQUE INDEX IF NOT EXISTS "uq_bookings_one_active_per_driver"
  ON "bookings" ("driver_id")
  WHERE "driver_id" IS NOT NULL
    AND "status" IN ('assigned', 'en_route', 'arrived', 'in_progress');--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- §6.2 — the acceptance-rate recompute
-- ---------------------------------------------------------------------------

-- `drivers.acceptance_rate` is 15 % of the §6.2 score and has never had a
-- writer; Phase 17 recomputes it from a rolling 30-day window over
-- `dispatch_attempts` on EVERY offer resolution — accept, reject and expire.
-- That is the hottest read this table will ever take, and the only index it has
-- is `(booking_id, wave)`, which serves the opposite access pattern.
--
-- `DESC NULLS LAST` spelled out rather than a bare DESC: drizzle-kit emits the
-- former and a query ordering only `desc` gets a Sort node bolted on top of the
-- index (engineering note 5). The window predicate is on `offered_at`, so it
-- leads the ordering.
CREATE INDEX IF NOT EXISTS "idx_dispatch_attempts_driver"
  ON "dispatch_attempts" ("driver_id", "offered_at" DESC NULLS LAST);--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- The outcome vocabulary
-- ---------------------------------------------------------------------------

-- `outcome` is `text` with the five legal values named only in a trailing
-- comment on the column. Phase 17 makes that comment load-bearing: the
-- acceptance rate is `accepted / (accepted + rejected + expired)`, so a typo'd
-- or invented outcome does not fail loudly — it silently changes a driver's
-- dispatch score, and through it their income.
--
-- A CHECK rather than a Postgres enum, deliberately. An enum value cannot be
-- dropped, and this vocabulary is younger than the ones that earned enums:
-- Phase 18's `unable` outcome and Phase 20's admin reassignment may both want a
-- word here, and a CHECK can be widened in a migration that is one line and
-- fully reversible.
ALTER TABLE "dispatch_attempts"
  ADD CONSTRAINT "ck_dispatch_attempts_outcome"
  CHECK ("outcome" IN ('offered', 'accepted', 'rejected', 'expired', 'revoked'));
