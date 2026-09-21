import {
  DISPUTE_EVIDENCE_KINDS,
  DISPUTE_LIABILITIES,
  DISPUTE_OPENED_BY_TYPES,
  DISPUTE_OPENED_FROM_STATUSES,
  DISPUTE_REASON_CODES,
  DISPUTE_RESOLUTIONS,
  DISPUTE_STATUSES,
  REFUND_KINDS,
} from '@towing/api-contracts';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Migration 0025 (W8): disputes, dispute evidence, `payments.refunded_amount`,
 * `refunds.dispute_id` + `refunds.kind`.
 *
 * House rule: every CHECK that duplicates a TypeScript union gets a spec test
 * pinning the SQL literals to the exported contract constant, so neither side
 * can drift. The partial unique test pins the exact predicate — `<> 'resolved'`,
 * not `= 'open'` — because "one OPEN dispute per booking, history may
 * accumulate" is the behaviour the resolver relies on.
 */

const MIGRATION = resolve(__dirname, '../../../drizzle/0025_admin_bookings_disputes.sql');

function migrationSql(): string {
  return readFileSync(MIGRATION, 'utf8');
}

/** Extract a `CHECK ("col" IN ('a', 'b', …))` literal list from a named constraint line. */
function checkList(sql: string, constraint: string): string[] {
  // The DROP CONSTRAINT line names the constraint too — take the line that
  // also carries the CHECK itself.
  const line = sql
    .split('\n')
    .find((candidate) => candidate.includes(`"${constraint}"`) && candidate.includes('CHECK'));
  if (!line) throw new Error(`constraint ${constraint} not found`);
  const match = /IN \(([^)]+)\)/.exec(line);
  if (!match) throw new Error(`no IN list on ${constraint}`);
  return match[1]!
    .split(',')
    .map((raw) => raw.trim().replace(/^'|'$/g, ''))
    .sort();
}

describe('migration 0025 admin bookings and disputes', () => {
  it('creates disputes with the origin pin and both money columns', () => {
    const sql = migrationSql();
    expect(sql).toContain('CREATE TABLE "disputes"');
    for (const column of [
      '"booking_id" uuid NOT NULL REFERENCES "bookings"("id") ON DELETE cascade',
      '"opened_from_status" text NOT NULL',
      '"refund_id" uuid REFERENCES "refunds"("id")',
      '"refund_amount" numeric(12, 2)',
      '"resolution" text',
      '"liability" text',
    ]) {
      expect(sql).toContain(column);
    }
  });

  it('makes one OPEN dispute per booking a database fact, with history allowed to accumulate', () => {
    const sql = migrationSql();
    const uniqueLine = sql
      .split('\n')
      .find((line) => line.includes('uq_disputes_open_per_booking'));
    expect(uniqueLine).toBeDefined();
    expect(sql).toContain(`WHERE "status" <> 'resolved'`);
    expect(sql).toContain('idx_disputes_status_created');
  });

  it('creates dispute_evidence cascading with its dispute', () => {
    const sql = migrationSql();
    expect(sql).toContain('CREATE TABLE "dispute_evidence"');
    expect(sql).toContain(
      '"dispute_id" uuid NOT NULL REFERENCES "disputes"("id") ON DELETE cascade',
    );
    expect(sql).toContain('idx_dispute_evidence_dispute');
  });

  it('adds payments.refunded_amount under the capture cap', () => {
    const sql = migrationSql();
    expect(sql).toContain(
      `ADD COLUMN IF NOT EXISTS "refunded_amount" numeric(12, 2) NOT NULL DEFAULT '0'`,
    );
    // Idempotent re-run shape + the cap itself.
    expect(sql).toContain('DROP CONSTRAINT IF EXISTS "ck_payments_refunded_within_amount"');
    expect(sql).toContain(`CHECK ("refunded_amount" >= 0 AND "refunded_amount" <= "amount")`);
  });

  it('adds refunds.dispute_id, refunds.kind, payment_id and liability with an idempotent CHECK swap', () => {
    const sql = migrationSql();
    expect(sql).toContain(`ADD COLUMN IF NOT EXISTS "dispute_id" uuid REFERENCES "disputes"("id")`);
    expect(sql).toContain(`ADD COLUMN IF NOT EXISTS "kind" text NOT NULL DEFAULT 'full'`);
    expect(sql).toContain(`ADD COLUMN IF NOT EXISTS "payment_id" uuid REFERENCES "payments"("id")`);
    expect(sql).toContain(`ADD COLUMN IF NOT EXISTS "liability" text`);
    expect(sql).toContain('DROP CONSTRAINT IF EXISTS "ck_refunds_kind"');
    expect(checkList(sql, 'ck_refunds_kind')).toEqual([...REFUND_KINDS].sort());
    expect(checkList(sql, 'ck_refunds_liability')).toEqual([...DISPUTE_LIABILITIES].sort());
  });

  it('pins every union CHECK to its contract constant', () => {
    const sql = migrationSql();
    expect(checkList(sql, 'ck_disputes_reason_code')).toEqual([...DISPUTE_REASON_CODES].sort());
    expect(checkList(sql, 'ck_disputes_status')).toEqual([...DISPUTE_STATUSES].sort());
    expect(checkList(sql, 'ck_disputes_resolution')).toEqual([...DISPUTE_RESOLUTIONS].sort());
    expect(checkList(sql, 'ck_disputes_liability')).toEqual([...DISPUTE_LIABILITIES].sort());
    expect(checkList(sql, 'ck_disputes_opened_by_type')).toEqual(
      [...DISPUTE_OPENED_BY_TYPES].sort(),
    );
    expect(checkList(sql, 'ck_disputes_opened_from_status')).toEqual(
      [...DISPUTE_OPENED_FROM_STATUSES].sort(),
    );
    expect(checkList(sql, 'ck_dispute_evidence_kind')).toEqual([...DISPUTE_EVIDENCE_KINDS].sort());
    expect(checkList(sql, 'ck_dispute_evidence_uploaded_by_type')).toEqual(
      [...DISPUTE_OPENED_BY_TYPES].sort(),
    );
  });

  it('keeps every statement drizzle-migrator separable and declares no backfills', () => {
    const sql = migrationSql();
    expect(sql).toContain('--> statement-breakpoint');
    expect(sql.toLowerCase()).toContain('backfills — none required');
  });
});
