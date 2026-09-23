--
-- A fleet owner decides how their drivers are paid (Ehsan, 24 Sep).
--
-- A fleet is one owner with several tow trucks. Some owners share each job's
-- payout with the driver who did it; others collect everything and pay their
-- drivers a salary. MiTow now supports both, as Uber's and Ola's fleet
-- partners do:
--
--   share   the driver gets `driver_share_pct` of each job's payout (after
--           MiTow's commission), the fleet the rest. A per-driver override
--           lives in `fleet_driver_shares`.
--   salary  the whole payout goes to the fleet; the driver is paid by the
--           owner, outside MiTow.
--
-- It also closes a hole. Settlement read the split from `fleet_driver_shares`
-- alone, and a fleet driver with no row there was settled at 0%: the whole
-- payout to the fleet, nothing to the driver, while their offer card had shown
-- them the whole payout. Only the seed ever wrote those rows, so every driver
-- a fleet owner invited would have been paid nothing for every job. The
-- fleet's own setting is now the fallback.
--
-- 80 is the spec's default (section 14.3, "configurable per fleet, default
-- 80/20"), and `share` keeps every existing fleet on the model it had.
--
ALTER TABLE "fleets" ADD COLUMN IF NOT EXISTS "driver_pay_model" text NOT NULL DEFAULT 'share';--> statement-breakpoint
ALTER TABLE "fleets" ADD CONSTRAINT "ck_fleets_driver_pay_model" CHECK ("driver_pay_model" IN ('share', 'salary'));--> statement-breakpoint
ALTER TABLE "fleets" ADD COLUMN IF NOT EXISTS "driver_share_pct" numeric(5, 2) NOT NULL DEFAULT 80;--> statement-breakpoint
ALTER TABLE "fleets" ADD CONSTRAINT "ck_fleets_driver_share_pct" CHECK ("driver_share_pct" >= 0 AND "driver_share_pct" <= 100);--> statement-breakpoint

--
-- The split, LOCKED on the booking when the driver accepts it — the same way
-- the fare and MiTow's commission are locked at confirm. The offer told the
-- driver what they would earn; an owner changing the setting mid-trip must not
-- change what that driver is paid for a job already accepted.
--
-- Null on bookings accepted before this migration: settlement resolves those
-- from the current setting, which is what it did before.
--
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "driver_pay_model" text;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "ck_bookings_driver_pay_model" CHECK ("driver_pay_model" IS NULL OR "driver_pay_model" IN ('independent', 'share', 'salary'));--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "driver_share_pct" numeric(5, 2);--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "ck_bookings_driver_share_pct" CHECK ("driver_share_pct" IS NULL OR ("driver_share_pct" >= 0 AND "driver_share_pct" <= 100));
