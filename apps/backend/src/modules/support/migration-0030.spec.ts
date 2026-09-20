import {
  CONTENT_PAGE_KINDS,
  SUPPORT_ACTOR_TYPES,
  SUPPORT_MESSAGE_VISIBILITIES,
  SUPPORT_REQUESTER_TYPES,
  SUPPORT_TICKET_CATEGORIES,
  SUPPORT_TICKET_EVENT_KINDS,
  SUPPORT_TICKET_PRIORITIES,
  SUPPORT_TICKET_STATUSES,
} from '@towing/api-contracts';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Migration 0030 (W15): tickets, messages with visibility, the audited trail,
 * and the FAQ/legal pages — held in step with the contract unions.
 *
 * Eight CHECK constraints duplicate TypeScript unions by design (house rule: a
 * migration spec wherever a CHECK duplicates a union). The visibility CHECK
 * gets its own test with a sharper name because it is the one whose failure
 * mode is a leak rather than a 422.
 */

const MIGRATION = resolve(__dirname, '../../../drizzle/0030_support_and_content.sql');

function migrationSql(): string {
  return readFileSync(MIGRATION, 'utf8');
}

/** The literals of a named `CHECK (... IN (...))`, from the constraint's own name onward. */
function checkLiterals(sql: string, constraint: string): string[] {
  const statement = sql
    .split(';')
    .map((part) => part.replace(/\s+/g, ' '))
    .find((part) => part.includes(`"${constraint}"`));
  expect(statement, constraint).toBeDefined();

  const at = statement!.indexOf(`"${constraint}"`);
  const match = /IN \(([^)]+)\)/.exec(statement!.slice(at));
  expect(match, `${constraint} has an IN list`).toBeTruthy();
  return match![1]!
    .split(',')
    .map((raw) => raw.trim().replace(/^'|'$/g, ''))
    .sort();
}

const sorted = (values: readonly string[]): string[] => [...values].sort();

describe('migration 0030 support and content', () => {
  it('creates the four tables with their cascade rules', () => {
    const sql = migrationSql();
    expect(sql).toContain('CREATE TABLE "support_tickets"');
    expect(sql).toContain('CREATE TABLE "support_ticket_messages"');
    expect(sql).toContain('CREATE TABLE "support_ticket_events"');
    expect(sql).toContain('CREATE TABLE "content_pages"');

    // Messages and events die with their ticket; the booking reference does
    // not take the ticket with it (SET NULL — the complaint outlives the trip).
    expect(sql).toContain(
      '"ticket_id" uuid NOT NULL REFERENCES "support_tickets"("id") ON DELETE cascade',
    );
    expect(sql).toContain('REFERENCES "bookings"("id") ON DELETE set null');
  });

  it('makes the reference the unique key a human can quote', () => {
    const sql = migrationSql();
    expect(sql).toContain('CREATE UNIQUE INDEX "uq_support_tickets_reference"');
  });

  it('pins the requester union to the CHECK', () => {
    expect(checkLiterals(migrationSql(), 'ck_support_tickets_requester_type')).toEqual(
      sorted(SUPPORT_REQUESTER_TYPES),
    );
  });

  it('pins the category union to the CHECK', () => {
    expect(checkLiterals(migrationSql(), 'ck_support_tickets_category')).toEqual(
      sorted(SUPPORT_TICKET_CATEGORIES),
    );
  });

  it('pins the status union to the CHECK', () => {
    expect(checkLiterals(migrationSql(), 'ck_support_tickets_status')).toEqual(
      sorted(SUPPORT_TICKET_STATUSES),
    );
  });

  it('pins the priority union to the CHECK', () => {
    expect(checkLiterals(migrationSql(), 'ck_support_tickets_priority')).toEqual(
      sorted(SUPPORT_TICKET_PRIORITIES),
    );
  });

  it('pins the message author union to the CHECK', () => {
    expect(checkLiterals(migrationSql(), 'ck_support_ticket_messages_author_type')).toEqual(
      sorted(SUPPORT_ACTOR_TYPES),
    );
  });

  it('pins the VISIBILITY union — the CHECK behind the internal-note rule', () => {
    expect(checkLiterals(migrationSql(), 'ck_support_ticket_messages_visibility')).toEqual(
      sorted(SUPPORT_MESSAGE_VISIBILITIES),
    );
  });

  it('pins the event kind and actor unions to their CHECKs', () => {
    const sql = migrationSql();
    expect(checkLiterals(sql, 'ck_support_ticket_events_kind')).toEqual(
      sorted(SUPPORT_TICKET_EVENT_KINDS),
    );
    expect(checkLiterals(sql, 'ck_support_ticket_events_actor_type')).toEqual(
      sorted(SUPPORT_ACTOR_TYPES),
    );
  });

  it('pins the content kind union and the slug uniqueness', () => {
    const sql = migrationSql();
    expect(checkLiterals(sql, 'ck_content_pages_kind')).toEqual(sorted(CONTENT_PAGE_KINDS));
    expect(sql).toContain('CREATE UNIQUE INDEX "uq_content_pages_slug"');
  });

  it('keeps every statement drizzle-migrator separable', () => {
    expect(migrationSql()).toContain('--> statement-breakpoint');
  });
});
