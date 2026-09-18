import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Migration 0021 and the W2 login state it hosts, held in step.
 *
 * `twofa_last_counter` is what makes TOTP replay refusal possible (a valid
 * code on a fresh challenge is otherwise indistinguishable from first use),
 * and `must_change_password` is what keeps a reset-issued temporary password
 * from becoming a standing credential. Both are behaviour-neutral DDL until
 * W2-4 reads them — proven by the suite staying green underneath.
 */

const MIGRATION = resolve(__dirname, '../../../drizzle/0021_admin_totp_login.sql');

function migrationSql(): string {
  return readFileSync(MIGRATION, 'utf8');
}

describe('migration 0021 admin TOTP login state', () => {
  it('adds a nullable TOTP replay counter', () => {
    const sql = migrationSql();
    expect(sql).toContain(
      'ALTER TABLE "admin_users" ADD COLUMN IF NOT EXISTS "twofa_last_counter" integer',
    );
  });

  it('adds a default-false forced-change flag', () => {
    const sql = migrationSql();
    expect(sql).toContain(
      'ALTER TABLE "admin_users" ADD COLUMN IF NOT EXISTS "must_change_password" boolean NOT NULL DEFAULT false',
    );
  });

  it('keeps every statement drizzle-migrator separable', () => {
    const sql = migrationSql();
    expect(sql).toContain('--> statement-breakpoint');
  });
});
