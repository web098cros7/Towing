import { boolean, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
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
     * A17's authorization generation. Migration 0019's trigger bumps it on
     * every sub-role or status change, so no writer can forget;
     * `JwtAuthGuard` 401s any access token older than the row, so a demotion
     * lands within seconds instead of at the 900-second expiry. Added by
     * migration 0018, trigger by 0019.
     */
    authzVersion: integer('authz_version').notNull().default(1),
    /**
     * W1/W2 identity columns (migration 0020). `twofa_secret_enc` holds the
     * env-key-encrypted TOTP secret — never a bare secret; the CHECK refuses
     * an enabled second factor with nothing to verify against, so the DB
     * catches what a forgetful writer would otherwise ship as a lockout.
     * `twofa_secret` (migration 0007) stays reserved-but-unread.
     */
    twofaEnabled: boolean('twofa_enabled').notNull().default(false),
    twofaSecretEnc: text('twofa_secret_enc'),
    twofaConfirmedAt: timestamp('twofa_confirmed_at', { withTimezone: true }),
    /**
     * W2 (migration 0021): last accepted TOTP time-step. Refuses a code
     * replayed on a fresh challenge inside its window. Nullable — no admin
     * has completed TOTP before W2.
     */
    twofaLastCounter: integer('twofa_last_counter'),
    /** W2 (migration 0021): set by password reset; `verify` mints no session while set. */
    mustChangePassword: boolean('must_change_password').notNull().default(false),
    // Plain uuids, not `.references(() => adminUsers.id)`: a self-FK inside
    // the table's own initializer is circular for TS inference (TS7022), and
    // the FKs exist in migration 0020 regardless — the schema never emits DDL
    // for hand-written migrations anyway, exactly like CHECK constraints.
    createdBy: uuid('created_by'),
    deactivatedAt: timestamp('deactivated_at', { withTimezone: true }),
    deactivatedBy: uuid('deactivated_by'),
    /** W14's on-call flag: SOS/ops alerts fan out to flagged admins (G17). */
    receivesOpsAlerts: boolean('receives_ops_alerts').notNull().default(false),
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
    // W1's audit viewer cursor (migration 0020): the unscoped feed orders by
    // `created_at DESC, id DESC`, which neither scoped index above serves.
    index('idx_admin_actions_created').on(t.createdAt.desc().nullsLast(), t.id.desc()),
  ],
);

/**
 * Single-use TOTP recovery codes (W2, migration 0020).
 *
 * Stored hashed — a database dump must not hand out second factors. CASCADE on
 * purpose, unlike audit rows: codes are live auth material, and a deleted
 * admin must not leave valid codes behind.
 */
export const adminRecoveryCodes = pgTable(
  'admin_recovery_codes',
  {
    id: primaryId(),
    adminId: uuid('admin_id')
      .notNull()
      .references(() => adminUsers.id, { onDelete: 'cascade' }),
    codeHash: text('code_hash').notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('uq_admin_recovery_codes_admin_hash').on(t.adminId, t.codeHash)],
);

/**
 * Internal notes on any subject (W21, migration 0020).
 *
 * `subject_id` is FK-free and paired with `subject_type` — the same
 * polymorphic shape as `admin_actions` — so one `<NotesPanel/>` drops into
 * every detail screen. `deleted_at` is a soft delete: PUT/DELETE own-notes
 * semantics without losing who wrote what. No cascade on `admin_id`: a note
 * must outlive its author, exactly like an audit row.
 */
export const adminNotes = pgTable(
  'admin_notes',
  {
    id: primaryId(),
    subjectType: text('subject_type').notNull(),
    subjectId: uuid('subject_id').notNull(),
    adminId: uuid('admin_id')
      .notNull()
      .references(() => adminUsers.id),
    body: text('body').notNull(),
    pinned: boolean('pinned').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [index('idx_admin_notes_subject').on(t.subjectType, t.subjectId, t.createdAt.desc().nullsLast())],
);
