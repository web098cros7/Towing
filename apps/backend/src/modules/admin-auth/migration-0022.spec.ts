import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Migration 0022 extends 0019's trigger (which is frozen — applied
 * everywhere, never edited): a `password_hash` write now also bumps
 * `authz_version`, so a password reset invalidates live access tokens within
 * the A17 window instead of leaving them valid for 900 s after the refresh
 * family is revoked. `admin-users.e2e.spec.ts` proves the behaviour (reset →
 * old access token 401s); this spec pins the DDL half.
 */

const MIGRATION = resolve(__dirname, '../../../drizzle/0022_admin_authz_trigger_password.sql');

function migrationSql(): string {
  return readFileSync(MIGRATION, 'utf8');
}

describe('migration 0022 bumps authz_version on credential changes', () => {
  it('replaces the bump function watching sub_role, status AND password_hash', () => {
    const sql = migrationSql();
    expect(sql).toContain('CREATE OR REPLACE FUNCTION "bump_admin_authz_version"');
    expect(sql).toContain('NEW."sub_role" IS DISTINCT FROM OLD."sub_role"');
    expect(sql).toContain('NEW."status" IS DISTINCT FROM OLD."status"');
    expect(sql).toContain('NEW."password_hash" IS DISTINCT FROM OLD."password_hash"');
    expect(sql).toContain('NEW."authz_version" := OLD."authz_version" + 1');
  });

  it('re-creates the BEFORE UPDATE row trigger on admin_users', () => {
    const sql = migrationSql();
    expect(sql).toContain('DROP TRIGGER IF EXISTS "trg_admin_authz_version" ON "admin_users"');
    expect(sql).toContain('BEFORE UPDATE ON "admin_users"');
    expect(sql).toContain('FOR EACH ROW EXECUTE FUNCTION "bump_admin_authz_version"()');
  });

  it('keeps every statement drizzle-migrator separable', () => {
    const sql = migrationSql();
    expect(sql).toContain('--> statement-breakpoint');
  });
});
