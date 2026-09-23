import { DISPUTE_LIABILITIES, REFUND_CAUSES, REFUND_DELIVERIES } from '@towing/api-contracts';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Migration 0040 (ADM-6): a partial refund's cause decides who pays.
 *
 * House rule: every CHECK that duplicates a TypeScript union is pinned to the
 * exported contract constant, so the database and the API cannot drift apart.
 * A cause or bearer the contract accepts but the CHECK refuses would surface
 * as a 500 on the admin's refund, after nothing moved; the reverse would let a
 * value in that the console cannot render.
 */
const MIGRATION = resolve(__dirname, '../../../drizzle/0040_refund_causes.sql');

function checkList(sql: string, constraint: string): string[] {
  const line = sql
    .split('\n')
    .find((candidate) => candidate.includes(`"${constraint}"`) && candidate.includes('CHECK'));
  if (!line) throw new Error(`constraint ${constraint} not found`);
  const match = /IN \(([^)]+)\)/.exec(line);
  if (!match) throw new Error(`constraint ${constraint} has no IN list`);
  return match[1]!
    .split(',')
    .map((value) => value.trim().replace(/^'|'$/g, ''))
    .sort();
}

describe('migration 0040 — refund causes', () => {
  const sql = readFileSync(MIGRATION, 'utf8');

  it('widens both liability CHECKs to the contract, keeping the pre-ADM-6 values', () => {
    expect(checkList(sql, 'ck_refunds_liability')).toEqual([...DISPUTE_LIABILITIES].sort());
    expect(checkList(sql, 'ck_disputes_liability')).toEqual([...DISPUTE_LIABILITIES].sort());
    // History is read, never rewritten: the old hand-picked values stay legal.
    expect(DISPUTE_LIABILITIES).toEqual(expect.arrayContaining(['driver', 'fleet']));
  });

  it('pins the cause and delivery CHECKs to the contract', () => {
    expect(checkList(sql, 'ck_refunds_cause')).toEqual([...REFUND_CAUSES].sort());
    expect(checkList(sql, 'ck_refunds_delivery')).toEqual([...REFUND_DELIVERIES].sort());
  });

  it('keeps the driver share inside the refund, and every existing refund legal', () => {
    // Nullable, so rows issued before 0040 need no backfill; bounded by the
    // refund's own amount, so a stored share can never exceed what was refunded.
    expect(sql).toContain(`ADD COLUMN IF NOT EXISTS "provider_share" numeric(12, 2)`);
    expect(sql).toContain(
      `CHECK ("provider_share" IS NULL OR ("provider_share" >= 0 AND "provider_share" <= "amount"))`,
    );
    expect(sql).toContain(`ADD COLUMN IF NOT EXISTS "delivery" text NOT NULL DEFAULT 'original'`);
  });
});
