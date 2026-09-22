--
-- ===========================================================================
-- W12 — the app-level config both handsets read, and the last two missing
-- §19.8/§6.7 knobs.
--
-- Three groups, in order:
--   1 · app_config — a NEW singleton, because §19.8's "minimum-supported-version
--       gate" and §19.9's SEV status banner had no home at all: neither value
--       existed anywhere, so neither could be changed without a release. Both
--       apps read it at launch and on resume from the PUBLIC
--       `GET /v1/app-config` (cached, ETag) — no session, because a client that
--       must force-upgrade to talk to us cannot first be required to talk to us;
--   2 · dispatch_config.redispatch_priority — §6.7's "re-dispatch priority",
--       the one knob of that list that was never built. It decides whether a
--       §6.5 re-dispatch jumps the queue (`front`, the shipped behaviour) or
--       waits for the next normal cadence (`normal`);
--   3 · dispatch_config ping cadence — §11.3/§19.8 want the cadence
--       server-configurable. It was a frozen constant in contracts, pushed to
--       handsets over `config:update`, so the "push" half already existed and
--       only the "admin-editable" half was missing. The constant stays as the
--       DEFAULT for these columns, which is why the backfill is a plain
--       `SET DEFAULT` already satisfied by the column default.
--
-- Hand-written, like every migration from 0002 onward. Journal idx 27.
-- The CHECK literal lists are pinned to the exported contract unions by
-- `migration-0027.spec.ts` — the house rule wherever a CHECK duplicates a
-- TypeScript union.
-- ===========================================================================
--

-- ---------------------------------------------------------------------------
-- 1 · app_config — the minimum-version gate and the SEV banner
-- ---------------------------------------------------------------------------

CREATE TABLE "app_config" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"singleton" boolean DEFAULT true NOT NULL,
	"min_customer_version" text DEFAULT '1.0.0' NOT NULL,
	"min_driver_version" text DEFAULT '1.0.0' NOT NULL,
	"force_upgrade" boolean DEFAULT false NOT NULL,
	"sev_level" text,
	"sev_message" text,
	"sev_updated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "app_config_singleton_unique" UNIQUE("singleton")
);--> statement-breakpoint

-- UNIQUE(singleton) alone does not make this a singleton: a second row could be
-- inserted with singleton = false. The CHECK is the other half — the same pair
-- `charge_config`, `dispatch_config` and `commission_guardrail` carry.
ALTER TABLE "app_config" ADD CONSTRAINT "ck_app_config_singleton"
  CHECK ("singleton");--> statement-breakpoint

ALTER TABLE "app_config" ADD CONSTRAINT "ck_app_config_sev_level"
  CHECK ("sev_level" IS NULL OR "sev_level" IN ('sev1', 'sev2', 'sev3'));--> statement-breakpoint

-- A LEVEL WITHOUT A MESSAGE IS A BANNER WITH NOTHING TO SAY, and a message
-- without a level has no styling and no severity. They are one decision, so
-- they are null together or set together — which is also what makes "clear the
-- banner" a single UPDATE that cannot half-apply.
ALTER TABLE "app_config" ADD CONSTRAINT "ck_app_config_sev_pair"
  CHECK (("sev_level" IS NULL) = ("sev_message" IS NULL));--> statement-breakpoint

ALTER TABLE "app_config" ADD CONSTRAINT "ck_app_config_sev_message_length"
  CHECK ("sev_message" IS NULL OR length("sev_message") <= 500);--> statement-breakpoint

-- The launch row: no banner, and a minimum version low enough to support every
-- build that exists. A NULL SEV means "no incident"; a 1.0.0 floor means the
-- gate is CLOSED until somebody opens it, which is the safe direction — an
-- unconfigured build gate that blocks nobody is a no-op, one that blocks
-- everybody is an outage.
INSERT INTO "app_config" ("min_customer_version", "min_driver_version", "force_upgrade")
  VALUES ('1.0.0', '1.0.0', false);--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 2 · dispatch_config.redispatch_priority — §6.7
-- ---------------------------------------------------------------------------

ALTER TABLE "dispatch_config" ADD COLUMN "redispatch_priority" text DEFAULT 'front' NOT NULL;--> statement-breakpoint

ALTER TABLE "dispatch_config" ADD CONSTRAINT "ck_dispatch_config_redispatch_priority"
  CHECK ("redispatch_priority" IN ('front', 'normal'));--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 3 · dispatch_config ping cadence — §11.3 / §19.8
-- ---------------------------------------------------------------------------

-- Defaults are `PING_CADENCE` from contracts, the values every handset has been
-- told since Phase 16, so a database that never touches these knobs behaves
-- exactly as it did.
ALTER TABLE "dispatch_config" ADD COLUMN "ping_on_job_ms" integer DEFAULT 3000 NOT NULL;--> statement-breakpoint
ALTER TABLE "dispatch_config" ADD COLUMN "ping_idle_ms" integer DEFAULT 10000 NOT NULL;--> statement-breakpoint

-- Bounds are wide but not unbounded. A cadence under a second is a battery
-- complaint from every driver at once; over five minutes the marker is offline
-- by `PRESENCE_OFFLINE_MS` long before the next fix, so it is a cadence that
-- cannot work rather than a preference.
ALTER TABLE "dispatch_config" ADD CONSTRAINT "ck_dispatch_config_ping_cadence"
  CHECK ("ping_on_job_ms" >= 1000 AND "ping_on_job_ms" <= 300000
     AND "ping_idle_ms" >= 1000 AND "ping_idle_ms" <= 300000);--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 4 · per-service max offers — the global layer of "per zone/service" (§6.4)
-- ---------------------------------------------------------------------------

-- `service_zones.dispatch_config.perService` has carried a per-SERVICE override
-- since Phase 14; what was missing is a platform-wide answer, so a city zone
-- with no override still offers a fuel delivery the same number of drivers as a
-- long flatbed haul. Object-of-serviceType shape, guarded like the zone column.
ALTER TABLE "dispatch_config" ADD COLUMN "per_service_max_offers" jsonb;--> statement-breakpoint

ALTER TABLE "dispatch_config" ADD CONSTRAINT "ck_dispatch_config_per_service_offers_object"
  CHECK ("per_service_max_offers" IS NULL OR jsonb_typeof("per_service_max_offers") = 'object');
