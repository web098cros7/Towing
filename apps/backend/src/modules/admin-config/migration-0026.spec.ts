import { adminCommissionProposalSchema } from '@towing/api-contracts';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Migration 0026 (W11): the commission guardrail becomes a row, the two CHECKs
 * relax to the absolute outer bound, and Operations gets a propose table.
 *
 * House rule: every CHECK that duplicates a TypeScript union gets a spec pinning
 * the SQL literals to the exported contract constant. This one is a little
 * different from its siblings because the migration mostly DROPS constraints —
 * so the assertions it must make are:
 *
 *   • the two old CHECKs are gone and the new ones carry the OUTER bound, not
 *     the 5–10 window (a "relaxation" that quietly kept 5–10 would make decision
 *     G2 unreachable while looking correct);
 *   • the window itself landed in the table, seeded at the launch values;
 *   • the proposals status list matches the contract's union.
 */

const MIGRATION = resolve(__dirname, '../../../drizzle/0026_commission_guardrail.sql');

function migrationSql(): string {
  return readFileSync(MIGRATION, 'utf8');
}

/** Statements carrying the named constraint's CHECK — whitespace-normalised, because drizzle-kit style puts `CHECK` on the following line. */
function constraintLines(sql: string, constraint: string): string[] {
  return sql
    .split(';')
    .map((statement) => statement.replace(/\s+/g, ' '))
    .filter(
      (statement) => statement.includes(`"${constraint}"`) && statement.includes('CHECK'),
    );
}

describe('migration 0026 commission guardrail', () => {
  it('creates commission_guardrail as a singleton with floor/cap columns', () => {
    const sql = migrationSql();
    expect(sql).toContain('CREATE TABLE "commission_guardrail"');
    expect(sql).toContain('"floor_pct" numeric(5, 2) NOT NULL');
    expect(sql).toContain('"cap_pct" numeric(5, 2) NOT NULL');
    expect(sql).toContain('"commission_guardrail_singleton_unique" UNIQUE("singleton")');
    expect(constraintLines(sql, 'ck_commission_guardrail_singleton').length).toBeGreaterThan(0);
  });

  it('bounds the window at the ABSOLUTE outer bound decision G2 names, not 5–10', () => {
    const sql = migrationSql();
    const [bounds] = constraintLines(sql, 'ck_commission_guardrail_bounds');
    expect(bounds).toBeDefined();
    expect(bounds).toContain('"floor_pct" > 0');
    expect(bounds).toContain('"cap_pct" <= 30');
    expect(bounds).toContain('"floor_pct" < "cap_pct"');
  });

  it('SEEDS the launch window so a fresh database behaves as it did before', () => {
    const sql = migrationSql();
    expect(sql).toContain(
      `INSERT INTO "commission_guardrail" ("floor_pct", "cap_pct") VALUES (5.00, 10.00)`,
    );
  });

  it('relaxes BOTH old guardrails to 0 < pct <= 30, in lockstep', () => {
    const sql = migrationSql();

    // The two constraints that used to hold 5–10 are dropped…
    expect(sql).toContain(`DROP CONSTRAINT "ck_commission_config_guardrail"`);
    expect(sql).toContain(`DROP CONSTRAINT "ck_bookings_commission_pct_guardrail"`);

    // …and re-added at the outer bound. The BOOKING column matters as much as
    // the config table: if it kept 5–10, a window widened to 12 in the table
    // would fail later as an insert error on the first booking, which is the
    // unattributable failure 0011's comment warns about.
    const configCheck = constraintLines(sql, 'ck_commission_config_guardrail');
    const bookingCheck = constraintLines(sql, 'ck_bookings_commission_pct_guardrail');
    expect(configCheck.some((line) => line.includes('"pct" > 0') && line.includes('"pct" <= 30'))).toBe(
      true,
    );
    expect(
      bookingCheck.some(
        (line) => line.includes('"commission_pct" > 0') && line.includes('"commission_pct" <= 30'),
      ),
    ).toBe(true);
  });

  it('creates commission_proposals with the status CHECK pinned to the contract union', () => {
    const sql = migrationSql();
    expect(sql).toContain('CREATE TABLE "commission_proposals"');

    const [statusLine] = constraintLines(sql, 'ck_commission_proposals_status');
    expect(statusLine).toBeDefined();
    const literals = /IN \(([^)]+)\)/
      .exec(statusLine!)![1]!
      .split(',')
      .map((raw) => raw.trim().replace(/^'|'$/g, ''))
      .sort();

    expect(literals).toEqual([...adminCommissionProposalSchema.shape.status.options].sort());
  });

  it('makes one OPEN proposal per band a database fact', () => {
    const sql = migrationSql();
    expect(sql).toContain('CREATE UNIQUE INDEX "uq_commission_proposals_open"');
    expect(sql).toContain(`WHERE "status" = 'open'`);
    expect(sql).toContain('idx_commission_proposals_status_created');
  });
});
