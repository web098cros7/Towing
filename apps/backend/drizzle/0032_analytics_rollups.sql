--
-- ===========================================================================
-- W17 — analytics (§9.4.13, §22.2): the nightly rollups and the §22.1 event
-- tracker (ToBeDoneEhsan 19vi).
--
-- FIVE TABLES, TWO JOBS:
--   · `analytics_daily`      — one row per IST day, the whole §22.2 KPI set;
--   · `analytics_zone_daily` — the same day cut by service zone (§22.2 geo);
--   · `analytics_band_daily` — commission revenue by band A/B/C (§22.2 revenue);
--   · `analytics_demand_grid`— demand + wave depth in ~0.01° cells (§22.2 geo);
--   · `analytics_events`     — §22.1's SERVER-EMITTED facts, durable rows where
--                              ToBeDoneEhsan 19vi found only log lines.
--
-- WHY ROLLUPS INSTEAD OF MATERIALIZED VIEWS: the guide's own reasoning — a
-- matview refresh locks and loses per-day incrementality; the projector
-- precedent (`earnings_daily`, migration 0016/0017) already established the
-- absolute-recompute-per-cell pattern this follows. At-least-once delivery
-- means the job may run twice for one day, so every write is a DELETE-then-
-- INSERT of the whole day inside one transaction — never an increment.
--
-- MONEY IS BIGINT PAISE. Rates are basis points (integers) so two screens
-- cannot format 12.34% differently. `on_time_bps` IS ALWAYS NULL today: no
-- promised-arrival column exists to measure against, and a fake on-time
-- percentage is worse than an honest null (the milestone decision, restated
-- in `analytics-rollup.ts` where the metric would be computed).
--
-- Hand-written, like every migration from 0002 onward. Journal idx 32.
-- ===========================================================================
--

CREATE TABLE "analytics_daily" (
	"day" date PRIMARY KEY,
	"bookings_created" integer NOT NULL DEFAULT 0,
	"bookings_matched" integer NOT NULL DEFAULT 0,
	"bookings_completed" integer NOT NULL DEFAULT 0,
	"bookings_paid" integer NOT NULL DEFAULT 0,
	"bookings_cancelled" integer NOT NULL DEFAULT 0,
	"no_drivers_found" integer NOT NULL DEFAULT 0,
	"gmv_paise" bigint NOT NULL DEFAULT 0,
	"commission_paise" bigint NOT NULL DEFAULT 0,
	"tax_paise" bigint NOT NULL DEFAULT 0,
	"discount_paise" bigint NOT NULL DEFAULT 0,
	"refunds_paise" bigint NOT NULL DEFAULT 0,
	"aov_paise" bigint NOT NULL DEFAULT 0,
	"take_rate_bps" integer NOT NULL DEFAULT 0,
	"fill_rate_bps" integer NOT NULL DEFAULT 0,
	"ttm_p50_s" integer,
	"ttm_p90_s" integer,
	"on_time_bps" integer,
	"active_drivers" integer NOT NULL DEFAULT 0,
	"new_customers" integer NOT NULL DEFAULT 0,
	"coupon_redemptions" integer NOT NULL DEFAULT 0,
	"sos_alerts" integer NOT NULL DEFAULT 0,
	"sos_ack_p95_s" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE TABLE "analytics_zone_daily" (
	"day" date NOT NULL,
	"zone_id" uuid NOT NULL REFERENCES "service_zones"("id"),
	"bookings_created" integer NOT NULL DEFAULT 0,
	"bookings_matched" integer NOT NULL DEFAULT 0,
	"no_drivers_found" integer NOT NULL DEFAULT 0,
	"gmv_paise" bigint NOT NULL DEFAULT 0,
	"commission_paise" bigint NOT NULL DEFAULT 0,
	"ttm_p50_s" integer,
	PRIMARY KEY ("day", "zone_id")
);--> statement-breakpoint

CREATE TABLE "analytics_band_daily" (
	"day" date NOT NULL,
	"band" "commission_band" NOT NULL,
	"bookings_paid" integer NOT NULL DEFAULT 0,
	"gmv_paise" bigint NOT NULL DEFAULT 0,
	"commission_paise" bigint NOT NULL DEFAULT 0,
	"driver_payout_paise" bigint NOT NULL DEFAULT 0,
	PRIMARY KEY ("day", "band")
);--> statement-breakpoint

-- ~0.01° cells (~1.1 km): fine enough to see a supply gap move between
-- neighbourhoods, coarse enough that no cell ever describes one customer.
CREATE TABLE "analytics_demand_grid" (
	"day" date NOT NULL,
	"hour" smallint NOT NULL,
	"cell_lat" numeric(6, 2) NOT NULL,
	"cell_lng" numeric(6, 2) NOT NULL,
	"bookings" integer NOT NULL DEFAULT 0,
	"no_drivers" integer NOT NULL DEFAULT 0,
	"avg_wave" numeric(4, 1),
	PRIMARY KEY ("day", "hour", "cell_lat", "cell_lng")
);--> statement-breakpoint

-- §22.1's server-side facts. NO CHECK ON `name` — the vocabulary is expected
-- to grow (client events later, new server facts per phase) and a CHECK would
-- make every addition a migration; `admin_actions.action` set the precedent.
--
-- `props` CARRIES NO PII BY RULE — ids and enums only (a failure reason is a
-- gateway string, not a person). The tracker call sites are the four state
-- transitions in the guide, each writing in the SAME transaction as the fact
-- they record, so a redelivery or a rollback cannot desynchronise them.
CREATE TABLE "analytics_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"booking_id" uuid REFERENCES "bookings"("id") ON DELETE SET NULL,
	"subject_type" text,
	"subject_id" uuid,
	"props" jsonb NOT NULL DEFAULT '{}'::jsonb,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE INDEX "idx_analytics_events_name_time" ON "analytics_events" ("name", "occurred_at");--> statement-breakpoint
CREATE INDEX "idx_analytics_events_booking" ON "analytics_events" ("booking_id");--> statement-breakpoint
