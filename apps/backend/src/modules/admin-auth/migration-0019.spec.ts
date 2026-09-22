import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Migration 0019 and the guard, held in step.
 *
 * 0018 added `authz_version` but trusted every writer to bump it — a manual
 * SQL fix or a forgetful W2 path would leave stale powers live for up to
 * 900 s. 0019 moves the bump into a BEFORE UPDATE trigger, so no writer can
 * forget it. This spec pins the migration's half of that contract (the
 * function, the trigger, the columns it watches); `admin-authz.e2e.spec.ts`
 * proves the behaviour by demoting WITHOUT touching `authz_version`.
 */

const MIGRATION = resolve(__dirname, '../../../drizzle/0019_admin_authz_trigger.sql');

function migrationSql(): string {
  return readFileSync(MIGRATION, 'utf8');
}

describe('migration 0019 bumps authz_version on authz changes', () => {
  it('defines the bump function on sub_role and status', () => {
    const sql = migrationSql();
    expect(sql).toContain('bump_admin_authz_version');
    expect(sql).toContain('NEW."sub_role" IS DISTINCT FROM OLD."sub_role"');
    expect(sql).toContain('NEW."status" IS DISTINCT FROM OLD."status"');
    expect(sql).toContain('NEW."authz_version" := OLD."authz_version" + 1');
  });

  it('wires a BEFORE UPDATE row trigger on admin_users', () => {
    const sql = migrationSql();
    expect(sql).toContain('trg_admin_authz_version');
    expect(sql).toContain('BEFORE UPDATE ON "admin_users"');
    expect(sql).toContain('FOR EACH ROW EXECUTE FUNCTION "bump_admin_authz_version"()');
  });
});
