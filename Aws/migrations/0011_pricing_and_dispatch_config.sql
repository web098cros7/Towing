CREATE TYPE "public"."pricing_rule_kind" AS ENUM('slab', 'long_distance', 'roadside');--> statement-breakpoint
CREATE TYPE "public"."surge_band" AS ENUM('standard', 'high', 'peak');--> statement-breakpoint
CREATE TABLE "charge_config" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"singleton" boolean DEFAULT true NOT NULL,
	"night_pct" numeric(5, 2) DEFAULT '15.00' NOT NULL,
	"night_start_hour" integer DEFAULT 22 NOT NULL,
	"night_end_hour" integer DEFAULT 6 NOT NULL,
	"highway_charge" numeric(12, 2) DEFAULT '500.00' NOT NULL,
	"accident_charge" numeric(12, 2) DEFAULT '1500.00' NOT NULL,
	"waiting_free_minutes" integer DEFAULT 15 NOT NULL,
	"waiting_per_minute" numeric(12, 2) DEFAULT '5.00' NOT NULL,
	"surge_pct_high" numeric(5, 2) DEFAULT '10.00' NOT NULL,
	"surge_pct_peak" numeric(5, 2) DEFAULT '25.00' NOT NULL,
	"haversine_road_factor" numeric(4, 2) DEFAULT '1.30' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "charge_config_singleton_unique" UNIQUE("singleton")
);
--> statement-breakpoint
CREATE TABLE "commission_config" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"band" "commission_band" NOT NULL,
	"pct" numeric(5, 2) NOT NULL,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "commission_config_band_unique" UNIQUE("band")
);
--> statement-breakpoint
CREATE TABLE "commission_config_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"band" "commission_band" NOT NULL,
	"old_pct" numeric(5, 2),
	"new_pct" numeric(5, 2) NOT NULL,
	"changed_by" uuid,
	"admin_action_id" uuid,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dispatch_config" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"singleton" boolean DEFAULT true NOT NULL,
	"weight_proximity" numeric(5, 2) DEFAULT '60.00' NOT NULL,
	"weight_rating" numeric(5, 2) DEFAULT '15.00' NOT NULL,
	"weight_acceptance" numeric(5, 2) DEFAULT '15.00' NOT NULL,
	"weight_completion" numeric(5, 2) DEFAULT '10.00' NOT NULL,
	"stale_ping_seconds" integer DEFAULT 15 NOT NULL,
	"one_active_booking_per_customer" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dispatch_config_singleton_unique" UNIQUE("singleton")
);
--> statement-breakpoint
CREATE TABLE "pricing_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rule_kind" "pricing_rule_kind" NOT NULL,
	"service_type" "service_type",
	"vehicle_class" "vehicle_class",
	"max_km" numeric(8, 2),
	"price" numeric(12, 2) NOT NULL,
	"price_max" numeric(12, 2),
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "services" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"service_type" "service_type" NOT NULL,
	"default_vehicle_class" "vehicle_class",
	"name" text NOT NULL,
	"description" text NOT NULL,
	"requires_drop" boolean DEFAULT false NOT NULL,
	"display_order" integer NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- REORDERED BY HAND. drizzle-kit emitted SET DEFAULT before SET DATA TYPE, which
