import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { COUPON_KINDS, PAYOUT_APPROVAL_STATES } from '@towing/api-contracts';
import { RATING_DIRECTIONS } from '../../db/schema/ratings';

/**
 * Migration 0016 and the code, held in step.
 *
 * THE THIRD SPEC OF THIS SHAPE, after `dispatch-invariants.spec.ts` (against
 * 0014) and `booking-state-machine.spec.ts` (against 0012). The convention
 * exists because a hand-written CHECK constraint that spells out a vocabulary
 * is a SECOND source of truth for a TypeScript union, and nothing mechanical
 * connects the two: add a value to the union and the constraint silently
 * rejects it at runtime, in production, on the newest and least-tested path.
 *
 * 0016 introduces three such pairs — rating directions, coupon kinds and payout
 * approval states — so it gets the same treatment.
 */

const MIGRATION = resolve(__dirname, '../../../drizzle/0016_money_capture_and_ratings.sql');

function migrationSql(): string {
  return readFileSync(MIGRATION, 'utf8');
}

/** The quoted-or-bare values inside the first `IN (...)` after a marker. */
function valuesIn(sql: string, marker: string): string[] {
  const from = sql.indexOf(marker);
  expect(from).toBeGreaterThan(-1);
  const open = sql.indexOf('IN (', from);
  const close = sql.indexOf(')', open);
  return sql
    .slice(open + 4, close)
    .split(',')
    .map((value) => value.trim().replace(/^'|'$/g, ''))
    .filter(Boolean);
}

describe('migration 0016 stays in step with the code', () => {
  it('ck_ratings_direction names exactly RATING_DIRECTIONS', () => {
    expect(valuesIn(migrationSql(), 'ck_ratings_direction').sort()).toEqual(
      [...RATING_DIRECTIONS].sort(),
    );
  });

  it('ck_coupons_kind names exactly COUPON_KINDS', () => {
    expect(valuesIn(migrationSql(), 'ck_coupons_kind').sort()).toEqual([...COUPON_KINDS].sort());
  });

  it('ck_payouts_approval_state names exactly PAYOUT_APPROVAL_STATES', () => {
    expect(valuesIn(migrationSql(), 'ck_payouts_approval_state').sort()).toEqual(
      [...PAYOUT_APPROVAL_STATES].sort(),
    );
  });

  it('ck_payments_purpose covers both collections against a booking', () => {
    // §3.5's cancellation fee is a separate collection against the same
    // booking, which is the whole reason `purpose` exists — and the reason
    // `uq_payments_one_captured_per_booking` is scoped to `booking`.
    expect(valuesIn(migrationSql(), 'ck_payments_purpose').sort()).toEqual([
      'booking',
      'cancellation_fee',
    ]);
  });

  it('the one-captured-per-booking index is scoped so a cancellation fee can coexist', () => {
    const sql = migrationSql();
    const from = sql.indexOf('uq_payments_one_captured_per_booking');
    expect(from).toBeGreaterThan(-1);

    // Without the `purpose` half of the predicate, collecting a cancellation
    // fee on a booking that had already been paid would be refused by a unique
    // violation — and the failure would surface as an opaque 500 on the cancel
    // path rather than anything a reader could connect to this index.
    const predicate = sql.slice(from, sql.indexOf(';', from));
    expect(predicate).toContain("\"status\" = 'captured'");
    expect(predicate).toContain("\"purpose\" = 'booking'");
  });

  it('ck_bookings_payout_within_total includes tax_amount', () => {
    const sql = migrationSql();
    // The name appears twice — a DROP IF EXISTS then the ADD — so take the last.
    const from = sql.lastIndexOf('"ck_bookings_payout_within_total"');
    expect(from).toBeGreaterThan(-1);

    // THE GST ARITHMETIC, ENFORCED BY THE DATABASE. The old form
    // (`commission_amount + driver_payout <= total`) stays TRUE once tax
    // exists but stops being TIGHT — with an 18 % rate the slack is exactly
    // the tax, so it would no longer catch a settlement that credited the
    // driver a share of the government's money. That is the single most likely
    // arithmetic mistake in Phase 19 (calling `creditBookingSettlement` with
    // `total` rather than the pre-tax taxable amount), and this constraint is
    // what turns it into a loud failure on the capture path.
    expect(sql.slice(from, sql.indexOf(';', from))).toContain('"tax_amount"');
  });

  it('the tax rate defaults to zero everywhere it appears', () => {
    const sql = migrationSql();

    // The entire premise of shipping GST-ready schema in this phase is that
    // nothing computes differently until somebody sets a rate. A non-zero
    // default anywhere would silently start charging tax on the deploy that
    // ran this migration.
    expect(sql).toContain('"tax_pct"    numeric(5,2)  NOT NULL DEFAULT 0.00');
    expect(sql).toContain('"tax_amount" numeric(12,2) NOT NULL DEFAULT 0.00');
    expect(sql).toContain('"tax_pct"   numeric(5,2) NOT NULL DEFAULT 0.00');
  });
});
