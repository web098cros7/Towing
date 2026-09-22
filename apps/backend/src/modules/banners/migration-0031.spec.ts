import { BANNER_AUDIENCES } from '@towing/api-contracts';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Migration 0031 (W16): the `banners` table, its audience union, its window
 * CHECK and the partial live index.
 *
 * The audience CHECK duplicates the `BANNER_AUDIENCES` contract union by
 * design (house rule: a migration spec wherever a CHECK duplicates a union),
 * so it is pinned here. The partial index gets its own assertion because it is
 * the public read's whole predicate — removing it would not change a single
 * test outcome, only production latency, which is exactly the quiet kind of
 * regression this spec exists to stop.
 */

const MIGRATION = resolve(__dirname, '../../../drizzle/0031_promotions_banners.sql');

function migrationSql(): string {
  return readFileSync(MIGRATION, 'utf8');
}

/** The literals of a named `CHECK (... IN (...))`, whitespace-normalised. */
function checkLiterals(sql: string, constraint: string): string[] {
  const statement = sql
    .split(';')
    .map((part) => part.replace(/\s+/g, ' '))
    .find((part) => part.includes(`"${constraint}"`));
  expect(statement, constraint).toBeDefined();

  const at = statement!.indexOf(`"${constraint}"`);
  const match = /IN \(([^)]+)\)/.exec(statement!.slice(at));
  expect(match, `${constraint} has an IN list`).toBeTruthy();
  return match![1]!
    .split(',')
    .map((raw) => raw.trim().replace(/^'|'$/g, ''))
    .sort();
}

const sorted = (values: readonly string[]): string[] => [...values].sort();

describe('migration 0031 promotions banners', () => {
  it('creates the table', () => {
    const sql = migrationSql();
    expect(sql).toContain('CREATE TABLE "banners"');
    expect(sql).toContain('"image_key" text NOT NULL');
    expect(sql).toContain('"created_by" uuid REFERENCES "admin_users"("id")');
  });

  it('pins the audience union to the CHECK', () => {
    expect(checkLiterals(migrationSql(), 'ck_banners_audience')).toEqual(sorted(BANNER_AUDIENCES));
  });

  it('refuses a window that ends before it starts (allowing open ends)', () => {
    const sql = migrationSql();
    expect(sql).toContain('ck_banners_window');
    expect(sql).toContain('"starts_at" IS NULL OR "ends_at" IS NULL OR "starts_at" < "ends_at"');
  });

  it('indexes the live read (audience, sort_order) partially on is_active', () => {
    const sql = migrationSql();
    expect(sql).toContain(
      'CREATE INDEX "idx_banners_live" ON "banners" ("audience", "sort_order")',
    );
    expect(sql).toContain('WHERE "is_active"');
  });
});
