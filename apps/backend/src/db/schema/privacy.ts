import { index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { adminUsers } from './admin';
import { primaryId, timestamps } from './columns';

/**
 * A deletion request's workflow vocabulary — CHECK-constrained in migration
 * 0033, whose spec pins this union against the constraint. Widened from 0009's
 * implicit single value (`requested`) by W19, the phase that executes them.
 */
export const DELETION_REQUEST_STATUSES = [
  'requested',
  'on_hold',
  'approved',
  'executing',
  'completed',
  'rejected',
] as const;
export type DeletionRequestStatus = (typeof DELETION_REQUEST_STATUSES)[number];

/**
 * The statuses that count as ONE OPEN request per subject (the partial unique
 * index's predicate). `completed`/`rejected` free the slot so a person who
 * changes their mind and later returns files a fresh request rather than
 * re-opening a closed row — the history stays append-only.
 */
export const OPEN_DELETION_REQUEST_STATUSES = [
  'requested',
  'on_hold',
  'approved',
  'executing',
] as const satisfies readonly DeletionRequestStatus[];

/**
 * §20.4 DPDP — consent capture and account-deletion requests (Phase 12).
 * Dual-realm: a row's `subject_id`/`subject_type` names either a `users` row
 * or a `drivers` row, polymorphic and FK-free — same idiom as `devices`,
 * `login_challenges` and `social_identities`, pinned by a hand-written CHECK
 * in the migration (drizzle-kit emits neither CHECK constraints nor partial
 * unique indexes).
 */
export const consentRecords = pgTable(
  'consent_records',
  {
    id: primaryId(),
    subjectId: uuid('subject_id').notNull(),
    /** `'user' | 'driver'` — CHECK-constrained in the migration. */
    subjectType: text('subject_type').notNull(),
    /** `'privacy_policy' | 'terms_of_service'` — plain text, not an enum: the set is app copy, not a data invariant. */
    policyType: text('policy_type').notNull(),
    policyVersion: text('policy_version').notNull(),
    consentedAt: timestamp('consented_at', { withTimezone: true }).notNull().defaultNow(),
    ...timestamps,
  },
  (t) => [index('idx_consent_records_subject').on(t.subjectType, t.subjectId)],
);

/**
 * A driver/customer files a deletion request; Phase 20's retention/erasure
 * worker executes it. Not a hard delete at request time — bookings and the
 * ledger FK to the subject and must survive for accounting/audit history;
 * `users.status`/an eventual `drivers` equivalent flip is the worker's job.
 *
 * One open request per subject is enforced by a hand-written partial unique
 * index in the migration (`uq_deletion_requests_one_open_per_subject`, same
 * shape as `uq_payouts_one_open_per_owner`) — a plain index here is the
 * drizzle-kit-visible half of it.
 */
export const deletionRequests = pgTable(
  'deletion_requests',
  {
    id: primaryId(),
    subjectId: uuid('subject_id').notNull(),
    subjectType: text('subject_type').notNull(),
    /** A `DeletionRequestStatus` — CHECK-constrained in migration 0033. */
    status: text('status').notNull().default('requested'),
    reason: text('reason'),
    /** Set with `on_hold` — the one field that makes a parked request actionable. */
    holdReason: text('hold_reason'),
    decidedBy: uuid('decided_by').references(() => adminUsers.id),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    /** When the erasure runner finished. The evidence row for "we complied". */
    executedAt: timestamp('executed_at', { withTimezone: true }),
    /** When the subject's own identifiers were replaced with tombstones. */
    anonymisedAt: timestamp('anonymised_at', { withTimezone: true }),
    requestedAt: timestamp('requested_at', { withTimezone: true }).notNull().defaultNow(),
    ...timestamps,
  },
  (t) => [index('idx_deletion_requests_subject').on(t.subjectType, t.subjectId)],
);

/**
 * G16's retention schedule AS DATA (W19).
 *
 * A table rather than constants in the sweep because the schedule is a
 * compliance decision an operator adjusts — and because the console's editor
 * and the nightly job then read the SAME row, which is the only way "what the
 * policy says" and "what the job enforces" cannot drift. Rows exist for
 * regimes no sweep enforces (KYC, audit) on purpose: the page shows the whole
 * schedule, with the enforcement noted per row.
 */
export const retentionPolicies = pgTable(
  'retention_policies',
  {
    id: primaryId(),
    /** e.g. `location_paths` — the sweep's switch reads exactly this string. */
    policyKey: text('policy_key').notNull(),
    retentionDays: integer('retention_days').notNull(),
    description: text('description').notNull(),
    updatedBy: uuid('updated_by').references(() => adminUsers.id),
    ...timestamps,
  },
  (t) => [uniqueIndex('uq_retention_policies_key').on(t.policyKey)],
);

/** One erasure execution — the ordered step log the console's detail panel renders. */
export interface ErasureStepLogEntry {
  step: string;
  outcome: 'done' | 'skipped' | 'refused';
  count: number;
  detail?: string;
  at: string;
}

export const erasureJobs = pgTable(
  'erasure_jobs',
  {
    id: primaryId(),
    requestId: uuid('request_id')
      .notNull()
      .references(() => deletionRequests.id),
    subjectType: text('subject_type').notNull(),
    subjectId: uuid('subject_id').notNull(),
    /** `queued | running | completed | failed` — CHECK-constrained in 0033. */
    status: text('status').notNull().default('queued'),
    steps: jsonb('steps').notNull().default([]).$type<ErasureStepLogEntry[]>(),
    /** Set with `failed` — a hold reason or the exception that stopped the run. */
    error: text('error'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    index('idx_erasure_jobs_request').on(t.requestId),
    index('idx_erasure_jobs_subject').on(t.subjectType, t.subjectId),
  ],
);
