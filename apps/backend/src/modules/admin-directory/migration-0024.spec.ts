import {
  SUSPENSION_REQUEST_STATUSES,
  SUSPENSION_REQUEST_SUBJECT_TYPES,
} from '@towing/api-contracts';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Migration 0024 (W6): trigram search, suspension metadata and requests, zone
 * restrictions, document versions, impersonation sessions.
 *
 * NOTE: both `suspension_requests` CHECKs duplicate TypeScript unions by design
 * (house rule: a migration spec wherever a CHECK duplicates a union). The last
 * two tests pin the SQL literals to the contract constants, so a status or
 * subject type cannot exist on one side only.
 *
 * The final test guards the explicit warning in 0017's header — that migration
 * owns `drivers.pending_suspension_*`, and re-adding them here would be a
 * silent behavioural reset of the A14 shelf.
 */

const MIGRATION = resolve(__dirname, '../../../drizzle/0024_admin_directory_search.sql');

function migrationSql(): string {
  return readFileSync(MIGRATION, 'utf8');
}

describe('migration 0024 admin directory search and suspension', () => {
  it('installs pg_trgm and the five trigram indexes the directory searches', () => {
    const sql = migrationSql();
    expect(sql).toContain('CREATE EXTENSION IF NOT EXISTS pg_trgm');
    for (const index of [
      'idx_users_name_trgm',
      'idx_users_mobile_trgm',
      'idx_drivers_name_trgm',
      'idx_drivers_mobile_trgm',
      'idx_fleets_business_name_trgm',
    ]) {
      expect(sql).toContain(index);
    }
    expect(sql).toContain('gin_trgm_ops');
  });

  it('adds the three bookings list indexes, with the paid one partial', () => {
    const sql = migrationSql();
    expect(sql).toContain('idx_bookings_created_at');
    expect(sql).toContain('idx_bookings_zone_created');
    const paidLine = sql
      .split('\n')
      .find((line) => line.includes('idx_bookings_paid_at'));
    expect(paidLine).toBeDefined();
    expect(paidLine).toContain(`WHERE "status" = 'paid'`);
  });

  it('adds the suspension metadata trio to users, drivers and fleets', () => {
    const sql = migrationSql();
    for (const table of ['users', 'drivers', 'fleets']) {
      expect(sql).toContain(
        `ALTER TABLE "${table}" ADD COLUMN IF NOT EXISTS "suspended_at" timestamp with time zone`,
      );
      expect(sql).toContain(
        `ALTER TABLE "${table}" ADD COLUMN IF NOT EXISTS "suspended_by" uuid REFERENCES "admin_users"("id")`,
      );
      expect(sql).toContain(
        `ALTER TABLE "${table}" ADD COLUMN IF NOT EXISTS "suspension_reason" text`,
      );
    }
  });

  it('creates suspension_requests with one partial unique index per open subject', () => {
    const sql = migrationSql();
    expect(sql).toContain('CREATE TABLE "suspension_requests"');
    const uniqueLine = sql
      .split('\n')
      .find((line) => line.includes('uq_suspension_requests_open_subject'));
    expect(uniqueLine).toBeDefined();
    expect(sql).toContain(`WHERE "status" = 'open'`);
  });

  it('creates the three W6 tables the later workstreams write', () => {
    const sql = migrationSql();
    expect(sql).toContain('CREATE TABLE "driver_zone_restrictions"');
    expect(sql).toContain('PRIMARY KEY ("driver_id","zone_id")');
    expect(sql).toContain('CREATE TABLE "driver_document_versions"');
    expect(sql).toContain('CREATE TABLE "impersonation_sessions"');
  });

  it('keeps every statement drizzle-migrator separable and ends with no backfill', () => {
    const sql = migrationSql();
    expect(sql).toContain('--> statement-breakpoint');
    expect(sql.toLowerCase()).toContain('backfills');
  });

  it('does NOT re-add the A14 pending-suspension columns owned by 0017', () => {
    const sql = migrationSql();
    expect(sql).not.toContain('ADD COLUMN IF NOT EXISTS "pending_suspension_reason"');
    expect(sql).not.toContain('ADD COLUMN IF NOT EXISTS "pending_suspension_by"');
    expect(sql).not.toContain('ADD COLUMN IF NOT EXISTS "pending_suspension_at"');
  });

  it('pins the subject-type union to the CHECK', () => {
    const sql = migrationSql();
    const check = /"subject_type" IN \(([^)]+)\)/.exec(sql);
    expect(check).toBeTruthy();

    const literals = check![1]!
      .split(',')
      .map((raw) => raw.trim().replace(/^'|'$/g, ''))
      .sort();
    expect([...SUSPENSION_REQUEST_SUBJECT_TYPES].sort()).toEqual(literals);
  });

  it('pins the status union to the CHECK', () => {
    const sql = migrationSql();
    const check = /"status" IN \(([^)]+)\)/.exec(sql);
    expect(check).toBeTruthy();

    const literals = check![1]!
      .split(',')
      .map((raw) => raw.trim().replace(/^'|'$/g, ''))
      .sort();
    expect([...SUSPENSION_REQUEST_STATUSES].sort()).toEqual(literals);
  });
});
