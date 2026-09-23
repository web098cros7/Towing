import { sql } from 'drizzle-orm';
import type { Database } from '../../db/db.module';

/**
 * W19 — G16's retention schedule, and the nightly sweep that enforces the part
 * of it that CAN be enforced by deleting rows (§20.4 DPDP).
 *
 * The schedule is DATA (`retention_policies`), not constants: the console edits
 * the same rows this file reads, so "what does the policy say" and "what did
 * the job do" cannot disagree. This module owns two things the edit surface
 * cannot see:
 *
 *   1. WHICH keys the sweep enforces. Three of the six are policy-only, and
 *      that is a decision, not an omission:
 *        · `kyc_documents` — 7 years is a regulatory FLOOR. Deleting earlier is
 *          the offence; the console shows the row so the schedule reads whole.
 *        · `audit_logs` — the erasure runner is forbidden to touch
 *          `admin_actions`, and a sweep that deleted the trail of who did what
 *          would be a self-inflicted audit failure.
 *        · `wave_logs` — already purged on the same 30-day clock by the
 *          analytics rollup job (`purgeWaveLogs`). Two deleters for one table
 *          is how the row count in a report stops matching either job's output.
 *   2. The cutoff arithmetic: `now() - make_interval(days => n)`, computed in
 *      SQL so the clock is the database's, not a worker's.
 */

export interface RetentionPolicyDefault {
  policyKey: string;
  retentionDays: number;
  description: string;
}

/** The seed/migration defaults. `migration-0033.spec.ts` pins the SQL seed against this list. */
export const RETENTION_POLICY_DEFAULTS: readonly RetentionPolicyDefault[] = [
  {
    policyKey: 'kyc_documents',
    retentionDays: 2555,
    description:
      'KYC documents and versions — 7 years, regulatory floor. Policy-only: no sweep deletes them.',
  },
  {
    policyKey: 'audit_logs',
    retentionDays: 2555,
    description:
      'admin_actions — 7 years. Policy-only: the erasure runner must never touch the audit trail.',
  },
  {
    policyKey: 'location_paths',
    retentionDays: 180,
    description: 'booking_location_path samples — 180 days. Swept nightly.',
  },
  {
    policyKey: 'delivery_logs',
    retentionDays: 90,
    description: 'notification_deliveries and notification_events — 90 days. Swept nightly.',
  },
  {
    policyKey: 'wave_logs',
    retentionDays: 30,
    description: 'dispatch_wave_logs — 30 days, purged by the analytics rollup job (§22.2).',
  },
  {
    policyKey: 'webhook_events',
    retentionDays: 90,
    description: 'Raw provider webhook payloads — 90 days. Swept nightly.',
  },
  /**
   * ADM-18's gap, closed 23 Sep. The chat did not exist when G16's schedule
   * was written, so it was kept forever.
   *
   * 90 days is ADM-18's "message logs" default. A customer can report a
   * problem with a trip for `TRIP_ISSUE_WINDOW_DAYS` (30, following Uber and
   * Ola), so the chat outlives the window with room for the dispute to be
   * worked; the rest of the margin is for what arrives later still — a
   * safety report (never time-limited), a police request about a trip. A dispute still OPEN holds its
   * booking's chat past the cutoff (see `sweepRetention`), because the chat is
   * the evidence the dispute is being decided on.
   *
   * Added by migration 0041, not 0033: `migration-0033.spec.ts` pins 0033's
   * seed to every entry here EXCEPT this one.
   */
  {
    policyKey: 'chat_messages',
    retentionDays: 90,
    description: "booking_messages (driver-customer chat) — 90 days. Swept nightly, except on a booking with a dispute still open.",
  },
];

/** Keys added to the schedule after 0033 seeded it, each by its own migration. */
export const POLICY_KEYS_ADDED_AFTER_0033 = ['chat_messages'] as const;

/** The three keys `sweepRetention` honours — the console renders this as `enforced`. */
export const SWEPT_POLICY_KEYS = [
  'location_paths',
  'delivery_logs',
  'webhook_events',
  'chat_messages',
] as const;
export type SweptPolicyKey = (typeof SWEPT_POLICY_KEYS)[number];

export interface RetentionSweepResult {
  policyKey: SweptPolicyKey;
  retentionDays: number;
  deleted: number;
}

interface PolicyRow {
  policy_key: string;
  retention_days: number;
}

/**
 * One sweep pass. Reads the live policy values, deletes by them, and returns
 * what each key removed.
 *
 * `returning id` + count rather than `rowCount`: the postgres.js driver leaves
 * `rowCount` undefined on some paths (the same trap `purgeWaveLogs` hit), so
 * the count comes from the rows the DELETE actually returned.
 */
export async function sweepRetention(db: Database): Promise<RetentionSweepResult[]> {
  const policies = (await db.execute(sql`
    select policy_key, retention_days from retention_policies
  `)) as unknown as PolicyRow[];

  const daysByKey = new Map(policies.map((row) => [row.policy_key, row.retention_days]));
  const results: RetentionSweepResult[] = [];

  for (const policyKey of SWEPT_POLICY_KEYS) {
    const retentionDays = daysByKey.get(policyKey);
    // A missing row means someone deleted the policy from under the job. The
    // fail-safe is to delete NOTHING: a retention sweep that guesses is worse
    // than one that skips, and the console's editor cannot produce this state.
    if (retentionDays === undefined) continue;

    const cutoff = sql`now() - make_interval(days => ${retentionDays})`;
    let deleted = 0;

    if (policyKey === 'location_paths') {
      const rows = (await db.execute(sql`
        delete from booking_location_path where recorded_at < ${cutoff} returning id
      `)) as unknown as unknown[];
      deleted = rows.length;
    } else if (policyKey === 'delivery_logs') {
      // Deliveries first (the table with the masked destinations and the vendor
      // refs), then the events those deliveries hang from — the FK cascades any
      // delivery the first DELETE missed because its clock ran out at 23:59:59.
      const deliveries = (await db.execute(sql`
        delete from notification_deliveries where created_at < ${cutoff} returning id
      `)) as unknown as unknown[];
      const events = (await db.execute(sql`
        delete from notification_events where created_at < ${cutoff} returning id
      `)) as unknown as unknown[];
      deleted = deliveries.length + events.length;
    } else if (policyKey === 'chat_messages') {
      // A dispute that is not yet resolved holds its booking's chat: it is the
      // evidence being decided on, and deleting it mid-case because a clock ran
      // out would destroy the one record both sides can point to.
      const rows = (await db.execute(sql`
        delete from booking_messages m
         where m.created_at < ${cutoff}
           and not exists (
             select 1 from disputes d
              where d.booking_id = m.booking_id and d.status <> 'resolved'
           )
         returning m.id
      `)) as unknown as unknown[];
      deleted = rows.length;
    } else {
      // `received_at`, not `created_at`: a webhook row is a fact that happened
      // and carries no timestamps pair (see the schema's note). Reading the
      // wrong column here would make the sweep a silent no-op.
      const rows = (await db.execute(sql`
        delete from webhook_events
         where received_at < now() - make_interval(days => ${retentionDays})
         returning id
      `)) as unknown as unknown[];
      deleted = rows.length;
    }

    results.push({ policyKey, retentionDays, deleted });
  }

  return results;
}
