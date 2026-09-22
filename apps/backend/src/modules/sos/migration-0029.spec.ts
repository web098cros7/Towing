import {
  SOS_ACTOR_TYPES,
  SOS_EVENT_KINDS,
  SOS_SOURCES,
  SOS_STATUSES,
  SOS_SUBJECT_TYPES,
} from '@towing/api-contracts';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Migration 0029 (W14): the SOS tables, the one-open-alert rule, and the
 * timeline vocabulary — held in step with the contract unions.
 *
 * Four CHECK constraints duplicate TypeScript unions by design (house rule: a
 * migration spec wherever a CHECK duplicates a union), so each one is pinned
 * here. The partial unique index gets its own assertion because it is load-
 * bearing twice over: it makes a duplicate trigger race-safe AND it is what
 * "one incident at a time" means in the database rather than in a comment.
 */

const MIGRATION = resolve(__dirname, '../../../drizzle/0029_sos.sql');

function migrationSql(): string {
  return readFileSync(MIGRATION, 'utf8');
}

/** The literals of a named `CHECK (... IN (...))`, whitespace-normalised. */
function checkLiterals(sql: string, constraint: string): string[] {
  const statement = sql
    .split(';')
    .map((part) => part.replace(/\s+/g, ' '))
    .find((part) => part.includes(`"${constraint}"`));
  expect(statement, constraint).toBeDefined();

  // Slice FROM the constraint name: one CREATE TABLE statement holds several
  // IN lists, and the first one in the statement is not the one being pinned.
  const at = statement!.indexOf(`"${constraint}"`);
  const match = /IN \(([^)]+)\)/.exec(statement!.slice(at));
  expect(match, `${constraint} has an IN list`).toBeTruthy();
  return match![1]!
    .split(',')
    .map((raw) => raw.trim().replace(/^'|'$/g, ''))
    .sort();
}

const sorted = (values: readonly string[]): string[] => [...values].sort();

describe('migration 0029 SOS', () => {
  it('creates the three tables with their cascade rules', () => {
    const sql = migrationSql();
    expect(sql).toContain('CREATE TABLE "sos_alerts"');
    expect(sql).toContain('CREATE TABLE "sos_alert_contacts"');
    expect(sql).toContain('CREATE TABLE "sos_alert_events"');

    // The snapshot and the timeline die with their incident — they have no
    // meaning apart from it.
    expect(sql).toContain(
      '"alert_id" uuid NOT NULL REFERENCES "sos_alerts"("id") ON DELETE cascade',
    );
    // The booking reference does NOT: a safety record outlives the trip.
    expect(sql).toContain('REFERENCES "bookings"("id") ON DELETE set null');
  });

  it('enforces one OPEN alert per subject with a partial unique index', () => {
    const sql = migrationSql();
    expect(sql).toContain('CREATE UNIQUE INDEX "uq_sos_alerts_open_per_subject"');
    expect(sql).toContain('ON "sos_alerts" ("subject_type", "subject_id")');
    expect(sql).toContain(`WHERE "status" IN ('triggered', 'acknowledged')`);
  });

  it('keeps the ack and resolve stamps atomic with their authors', () => {
    const sql = migrationSql();
    expect(sql).toContain('ck_sos_alerts_ack_pair');
    expect(sql).toContain('("acknowledged_at" IS NULL) = ("acknowledged_by" IS NULL)');
    expect(sql).toContain('ck_sos_alerts_resolve_pair');
    expect(sql).toContain('("resolved_at" IS NULL) = ("resolved_by" IS NULL)');
  });

  it('indexes the queue read (status, newest first)', () => {
    const sql = migrationSql();
    expect(sql).toContain('idx_sos_alerts_status_created');
    expect(sql).toContain('"created_at" DESC NULLS LAST');
  });

  it('pins the subject union to the CHECK', () => {
    expect(checkLiterals(migrationSql(), 'ck_sos_alerts_subject_type')).toEqual(
      sorted(SOS_SUBJECT_TYPES),
    );
  });

  it('pins the source union to the CHECK', () => {
    expect(checkLiterals(migrationSql(), 'ck_sos_alerts_source')).toEqual(sorted(SOS_SOURCES));
  });

  it('pins the status union to the CHECK', () => {
    expect(checkLiterals(migrationSql(), 'ck_sos_alerts_status')).toEqual(sorted(SOS_STATUSES));
  });

  it('pins the timeline kind vocabulary to the CHECK', () => {
    expect(checkLiterals(migrationSql(), 'ck_sos_alert_events_kind')).toEqual(
      sorted(SOS_EVENT_KINDS),
    );
  });

  it('pins the actor union to the CHECK', () => {
    expect(checkLiterals(migrationSql(), 'ck_sos_alert_events_actor_type')).toEqual(
      sorted(SOS_ACTOR_TYPES),
    );
  });

  it('keeps every statement drizzle-migrator separable', () => {
    expect(migrationSql()).toContain('--> statement-breakpoint');
  });
});
