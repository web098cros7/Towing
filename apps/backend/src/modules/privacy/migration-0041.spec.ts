import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { RETENTION_POLICY_DEFAULTS, SWEPT_POLICY_KEYS } from './retention';

/**
 * Migration 0041: the chat's retention row.
 *
 * House rule (see `migration-0033.spec.ts`): a seeded policy row is pinned to
 * `RETENTION_POLICY_DEFAULTS`, so the database's schedule and the code's
 * defaults cannot drift. 0033 pins the original six; this pins the seventh.
 */
const MIGRATION = resolve(__dirname, '../../../drizzle/0041_chat_retention.sql');

describe('migration 0041 — chat retention', () => {
  const sql = readFileSync(MIGRATION, 'utf8');
  const chat = RETENTION_POLICY_DEFAULTS.find((policy) => policy.policyKey === 'chat_messages');

  it('seeds exactly the row the code declares, without overwriting an operator edit', () => {
    expect(chat).toBeDefined();
    expect(sql).toContain(
      `('${chat!.policyKey}', ${chat!.retentionDays}, '${chat!.description.replaceAll("'", "''")}')`,
    );
    expect(sql).toContain('ON CONFLICT ("policy_key") DO NOTHING');
  });

  it('is a policy the sweep actually enforces', () => {
    expect(SWEPT_POLICY_KEYS).toContain('chat_messages');
  });
});
