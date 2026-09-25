import { boolean, index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { primaryId, timestamps } from './columns';
import { otpPurposeEnum } from './enums';
import { users } from './users';

/**
 * Email + password for the fleet console (§16.4 login contract).
 *
 * Kept out of `users` on purpose: the customer app authenticates by phone OTP
 * and has no password at all. Fleet console credentials are a separate auth
 * realm (§15.2), so they get their own table rather than nullable columns that
 * only ever apply to one kind of user.
 */
export const fleetOwnerCredentials = pgTable(
  'fleet_owner_credentials',
  {
    id: primaryId(),
    userId: uuid('user_id')
      .notNull()
      .unique()
      .references(() => users.id, { onDelete: 'cascade' }),
    email: text('email').notNull().unique(),
    // scrypt: N=16384,r=8,p=1 — Node built-in, so no native module to compile.
    passwordHash: text('password_hash').notNull(),
    failedAttempts: integer('failed_attempts').notNull().default(0),
    lockedUntil: timestamp('locked_until', { withTimezone: true }),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [index('idx_fleet_owner_credentials_email').on(t.email)],
);

/**
 * A login that passed the first factor but not yet OTP. Short-lived; the client
 * exchanges `challengeId` + code for a session. Storing this server-side (not
 * in a token) means an abandoned challenge is genuinely unusable.
 *
 * `subject_id` is POLYMORPHIC AND FK-FREE, paired with `subject_type` — the
 * same shape `refresh_tokens.subject_id` + `realm` has had since Phase 3.
 * It was `user_id REFERENCES users(id)` until migration 0007, which meant the
 * first driver OTP login took a foreign-key violation: drivers live in
 * `drivers` and admins in `admin_users`, and neither id exists in `users`.
 * `driver-login-challenge.e2e.spec.ts` is the regression guard.
 */
export const loginChallenges = pgTable(
  'login_challenges',
  {
    id: primaryId(),
    subjectId: uuid('subject_id').notNull(),
    /** `'user' | 'driver' | 'admin'` — pinned by a CHECK in migration 0007. */
    subjectType: text('subject_type').notNull(),
    realm: text('realm').notNull(),
    otpId: uuid('otp_id').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('idx_login_challenges_subject').on(t.subjectType, t.subjectId, t.expiresAt)],
);

/** One-time codes for phone login (§17 otp_verifications). Codes are stored hashed. */
export const otpVerifications = pgTable(
  'otp_verifications',
  {
    id: primaryId(),
    phone: text('phone').notNull(),
    purpose: otpPurposeEnum('purpose').notNull(),
    codeHash: text('code_hash').notNull(),
    attempts: integer('attempts').notNull().default(0),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    used: boolean('used').notNull().default(false),
    /**
     * The vendor's reference when the VENDOR made and checks the code (MSG91's
     * OTP Widget `reqId`). Null when we made it: then `code_hash` is checked.
     */
    vendorRef: text('vendor_ref'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('idx_otp_verifications_lookup').on(t.phone, t.purpose, t.expiresAt)],
);

/**
 * Rotating refresh tokens with reuse detection.
 *
 * Each refresh issues a new row and marks its parent `rotated_at`. Tokens are
 * grouped by `family_id`: presenting an already-rotated token means the value
 * leaked, so the entire family is revoked rather than just that one token.
 * Only the SHA-256 of the token is stored — the raw value never touches the DB.
 */
export const refreshTokens = pgTable(
  'refresh_tokens',
  {
    id: primaryId(),
    familyId: uuid('family_id').notNull(),
    subjectId: uuid('subject_id').notNull(),
    // Which realm the token belongs to — a fleet token must never work on the
    // admin console and vice versa (§15.2 separate auth realms).
    realm: text('realm').notNull(),
    fleetId: uuid('fleet_id'),
    tokenHash: text('token_hash').notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    rotatedAt: timestamp('rotated_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revokedReason: text('revoked_reason'),
    userAgent: text('user_agent'),
    ip: text('ip'),
    ...timestamps,
  },
  (t) => [
    index('idx_refresh_tokens_family').on(t.familyId),
    index('idx_refresh_tokens_subject').on(t.subjectId, t.realm),
  ],
);