-- stamps an enum-typed default onto a column that is still `text` — there is no
-- implicit enum→text cast, so the migration fails on the first statement. The
-- backfill is here because the column was NULLable: every existing row holds the
-- literal 'standard', but SET NOT NULL must not depend on that being true.
UPDATE "service_zones" SET "surge_band" = 'standard' WHERE "surge_band" IS NULL;--> statement-breakpoint
ALTER TABLE "service_zones" ALTER COLUMN "surge_band" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "service_zones" ALTER COLUMN "surge_band" SET DATA TYPE "public"."surge_band" USING "surge_band"::"public"."surge_band";--> statement-breakpoint
ALTER TABLE "service_zones" ALTER COLUMN "surge_band" SET DEFAULT 'standard'::"public"."surge_band";--> statement-breakpoint
ALTER TABLE "service_zones" ALTER COLUMN "surge_band" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "commission_config" ADD CONSTRAINT "commission_config_updated_by_admin_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."admin_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_config_history" ADD CONSTRAINT "commission_config_history_changed_by_admin_users_id_fk" FOREIGN KEY ("changed_by") REFERENCES "public"."admin_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_commission_history_band" ON "commission_config_history" USING btree ("band","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_pricing_rules_lookup" ON "pricing_rules" USING btree ("rule_kind","vehicle_class","max_km");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_services_slug" ON "services" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "idx_services_active_order" ON "services" USING btree ("is_active","display_order");
--
-- ===========================================================================
-- Hand-written from here down: drizzle-kit emits neither CHECK constraints nor
-- partial unique indexes (same reason 0002/0004/0005/0007/0008/0009/0010 carry
-- theirs).
-- ===========================================================================
--

-- ---------------------------------------------------------------------------
-- `services` — the Appendix B catalogue
-- ---------------------------------------------------------------------------

ALTER TABLE "services" ADD CONSTRAINT "ck_services_display_order"
  CHECK ("display_order" >= 0);--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- `pricing_rules` — the union of §7.1/§7.2 slabs, §7.3 ranges and flat fares
-- ---------------------------------------------------------------------------

-- The shape guard is what keeps a three-way union in one table honest. Without
-- it a `roadside` row could carry a `max_km` that no lookup path reads, or a
-- `long_distance` row could omit its ceiling and interpolate against NULL.
ALTER TABLE "pricing_rules" ADD CONSTRAINT "ck_pricing_rules_shape" CHECK (
  ("rule_kind" = 'slab'
     AND "vehicle_class" IS NOT NULL AND "max_km" IS NOT NULL
     AND "service_type" IS NULL AND "price_max" IS NULL)
  OR ("rule_kind" = 'long_distance'
     AND "vehicle_class" IS NOT NULL AND "max_km" IS NOT NULL
     AND "service_type" IS NULL AND "price_max" IS NOT NULL)
  OR ("rule_kind" = 'roadside'
     AND "service_type" IS NOT NULL
     AND "vehicle_class" IS NULL AND "max_km" IS NULL AND "price_max" IS NULL)
);--> statement-breakpoint

ALTER TABLE "pricing_rules" ADD CONSTRAINT "ck_pricing_rules_non_negative"
  CHECK ("price" >= 0 AND ("price_max" IS NULL OR "price_max" >= 0));--> statement-breakpoint

-- §7.3 interpolates from `price` up to `price_max`. Inverted bounds would run
-- the interpolation backwards and quote a long tow LESS than a short one.
ALTER TABLE "pricing_rules" ADD CONSTRAINT "ck_pricing_rules_price_range"
  CHECK ("price_max" IS NULL OR "price_max" >= "price");--> statement-breakpoint

ALTER TABLE "pricing_rules" ADD CONSTRAINT "ck_pricing_rules_max_km_positive"
  CHECK ("max_km" IS NULL OR "max_km" > 0);--> statement-breakpoint

-- Two active rows for the same distance band is an ambiguous fare, and the
-- engine's `find()` would resolve it by row order — i.e. arbitrarily.
CREATE UNIQUE INDEX "uq_pricing_rules_distance_band"
  ON "pricing_rules" ("rule_kind", "vehicle_class", "max_km")
  WHERE "is_active" AND "rule_kind" IN ('slab', 'long_distance');--> statement-breakpoint

CREATE UNIQUE INDEX "uq_pricing_rules_roadside"
  ON "pricing_rules" ("service_type")
  WHERE "is_active" AND "rule_kind" = 'roadside';--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- `charge_config` — §7.4, exactly one row
-- ---------------------------------------------------------------------------

