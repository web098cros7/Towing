import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ATTEMPT_OUTCOMES } from './dispatch.repo';

/**
 * Migration 0023 (W5): the dispatch inspector table and the widened outcome CHECK.
 *
 * NOTE: `ck_dispatch_attempts_outcome` duplicates `ATTEMPT_OUTCOMES` by design
 * (house rule: a migration spec wherever a CHECK duplicates a TypeScript
 * union). The last test pins the two together, so the next outcome value cannot
 * land on one side only — `reassigned` ships here ahead of W8's writer on
 * purpose, and that ordering only works if the two lists keep agreeing.
 */

const MIGRATION = resolve(__dirname, '../../../drizzle/0023_dispatch_inspector.sql');

function migrationSql(): string {
  return readFileSync(MIGRATION, 'utf8');
}

describe('migration 0023 dispatch inspector', () => {
  it('creates dispatch_wave_logs with the counters the inspector reads', () => {
    const sql = migrationSql();
    expect(sql).toContain('CREATE TABLE "dispatch_wave_logs"');
    for (const column of [
      '"wave" integer NOT NULL',
      '"radius_km" numeric(6, 2) NOT NULL',
      '"considered" integer NOT NULL',
      '"eligible" integer NOT NULL',
      '"offered" integer NOT NULL',
      '"degraded" boolean DEFAULT false NOT NULL',
      '"weights" jsonb NOT NULL',
      '"config" jsonb NOT NULL',
      '"excluded" jsonb NOT NULL',
      '"candidates" jsonb NOT NULL',
      '"ran_at" timestamp with time zone DEFAULT now() NOT NULL',
      '"duration_ms" integer NOT NULL',
    ]) {
      expect(sql).toContain(column);
    }
  });

  it('cascades with the booking — the log must not outlive what it describes', () => {
    const sql = migrationSql();
    const fkLine = sql
      .split('\n')
      .find((line) => line.includes('dispatch_wave_logs_booking_id_bookings_id_fk'));
    expect(fkLine).toBeDefined();
    expect(fkLine).toContain('ON DELETE cascade');
  });

  it('indexes the per-booking read and the W17 purge', () => {
    const sql = migrationSql();
    expect(sql).toContain('uq_dispatch_wave_logs_wave_ran');
    expect(sql).toContain('idx_dispatch_wave_logs_booking_wave');
    expect(sql).toContain('idx_dispatch_wave_logs_ran_at');
  });

  it('widens the outcome CHECK rather than recreating the table', () => {
    const sql = migrationSql();
    expect(sql).toContain('DROP CONSTRAINT IF EXISTS "ck_dispatch_attempts_outcome"');
    expect(sql).toContain('ADD CONSTRAINT "ck_dispatch_attempts_outcome"');
    // The 0014 rationale: a CHECK over an enum so a widening is one reversible
    // line. Recreating `dispatch_attempts` here would be a different migration.
    expect(sql).not.toContain('CREATE TABLE "dispatch_attempts"');
  });

  it('keeps every statement drizzle-migrator separable and ends with no backfill', () => {
    const sql = migrationSql();
    expect(sql).toContain('--> statement-breakpoint');
    expect(sql.toLowerCase()).toContain('backfills');
  });

  it('pins the outcome union to the CHECK — no value can exist on one side only', () => {
    const sql = migrationSql();
    const check = /CHECK \("outcome" IN \(([^)]+)\)\)/.exec(sql);
    expect(check).toBeTruthy();

    const literals = check![1]!
      .split(',')
      .map((raw) => raw.trim().replace(/^'|'$/g, ''))
      .sort();
    expect([...ATTEMPT_OUTCOMES].sort()).toEqual(literals);
  });
});
