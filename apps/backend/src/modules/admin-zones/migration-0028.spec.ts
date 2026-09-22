import {
  adminZoneSchema,
  adminZoneVersionSchema,
  geoJsonPolygonSchema,
} from '@towing/api-contracts';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Migration 0028 (W13): the zone editor's columns, its geometry rail, and the
 * version snapshots restore reads from.
 *
 * No union is duplicated here — `surge_band` and friends reuse the existing
 * zone CHECKs — so this spec pins the SHAPE of the change instead: the columns
 * the contract promises, the constraints that make them true, and the backfill
 * that makes every pre-existing zone a version 1.
 */

const MIGRATION = resolve(__dirname, '../../../drizzle/0028_zone_editor.sql');

function migrationSql(): string {
  return readFileSync(MIGRATION, 'utf8');
}

/** Statements carrying the named constraint — whitespace-normalised. */
function constraintLines(sql: string, constraint: string): string[] {
  return sql
    .split(';')
    .map((statement) => statement.replace(/\s+/g, ' '))
    .filter((statement) => statement.includes(`"${constraint}"`) && statement.includes('CHECK'));
}

describe('migration 0028 zone editor', () => {
  it('gives every zone an operator-facing code, backfilled and unique', () => {
    const sql = migrationSql();
    expect(sql).toContain(`ADD COLUMN "code" text`);
    expect(sql).toContain(`UNIQUE ("code")`);
    // Backfill BEFORE the NOT NULL: existing rows predate the column.
    const backfill = sql.indexOf('UPDATE "service_zones"');
    const notNull = sql.indexOf(`ALTER COLUMN "code" SET NOT NULL`);
    expect(backfill).toBeGreaterThan(-1);
    expect(notNull).toBeGreaterThan(backfill);
    expect(adminZoneSchema.shape.code.safeParse('zone-1a2b3c4d').success).toBe(true);
  });

  it('adds the editor columns: notes, who touched it, and the version it is on', () => {
    const sql = migrationSql();
    expect(sql).toContain(`ADD COLUMN "notes" text`);
    expect(sql).toContain(`ADD COLUMN "updated_by" uuid`);
    expect(sql).toContain(`ADD COLUMN "version" integer DEFAULT 1 NOT NULL`);
    expect(sql).toContain('REFERENCES "admin_users"("id")');
    expect(adminZoneSchema.shape.version.safeParse(1).success).toBe(true);
  });

  it('refuses a polygon PostGIS considers invalid, at the table level', () => {
    const sql = migrationSql();
    const [rail] = constraintLines(sql, 'ck_service_zones_area_valid');
    expect(rail).toBeDefined();
    // The geometry cast is what makes ST_IsValid usable on a geography column.
    expect(rail).toContain('ST_IsValid("area"::geometry)');
    // The service says the same thing in words before the insert is attempted.
    expect(geoJsonPolygonSchema.safeParse({ type: 'Polygon', coordinates: [] }).success).toBe(
      false,
    );
  });

  it('snapshots every edit in service_zone_versions', () => {
    const sql = migrationSql();
    expect(sql).toContain('CREATE TABLE "service_zone_versions"');
    for (const column of [
      '"version" integer NOT NULL',
      '"area_geojson" jsonb NOT NULL',
      '"surge_band" "surge_band" NOT NULL',
      '"is_highway" boolean NOT NULL',
      '"is_active" boolean NOT NULL',
      '"dispatch_config" jsonb',
      '"changed_by" uuid',
      '"reason" text',
    ]) {
      expect(sql).toContain(column);
    }
    expect(sql).toContain(`UNIQUE ("zone_id", "version")`);
    // Deleting a zone takes its history with it — no orphans, no FK sweep.
    expect(sql).toContain('ON DELETE cascade');
    expect(adminZoneVersionSchema.shape.version.safeParse(1).success).toBe(true);
  });

  it('backfills version 1 for the zones that already exist', () => {
    const sql = migrationSql();
    expect(sql).toContain('INSERT INTO "service_zone_versions"');
    expect(sql).toContain('ST_AsGeoJSON("area"::geometry)::jsonb');
    expect(sql).toContain('Seeded before the zone editor (W13)');
  });
});