-- UNIQUE(singleton) alone does not make this a singleton: a second row could be
-- inserted with singleton = false. The CHECK is the other half.
ALTER TABLE "charge_config" ADD CONSTRAINT "ck_charge_config_singleton"
  CHECK ("singleton" = true);--> statement-breakpoint

ALTER TABLE "charge_config" ADD CONSTRAINT "ck_charge_config_ranges" CHECK (
  "night_pct" >= 0 AND "night_pct" <= 100
  AND "night_start_hour" >= 0 AND "night_start_hour" <= 23
  AND "night_end_hour" >= 0 AND "night_end_hour" <= 23
  AND "highway_charge" >= 0
  AND "accident_charge" >= 0
  AND "waiting_free_minutes" >= 0 AND "waiting_free_minutes" <= 120
  AND "waiting_per_minute" >= 0
  AND "surge_pct_high" >= 0 AND "surge_pct_high" <= 100
  AND "surge_pct_peak" >= 0 AND "surge_pct_peak" <= 100
  -- A road factor below 1 would quote LESS than the straight-line distance,
  -- which no road can be.
  AND "haversine_road_factor" >= 1 AND "haversine_road_factor" <= 3
);--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- `commission_config` — §3.3, and THE guardrail
-- ---------------------------------------------------------------------------

-- Deliberately the same 5..10 bound as `ck_bookings_commission_pct_guardrail`,
-- which has guarded `bookings.commission_pct` since migration 0002. If this
-- table were allowed to hold 12 while that column rejects it, the failure would
-- not surface at the admin's edit — it would surface as an insert error on the
-- first booking afterwards, unattributable. §3.3: "attempts outside the band
-- are rejected and audited."
ALTER TABLE "commission_config" ADD CONSTRAINT "ck_commission_config_guardrail"
  CHECK ("pct" >= 5 AND "pct" <= 10);--> statement-breakpoint

-- NOTE: `commission_config_history` is deliberately NOT guardrailed. It is a
-- log, and a log that refuses to record what happened is worse than no log. The
-- write path is what enforces the band; this table records the result.

-- ---------------------------------------------------------------------------
-- `dispatch_config` — §6.2 weights + §6.1 liveness, exactly one row
-- ---------------------------------------------------------------------------

ALTER TABLE "dispatch_config" ADD CONSTRAINT "ck_dispatch_config_singleton"
  CHECK ("singleton" = true);--> statement-breakpoint

-- §6.2's scorer normalises against a total of 100. Weights that sum to anything
-- else silently rescale every candidate's score, and the bug is invisible in a
-- ranking — the ORDER is preserved, only the magnitudes shift, so nothing looks
-- wrong until a threshold is compared against.
ALTER TABLE "dispatch_config" ADD CONSTRAINT "ck_dispatch_config_weights_sum"
  CHECK ("weight_proximity" + "weight_rating" + "weight_acceptance" + "weight_completion" = 100);--> statement-breakpoint

ALTER TABLE "dispatch_config" ADD CONSTRAINT "ck_dispatch_config_ranges" CHECK (
  "weight_proximity" >= 0 AND "weight_rating" >= 0
  AND "weight_acceptance" >= 0 AND "weight_completion" >= 0
  AND "stale_ping_seconds" >= 5 AND "stale_ping_seconds" <= 300
);--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- `service_zones.dispatch_config` — the per-zone override JSONB
-- ---------------------------------------------------------------------------

-- Same shape guard `fleets.notification_prefs` got in 0006. `resolveDispatchConfig()`
-- falls back to defaults on anything it cannot parse, so a JSON array stored
-- here would degrade silently rather than loudly; this makes the write fail.
ALTER TABLE "service_zones" ADD CONSTRAINT "ck_service_zones_dispatch_config_object"
  CHECK ("dispatch_config" IS NULL OR jsonb_typeof("dispatch_config") = 'object');
