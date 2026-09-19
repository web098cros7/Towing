import { ADMIN_NOTE_SUBJECT_TYPES } from '@towing/api-contracts';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Migration 0020 and the W1 schema it hosts, held in step.
 *
 * W1's foundation (2FA columns, recovery codes, the audit cursor index,
 * `admin_notes`, `booking_status_history.actor_id`) lands as DDL before any
 * code reads it, so a half-applied migration fails loudly here rather than as
 * a runtime `column does not exist` three workstreams later. Behavioural
 * proof (TOTP enrol, audit cursor pagination, notes CRUD) belongs to the
 * W1-4/W1-7/W2 specs that exercise those paths against a migrated test DB.
 *
 * NOTE: `ck_admin_notes_subject_type` duplicates a TypeScript union by design
 * (house rule: a migration spec wherever a CHECK duplicates a union). The
 * cross-check below pins the union the API validates against
 * (`ADMIN_NOTE_SUBJECT_TYPES`) to the literals in this file, so the two
 * cannot drift.
 */

const MIGRATION = resolve(__dirname, '../../../drizzle/0020_admin_identity_audit_notes.sql');

function migrationSql(): string {
  return readFileSync(MIGRATION, 'utf8');
}

describe('migration 0020 admin identity, audit cursor and notes', () => {
  it('adds the 2FA/identity columns with behaviour-neutral defaults', () => {
    const sql = migrationSql();
    expect(sql).toContain('"twofa_enabled" boolean NOT NULL DEFAULT false');
    expect(sql).toContain('"twofa_secret_enc" text');
    expect(sql).toContain('"twofa_confirmed_at" timestamp with time zone');
    expect(sql).toContain('"created_by" uuid REFERENCES "admin_users"("id")');
    expect(sql).toContain('"deactivated_at" timestamp with time zone');
    expect(sql).toContain('"deactivated_by" uuid REFERENCES "admin_users"("id")');
    expect(sql).toContain('"receives_ops_alerts" boolean NOT NULL DEFAULT false');
  });

  it('refuses an enabled second factor with no secret to verify against', () => {
    const sql = migrationSql();
    expect(sql).toContain('ck_admin_users_twofa_secret');
    expect(sql).toContain('"twofa_enabled" = false OR "twofa_secret_enc" IS NOT NULL');
  });

  it('creates admin_recovery_codes with a per-admin hash uniqueness', () => {
    const sql = migrationSql();
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS "admin_recovery_codes"');
    expect(sql).toContain('"admin_id" uuid NOT NULL REFERENCES "admin_users"("id") ON DELETE cascade');
    expect(sql).toContain('"code_hash" text NOT NULL');
    expect(sql).toContain('uq_admin_recovery_codes_admin_hash');
  });

  it('adds the unscoped audit cursor index the viewer paginates on', () => {
    const sql = migrationSql();
    expect(sql).toContain('idx_admin_actions_created');
    expect(sql).toContain('"created_at" DESC NULLS LAST,"id" DESC');
  });

  it('creates admin_notes with the ten-subject CHECK and its subject index', () => {
    const sql = migrationSql();
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS "admin_notes"');
    expect(sql).toContain('ck_admin_notes_subject_type');
    for (const subject of [
      "'user'",
      "'driver'",
      "'fleet'",
      "'booking'",
      "'dispute'",
      "'sos_alert'",
      "'support_ticket'",
      "'truck'",
      "'payout'",
      "'deletion_request'",
    ]) {
      expect(sql).toContain(subject);
    }
    expect(sql).toContain('idx_admin_notes_subject');
  });

  it('adds the nullable history actor with no cascade', () => {
    const sql = migrationSql();
    const actorLine = sql
      .split('\n')
      .find((line) => line.includes('"actor_id" uuid REFERENCES "admin_users"'));
    expect(actorLine).toBeDefined();
    expect(actorLine).not.toContain('CASCADE');
    expect(actorLine).not.toContain('cascade');
  });

  it('keeps every statement drizzle-migrator separable', () => {
    const sql = migrationSql();
    expect(sql).toContain('--> statement-breakpoint');
  });

  it('pins the subject union to the CHECK — the API cannot admit a type the DB refuses', () => {
    const sql = migrationSql();
    const check = /"subject_type" IN \(([^)]+)\)/.exec(sql);
    expect(check).toBeTruthy();

    const literals = check![1]!
      .split(',')
      .map((raw) => raw.trim().replace(/^'|'$/g, ''))
      .sort();
    expect([...ADMIN_NOTE_SUBJECT_TYPES].sort()).toEqual(literals);
  });
});
