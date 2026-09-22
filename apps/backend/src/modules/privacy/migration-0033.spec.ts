import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DELETION_REQUEST_STATUSES } from '@towing/api-contracts';
import {
  OPEN_DELETION_REQUEST_STATUSES,
  DELETION_REQUEST_STATUSES as STATUSES_ROW,
} from '../../db/schema';
import { RETENTION_POLICY_DEFAULTS, SWEPT_POLICY_KEYS } from '../privacy/retention';

/**
 * Migration 0033 (W19): the privacy/retention tables and the widened
 * deletion-request workflow.
 *
 * The two CHECKs here duplicate TypeScript unions, and the retention seed
 * duplicates `RETENTION_POLICY_DEFAULTS` — the house convention for both is to
 * pin the SQL against the code (`migration-0016.spec.ts` does the same for
 * `ck_ratings_direction`). The partial unique index's predicate is the third
 * duplicate: it must match `OPEN_DELETION_REQUEST_STATUSES`, or the one-open-
 * request rule and the badge's SQL would disagree about "open".
 */

const MIGRATION = resolve(__dirname, '../../../drizzle/0033_privacy_retention.sql');

function migrationSql(): string {
  return readFileSync(MIGRATION, 'utf8');
}

describe('migration 0033 privacy retention', () => {
  it('creates the retention and erasure tables', () => {
    const sql = migrationSql();
    expect(sql).toContain('CREATE TABLE "retention_policies"');
    expect(sql).toContain('CREATE TABLE "erasure_jobs"');
    expect(sql).toContain('CREATE UNIQUE INDEX "uq_retention_policies_key"');
  });

  it('widens deletion_requests with the workflow columns', () => {
    const sql = migrationSql();
    expect(sql).toContain('ADD COLUMN "hold_reason" text');
    expect(sql).toContain('ADD COLUMN "decided_by" uuid REFERENCES "admin_users"("id")');
    expect(sql).toContain('ADD COLUMN "decided_at" timestamp with time zone');
    expect(sql).toContain('ADD COLUMN "executed_at" timestamp with time zone');
    expect(sql).toContain('ADD COLUMN "anonymised_at" timestamp with time zone');
  });

  it('pins the status CHECK against the contract union', () => {
    const sql = migrationSql();
    const check = /ck_deletion_requests_status[^;]+CHECK \("status" IN \(([^)]+)\)\)/.exec(sql);
    expect(check).not.toBeNull();
    const checkBody = check?.[1] ?? '';

    const fromSql = [...checkBody.matchAll(/'([a-z_]+)'/g)].map((match) => match[1]);
    expect(fromSql).toEqual([...DELETION_REQUEST_STATUSES]);
    // And the drizzle-side union is the same list, so a future edit has to be
    // made in one more place than the one it was written in.
    expect([...STATUSES_ROW]).toEqual([...DELETION_REQUEST_STATUSES]);
  });

  it('restates the open-request index over exactly the open statuses', () => {
    const sql = migrationSql();
    expect(sql).toContain('DROP INDEX "uq_deletion_requests_one_open_per_subject"');
    const predicate =
      /uq_deletion_requests_one_open_per_subject[^;]+WHERE "status" IN \(([^)]+)\)/.exec(sql);
    expect(predicate).not.toBeNull();
    const predicateBody = predicate?.[1] ?? '';

    const fromSql = [...predicateBody.matchAll(/'([a-z_]+)'/g)].map((match) => match[1]);
    expect(fromSql).toEqual([...OPEN_DELETION_REQUEST_STATUSES]);
  });

  it('seeds exactly the G16 policy rows the code declares', () => {
    const sql = migrationSql();
    for (const policy of RETENTION_POLICY_DEFAULTS) {
      expect(sql).toContain(
        `('${policy.policyKey}', ${policy.retentionDays}, '${policy.description.replaceAll("'", "''")}')`,
      );
    }
    // And the sweep's enforced subset is a subset of the seeded keys — a typo
    // here would make the sweep silently skip a policy forever.
    const seeded = new Set(RETENTION_POLICY_DEFAULTS.map((policy) => policy.policyKey));
    for (const key of SWEPT_POLICY_KEYS) {
      expect(seeded.has(key)).toBe(true);
    }
  });

  it('constrains erasure job statuses and subject types', () => {
    const sql = migrationSql();
    expect(sql).toContain("CHECK (\"status\" IN ('queued', 'running', 'completed', 'failed'))");
    expect(sql).toContain("CHECK (\"subject_type\" IN ('user', 'driver'))");
  });
});
