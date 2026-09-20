import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Migration 0032 (W17): the four rollup tables and the §22.1 tracker.
 *
 * No CHECK duplicates a union here (`analytics_events.name` is deliberately
 * free text — the vocabulary grows per phase and the `admin_actions.action`
 * precedent applies), so this spec pins the STRUCTURAL promises the code
 * relies on: the composite primary keys the delete-then-insert recompute
 * depends on, the SET NULL that lets a rollup night survive an erased
 * booking, and the tracker's time index.
 */

const MIGRATION = resolve(__dirname, '../../../drizzle/0032_analytics_rollups.sql');

function migrationSql(): string {
  return readFileSync(MIGRATION, 'utf8');
}

describe('migration 0032 analytics rollups', () => {
  it('creates the four rollup tables and the tracker', () => {
    const sql = migrationSql();
    expect(sql).toContain('CREATE TABLE "analytics_daily"');
    expect(sql).toContain('CREATE TABLE "analytics_zone_daily"');
    expect(sql).toContain('CREATE TABLE "analytics_band_daily"');
    expect(sql).toContain('CREATE TABLE "analytics_demand_grid"');
    expect(sql).toContain('CREATE TABLE "analytics_events"');
  });

  it('pins the grain of each table with its primary key', () => {
    const sql = migrationSql();
    expect(sql).toContain('"day" date PRIMARY KEY');
    expect(sql).toContain('PRIMARY KEY ("day", "zone_id")');
    expect(sql).toContain('PRIMARY KEY ("day", "band")');
    expect(sql).toContain('PRIMARY KEY ("day", "hour", "cell_lat", "cell_lng")');
  });

  it('stores money as bigint, and on-time as a nullable column', () => {
    const sql = migrationSql();
    expect(sql).toContain('"gmv_paise" bigint NOT NULL DEFAULT 0');
    expect(sql).toContain('"on_time_bps" integer');
    // The nullable marker matters: on_time_bps is ALWAYS NULL until a
    // promised-ETA column exists (see the file header) and a NOT NULL would
    // force a fake zero.
    expect(sql).not.toContain('"on_time_bps" integer NOT NULL');
  });

  it('keeps the tracker alive past an erased booking and indexed by name+time', () => {
    const sql = migrationSql();
    expect(sql).toContain('"booking_id" uuid REFERENCES "bookings"("id") ON DELETE SET NULL');
    expect(sql).toContain('CREATE INDEX "idx_analytics_events_name_time"');
    expect(sql).toContain('CREATE INDEX "idx_analytics_events_booking"');
  });
});
