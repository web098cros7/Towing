--
-- ===========================================================================
-- W13 — the service-zone editor's persistence: identity, versions, and the
-- geometry rail.
--
-- Today zones exist only from the seed: `service_zones` has no code, no
-- version, no author and no guard on its polygon, and nothing in the repo has
-- ever called ST_GeomFromGeoJSON or ST_IsValid. §9.4.8 asks an operator to draw
-- a service area; this migration is what makes that a stateful feature rather
-- than a destructive one.
--
-- Three groups:
--   1 · service_zones gains `code` (a human key the console can cite),
--       `notes`, `updated_by`, `version`, and a `ST_IsValid` CHECK — the
--       geometry rail. A self-intersecting polygon is not a service area, and
--       the database is where that is cheapest to refuse;
--   2 · `service_zone_versions` — §9.4.8's "versioned", and what makes
--       RESTORE possible. The GeoJSON is stored, not the geography: a restore
--       is `ST_GeomFromGeoJSON` back into the column, and the stored text is
--       readable in a diff;
--   3 · a backfill: one version row per existing zone, marked as the seed's.
--
-- Hand-written, like every migration from 0002 onward. Journal idx 28.
-- ===========================================================================
--

-- ---------------------------------------------------------------------------
-- 1 · service_zones — identity, authorship, version, and the geometry check
-- ---------------------------------------------------------------------------

ALTER TABLE "service_zones" ADD COLUMN "code" text;--> statement-breakpoint

-- Backfilled from the id, not from the name: `name` is not unique (nothing has
-- ever stopped two zones being called "Bengaluru Metro"), and a key the console
-- cites has to be unique by construction.
UPDATE "service_zones"
   SET "code" = 'zone-' || left(replace("id"::text, '-', ''), 8)
 WHERE "code" IS NULL;--> statement-breakpoint

ALTER TABLE "service_zones" ALTER COLUMN "code" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "service_zones" ADD CONSTRAINT "uq_service_zones_code" UNIQUE ("code");--> statement-breakpoint

ALTER TABLE "service_zones" ADD COLUMN "notes" text;--> statement-breakpoint
ALTER TABLE "service_zones" ADD COLUMN "updated_by" uuid REFERENCES "admin_users"("id");--> statement-breakpoint

-- The number of the CURRENT shape. `service_zone_versions` holds every shape
-- that number has named; a restore writes a NEW version whose geometry happens
-- to match an old one, which is what keeps the history append-only.
ALTER TABLE "service_zones" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint

-- THE GEOMETRY RAIL. `assertZoneGeometry` refuses a self-intersecting ring with
-- `ST_IsValidReason` in the 422 details, and this is the backstop for anything
-- that reaches the table by another route (a seed script, a hand-run UPDATE).
-- `area::geometry` because ST_IsValid is a geometry function; the column stays
-- geography so `ST_Covers` stays index-accelerated for the resolver.
ALTER TABLE "service_zones" ADD CONSTRAINT "ck_service_zones_area_valid"
  CHECK (ST_IsValid("area"::geometry));--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 2 · service_zone_versions — §9.4.8's "versioned", restored from GeoJSON
-- ---------------------------------------------------------------------------

CREATE TABLE "service_zone_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"zone_id" uuid NOT NULL REFERENCES "service_zones"("id") ON DELETE cascade,
	"version" integer NOT NULL,
	"area_geojson" jsonb NOT NULL,
	"surge_band" "surge_band" NOT NULL,
	"is_highway" boolean NOT NULL,
	"is_active" boolean NOT NULL,
	"dispatch_config" jsonb,
	"changed_by" uuid REFERENCES "admin_users"("id"),
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_service_zone_versions_zone_version" UNIQUE ("zone_id", "version")
);--> statement-breakpoint

-- Newest-first per zone is the only read: the drawer lists a zone's shapes and
-- offers to restore one.
CREATE INDEX "idx_service_zone_versions_zone_created"
  ON "service_zone_versions" ("zone_id", "created_at" DESC NULLS LAST);--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 3 · Backfill: every existing zone gets a version-1 row
-- ---------------------------------------------------------------------------

-- The seed's shapes predate the editor. Marking them as version 1 (rather than
-- leaving the table empty) is what makes "restore the previous shape" work on a
-- zone somebody has ALREADY reshaped once — the row that holds the shape they
-- want to get back.
INSERT INTO "service_zone_versions"
  ("zone_id", "version", "area_geojson", "surge_band", "is_highway", "is_active", "dispatch_config", "reason")
SELECT "id", 1, ST_AsGeoJSON("area"::geometry)::jsonb, "surge_band", "is_highway", "is_active", "dispatch_config",
       'Seeded before the zone editor (W13)'
  FROM "service_zones";
