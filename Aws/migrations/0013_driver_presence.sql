--
-- ===========================================================================
-- Phase 16 — driver presence, the location pipeline & mobile maps.
--
-- INDEX-ONLY, AND THAT IS THE INTERESTING PART. Every column this phase writes
-- already existed and had never been written by anything:
--   · `drivers.current_location` / `last_ping_at` — declared in 0001, given a
--     GIST index in 0002 for "the progressive-radius nearest-driver search",
--     and populated for the first time here.
--   · `drivers.current_zone_id` — added in 0007 as an explicit schema-only seam
--     ("nothing writes it until the presence work lands"). It lands.
--   · `booking_location_path` — declared in 0001, zero writers until now.
-- The hot state that is genuinely new (per-driver `seq`, heading, accuracy,
-- cached fleet/truck identity) lives in Redis behind a 30s TTL, because it is
-- worthless the moment it is stale and has no business surviving a restart.
--
-- Hand-written, like 0002/0004/0005/0007/0008/0009/0010/0011/0012: drizzle-kit
-- emits neither partial indexes nor GIST.
-- ===========================================================================
--

-- ---------------------------------------------------------------------------
-- §6.1 — the zone partition
-- ---------------------------------------------------------------------------

-- `current_zone_id` gains its first reader here (go-offline's zone lookup, and
-- the rehydrate path after a driver has been out of signal past the hash TTL).
-- Nothing has ever indexed it.
--
-- Partial: an offline driver's zone is NULL by construction — `goOffline`
-- clears it — so the index only ever needs to cover drivers who are online, and
-- restricting it keeps it roughly the size of live supply rather than the size
-- of the whole driver table.
CREATE INDEX IF NOT EXISTS "idx_drivers_zone"
  ON "drivers" ("current_zone_id")
  WHERE "is_online" AND "current_zone_id" IS NOT NULL;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- §19.2 — the PostGIS rung of the candidate ladder
-- ---------------------------------------------------------------------------

-- Redis-degraded falls back to direct PostGIS. `idx_drivers_geo` (0002) already
-- indexes `current_location`, but it is UNFILTERED: it covers every driver who
-- has ever pinged, including the offline, the rejected and the suspended. The
-- fallback query filters on all three before it measures distance, so without a
-- partial index Postgres either scans the whole GIST and re-checks each hit, or
-- gives up on the index entirely.
--
-- The `kyc_status` literal is cast because the column is an enum, and the
-- predicate is IMMUTABLE-safe (no now(), no volatile calls) — a freshness bound
-- on `last_ping_at` could not be part of a partial index for exactly that
-- reason, and is left to the query.
CREATE INDEX IF NOT EXISTS "idx_drivers_online_geo"
  ON "drivers" USING GIST ("current_location")
  WHERE "is_online"
    AND "kyc_status" = 'approved'::kyc_status
    AND "current_location" IS NOT NULL;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- §11.2 — the trip breadcrumb's write path
-- ---------------------------------------------------------------------------

-- The ~30s sample resolves "which booking is this driver on" with
--   join bookings b on b.driver_id = v.driver_id and b.status in (…active…)
-- once per flush per driver. `idx_bookings_driver` (0001) is on `driver_id`
-- alone, so that join re-checks the status of every booking the driver has ever
-- completed — a number that only grows. This is the two-column form.
--
-- Partial rather than a plain composite: only the four active states are ever
-- looked up this way, and a driver has at most one row in them at a time, so
-- the index stays at roughly one entry per driver on shift instead of one per
-- historical trip.
CREATE INDEX IF NOT EXISTS "idx_bookings_driver_active"
  ON "bookings" ("driver_id")
  WHERE "status" IN ('assigned', 'en_route', 'arrived', 'in_progress');
