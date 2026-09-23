import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fleetDriverPayModelSchema, jobEarningsSchema } from '@towing/api-contracts';

/**
 * Migration 0042: fleet driver pay.
 *
 * House rule (see `migration-0033.spec.ts`): a CHECK list is pinned to the
 * contract it guards, so a value added to one side cannot be refused by the
 * other at runtime.
 */
const MIGRATION = resolve(__dirname, '../../../drizzle/0042_fleet_driver_pay.sql');
const quoted = (values: readonly string[]) => values.map((value) => `'${value}'`).join(', ');

describe('migration 0042 — fleet driver pay', () => {
  const sql = readFileSync(MIGRATION, 'utf8');

  it("pins the fleet's model to the settings contract", () => {
    expect(sql).toContain(
      `CHECK ("driver_pay_model" IN (${quoted(fleetDriverPayModelSchema.options)}))`,
    );
  });

  it("pins the booking's locked model to the driver job contract", () => {
    expect(sql).toContain(
      `"driver_pay_model" IN (${quoted(jobEarningsSchema.shape.payModel.options)})`,
    );
  });

  it("defaults every existing fleet to the spec's 80/20 share", () => {
    expect(sql).toContain(`"driver_pay_model" text NOT NULL DEFAULT 'share'`);
    expect(sql).toContain(`"driver_share_pct" numeric(5, 2) NOT NULL DEFAULT 80`);
  });
});
