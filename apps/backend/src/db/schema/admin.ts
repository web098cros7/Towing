import { index, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { primaryId, timestamps } from './columns';
import { accountStatusEnum, adminSubRoleEnum } from './enums';

/**
 * Towing Admin operators (§9.4, §15.2 — a fourth auth realm).
 *
 * Kept entirely out of `users` for the same reason `fleet_owner_credentials`
 * is: an admin is not a customer who happens to have a flag. Sharing the table
 * would mean a customer row could be escalated by a single UPDATE, and it would
 * put admin credentials one join away from every customer-facing query.
 *
 * `mobile` is the second factor, not a contact detail — admin login is
 * password + OTP, mirroring the fleet console (§16.4).
 */
export const adminUsers = pgTable(
  'admin_users',
  {
    id: primaryId(),
    email: text('email').notNull().unique(),
    mobile: text('mobile').notNull().unique(),
    name: text('name').notNull(),
    // Same scrypt encoding as `fleet_owner_credentials` — `modules/auth/password.ts`
    // is realm-agnostic and is reused verbatim.
    passwordHash: text('password_hash').notNull(),
    subRole: adminSubRoleEnum('sub_role').notNull(),
    status: accountStatusEnum('status').notNull().default('active'),
    /**
     * RESERVED, AND NOTHING WRITES IT YET. TOTP needs an enrolment surface to
     * set a secret, and the admin console is Phase 11 — shipping a code path
     * that no operator can onboard into would be worse than shipping none.
     * The column exists now so Phase 11 adds TOTP without a migration: verify
     * reads this when non-null and falls back to OTP when null.
     */
    twofaSecret: text('twofa_secret'),
    failedAttempts: integer('failed_attempts').notNull().default(0),
    lockedUntil: timestamp('locked_until', { withTimezone: true }),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    /**
     * A17's authorization generation. Bumped on every sub-role or status
     * mutation (W2 owns the writers); `JwtAuthGuard` 401s any access token
     * older than the row, so a demotion lands within seconds instead of at
     * the 900-second expiry. Added by migration 0018.
     */
    authzVersion: integer('authz_version').notNull().default(1),
    ...timestamps,
  },
  (t) => [index('idx_admin_users_status').on(t.status)],
);

/**
 * Append-only audit of every admin action (§20.4).
 *
 * `admin_id` has NO cascade on purpose: an audit row must outlive the admin it
 * records. Deleting an operator who wrongly approved a driver must not delete
 * the evidence that they did.
 *
 * `subject_id` is FK-free and paired with `subject_type` — one admin action can
 * target a driver, a document, a fleet or a payout, and no single foreign key
 * expresses that. Same shape as `refresh_tokens.subject_id`.
 */
export const adminActions = pgTable(
  'admin_actions',
  {
    id: primaryId(),
    adminId: uuid('admin_id')
      .notNull()
      .references(() => adminUsers.id),
    /** Dotted verb, e.g. `driver.kyc.approve`. Free text: the set grows every phase. */
    action: text('action').notNull(),
    subjectType: text('subject_type').notNull(),
    subjectId: uuid('subject_id'),
    /** Whole-row snapshots, so "what changed" is answerable without a diff log. */
    before: jsonb('before'),
    after: jsonb('after'),
    reason: text('reason'),
    ip: text('ip'),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // `desc nulls last` spelled out: drizzle-kit emits DESC indexes as NULLS
    // LAST, so an ORDER BY that only says `desc` gets a Sort node bolted on.
    index('idx_admin_actions_admin').on(t.adminId, t.createdAt.desc().nullsLast()),
    index('idx_admin_actions_subject').on(
      t.subjectType,
      t.subjectId,
      t.createdAt.desc().nullsLast(),
    ),
  ],
);
