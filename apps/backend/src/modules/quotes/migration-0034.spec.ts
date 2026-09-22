import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { QUOTE_STATUSES as CONTRACT_STATUSES } from '@towing/api-contracts';
import { QUOTE_STATUSES } from '../../db/schema';

/**
 * Migration 0034 (W20): the manual-quote lane.
 *
 * One CHECK duplicates a union, and the house convention is to pin the SQL
 * against the TypeScript (`migration-0016.spec.ts`'s `ck_ratings_direction`).
 * Both unions — the contract's and the drizzle schema's — are checked, because
 * a drift between those two is what the CHECK was written to make impossible.
 */

const MIGRATION = resolve(__dirname, '../../../drizzle/0034_manual_quotes.sql');

function migrationSql(): string {
  return readFileSync(MIGRATION, 'utf8');
}

describe('migration 0034 manual quotes', () => {
  it('creates the quotes table with its indexes and foreign keys', () => {
    const sql = migrationSql();
    expect(sql).toContain('CREATE TABLE "quotes"');
    expect(sql).toContain('CREATE INDEX "idx_quotes_user"');
    expect(sql).toContain('CREATE INDEX "idx_quotes_status"');
    expect(sql).toContain('CONSTRAINT "quotes_user_id_users_id_fk"');
    expect(sql).toContain('CONSTRAINT "quotes_booking_id_bookings_id_fk"');
  });

  it('pins the status CHECK against both unions', () => {
    const sql = migrationSql();
    const check = /ck_quotes_status[^;]+CHECK \("status" IN \(([^)]+)\)\)/.exec(sql);
    expect(check).not.toBeNull();
    const body = check?.[1] ?? '';

    const fromSql = [...body.matchAll(/'([a-z_]+)'/g)].map((match) => match[1]);
    expect(fromSql).toEqual([...CONTRACT_STATUSES]);
    expect([...QUOTE_STATUSES]).toEqual([...CONTRACT_STATUSES]);
  });

  it('refuses a quoted row without its amounts', () => {
    const sql = migrationSql();
    // The amounts CHECK is what stops a bug pricing a job nobody reviewed:
    // `quoted` and `accepted` rows must carry a total and a commission pct,
    // while request/reject/expire may exist without ever having been priced.
    expect(sql).toContain('CONSTRAINT "ck_quotes_amounts" CHECK');
    expect(sql).toContain(`("status" IN ('requested', 'rejected', 'expired'))`);
    expect(sql).toContain(`("total_paise" IS NOT NULL AND "commission_pct" IS NOT NULL)`);
  });

  it('stores the operator decision fields the console renders', () => {
    const sql = migrationSql();
    expect(sql).toContain('"quoted_by" uuid');
    expect(sql).toContain('"valid_until" timestamp with time zone');
    expect(sql).toContain('"rejection_reason" text');
    expect(sql).toContain('"booking_id" uuid');
    expect(sql).toContain('"breakdown" jsonb');
  });
});
