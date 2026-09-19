import { appConfigSchema, redispatchPrioritySchema } from '@towing/api-contracts';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Migration 0027 (W12): `app_config`, and the last two §6.7/§11.3 knobs.
 *
 * House rule: every CHECK that duplicates a TypeScript union gets a spec
 * pinning the SQL literals to the exported contract constant.
 */

const MIGRATION = resolve(__dirname, '../../../drizzle/0027_app_and_ping_config.sql');

function migrationSql(): string {
  return readFileSync(MIGRATION, 'utf8');
}

/** Statements carrying the named constraint's CHECK — whitespace-normalised. */
function constraintLines(sql: string, constraint: string): string[] {
  return sql
    .split(';')
    .map((statement) => statement.replace(/\s+/g, ' '))
    .filter((statement) => statement.includes(`"${constraint}"`) && statement.includes('CHECK'));
}

/** `IN ('a', 'b')` literals from a constraint statement. */
function checkList(sql: string, constraint: string): string[] {
  const [statement] = constraintLines(sql, constraint);
  if (!statement) throw new Error(`constraint ${constraint} not found`);
  const match = /IN \(([^)]+)\)/.exec(statement);
  if (!match) throw new Error(`no IN list on ${constraint}`);
  return match[1]!
    .split(',')
    .map((raw) => raw.trim().replace(/^'|'$/g, ''))
    .sort();
}

describe('migration 0027 app and ping config', () => {
  it('creates app_config as a singleton with the version gate and the banner', () => {
    const sql = migrationSql();
    expect(sql).toContain('CREATE TABLE "app_config"');
    expect(sql).toContain('"min_customer_version" text DEFAULT \'1.0.0\' NOT NULL');
    expect(sql).toContain('"min_driver_version" text DEFAULT \'1.0.0\' NOT NULL');
    expect(sql).toContain('"force_upgrade" boolean DEFAULT false NOT NULL');
    expect(sql).toContain('"sev_message" text');
    expect(sql).toContain('"app_config_singleton_unique" UNIQUE("singleton")');
    expect(constraintLines(sql, 'ck_app_config_singleton').length).toBeGreaterThan(0);
  });

  it('keeps the SEV level and message a single decision', () => {
    const sql = migrationSql();
    const [pair] = constraintLines(sql, 'ck_app_config_sev_pair');
    expect(pair).toBeDefined();
    expect(pair).toContain('("sev_level" IS NULL) = ("sev_message" IS NULL)');
  });

  it('pins the SEV level list to the contract union', () => {
    const sql = migrationSql();
    // `appConfigSchema.sevLevel` is `.nullable()`, so unwrap to the enum.
    const contract = ([...appConfigSchema.shape.sevLevel.unwrap().options] as string[]).sort();
    expect(checkList(sql, 'ck_app_config_sev_level')).toEqual(contract);
  });

  it('seeds the launch row: nothing blocked, no banner', () => {
    const sql = migrationSql();
    expect(sql).toContain(
      `INSERT INTO "app_config" ("min_customer_version", "min_driver_version", "force_upgrade")`,
    );
    expect(sql).toContain(`VALUES ('1.0.0', '1.0.0', false)`);
  });

  it('adds the re-dispatch priority with its list pinned to the contract', () => {
    const sql = migrationSql();
    expect(sql).toContain(
      `ADD COLUMN "redispatch_priority" text DEFAULT 'front' NOT NULL`,
    );
    expect(checkList(sql, 'ck_dispatch_config_redispatch_priority')).toEqual(
      [...redispatchPrioritySchema.options].sort(),
    );
  });

  it('adds the ping cadence columns at the values every handset already knows', () => {
    const sql = migrationSql();
    expect(sql).toContain(`ADD COLUMN "ping_on_job_ms" integer DEFAULT 3000 NOT NULL`);
    expect(sql).toContain(`ADD COLUMN "ping_idle_ms" integer DEFAULT 10000 NOT NULL`);

    const [cadence] = constraintLines(sql, 'ck_dispatch_config_ping_cadence');
    expect(cadence).toBeDefined();
    // A sub-second cadence is a battery complaint; over five minutes the marker
    // is offline before the next fix. Both bounds hold for both columns.
    expect(cadence).toContain('"ping_on_job_ms" >= 1000');
    expect(cadence).toContain('"ping_on_job_ms" <= 300000');
    expect(cadence).toContain('"ping_idle_ms" >= 1000');
    expect(cadence).toContain('"ping_idle_ms" <= 300000');
  });

  it('adds the platform per-service offers as a guarded JSONB object', () => {
    const sql = migrationSql();
    expect(sql).toContain(`ADD COLUMN "per_service_max_offers" jsonb`);
    const [guard] = constraintLines(sql, 'ck_dispatch_config_per_service_offers_object');
    expect(guard).toBeDefined();
    expect(guard).toContain(`jsonb_typeof("per_service_max_offers") = 'object'`);
  });
});
