import { z } from 'zod';
import { sessionTokensSchema } from '../common/auth';
import { adminSubRoleSchema, kycStatusSchema } from '../common/enums';

/**
 * Admin-realm auth and the first RBAC-bearing action (§9.4, §4.2, §15.2).
 *
 * Two-step like the fleet console: email + password, then a 6-digit code to the
 * admin's registered mobile. `admin_users.twofa_secret` exists in the schema for
 * the TOTP upgrade but nothing sets it until Phase 11 ships an enrolment screen.
 */

export const adminLoginRequestSchema = z.object({
  email: z.email(),
  password: z.string().min(8),
});
export type AdminLoginRequest = z.infer<typeof adminLoginRequestSchema>;

export const adminLoginChallengeSchema = z.object({
  challengeId: z.uuid(),
  expiresAt: z.iso.datetime(),
  /**
   * W2: which second factor the challenge expects. `sms` is the legacy OTP to
   * the registered mobile; `totp` means this admin enrolled an authenticator
   * and no SMS is sent. The console branches its prompt on this.
   */
  method: z.enum(['sms', 'totp']),
});
export type AdminLoginChallenge = z.infer<typeof adminLoginChallengeSchema>;

export const adminOtpVerifyRequestSchema = z.object({
  challengeId: z.uuid(),
  /**
   * W2: the SMS code, the TOTP code (both 6 digits) or an 8-char recovery
   * code. Length tells the server which check to run — the box on the login
   * page accepts either, and recovery entry needs no second screen.
   */
  otp: z.string().regex(/^(\d{6}|[A-Za-z0-9_-]{8})$/),
});
export type AdminOtpVerifyRequest = z.infer<typeof adminOtpVerifyRequestSchema>;

export const adminIdentitySchema = z.object({
  id: z.uuid(),
  email: z.string(),
  name: z.string(),
  subRole: adminSubRoleSchema,
  /** W2: the console gates the TOTP enrolment prompt on this (additive, A7 rule). */
  twofaEnabled: z.boolean(),
});
export type AdminIdentity = z.infer<typeof adminIdentitySchema>;

export const adminSessionSchema = sessionTokensSchema.extend({
  admin: adminIdentitySchema,
});
export type AdminSession = z.infer<typeof adminSessionSchema>;

/**
 * W1 §3.6 — one row of `GET /v1/admin/auth/sessions`.
 *
 * `id` is the refresh-token FAMILY id, because that is the unit a revoke kills
 * and the unit logout already revokes. Deliberately named `adminActiveSession`
 * rather than reusing `adminSession`, which is the login response above — the
 * two shapes are different and a shared name would invite a mix-up.
 */
export const adminActiveSessionSchema = z.object({
  id: z.uuid(),
  /** Last writer wins, same as the audit trail: rotation copies the context forward. */
  ip: z.string().nullable(),
  userAgent: z.string().nullable(),
  createdAt: z.iso.datetime(),
  lastUsedAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
});
export type AdminActiveSession = z.infer<typeof adminActiveSessionSchema>;

export const adminSessionsResponseSchema = z.object({
  sessions: z.array(adminActiveSessionSchema),
});
export type AdminSessionsResponse = z.infer<typeof adminSessionsResponseSchema>;

/**
 * POST /v1/admin/drivers/:id/kyc — the §3.1 approval gate.
 *
 * Phase 10 shipped `approve | reject | suspend | reactivate` as the ONLY admin
 * action, to make "a `support` admin cannot approve KYC" testable rather than
 * aspirational and to give `drivers.approved_by` its first writer. Phase 11
 * adds `request_info` (kicks a `pending` driver back to `incomplete` with a
 * reason, distinct from an outright `reject`) plus the queue, per-document
 * review and the console around all of it (`admin/drivers.ts`).
 */
export const adminKycDecisionSchema = z
  .object({
    decision: z.enum(['approve', 'reject', 'request_info', 'suspend', 'reactivate']),
    /** Required for `reject`/`request_info` — a driver told only the verdict cannot act on it. */
    reason: z.string().min(3).max(500).optional(),
    /**
     * A14's suspension mode, only meaningful with `decision: 'suspend'`.
     * `after_current_job` (default) shelves the suspension until the driver's
     * live booking completes; `immediate` applies it at once and is refused
     * while a live booking exists (the reassign/cancel disposition is W8).
     */
    mode: z.enum(['after_current_job', 'immediate']).optional(),
    /**
     * The driver's name EXACTLY AS PRINTED ON THE LICENCE, typed by the admin
     * who is looking at the scan. Only meaningful with `decision: 'approve'`;
     * ignored on every other decision, because no other decision involves
     * anyone reading the document.
     *
     * WHY THIS FIELD EXISTS (Ehsan, 23 Sep). A driver's name comes from their
     * driving licence — drivers cannot edit it themselves, which is why
     * `driverProfileUpdateSchema` carries only `email`. But until now nothing
     * ever READ the name off the licence: the account carried whatever the
     * fleet typed at invite, so "the name comes from the licence" was a rule
     * with no mechanism behind it. The admin reviewing the document is the only
     * party who has both the licence and the authority, so the moment of
     * approval is the only honest place to capture it.
     *
     * OPTIONAL, NOT REQUIRED, and that is a real limitation rather than a
     * preference: `POST /kyc/bulk` approves many drivers in one call and cannot
     * carry a name per driver, so requiring it here would either break bulk
     * approval or push a fake value through it. A driver approved without this
     * keeps the invited name, unchanged and unverified — see ToBeDoneEhsan.md.
     */
    licenceName: z.string().trim().min(1).max(120).optional(),
  })
  .refine((body) => !['reject', 'request_info'].includes(body.decision) || Boolean(body.reason), {
    message: 'A reason is required',
    path: ['reason'],
  });
export type AdminKycDecision = z.infer<typeof adminKycDecisionSchema>;

export const adminKycResultSchema = z.object({
  driverId: z.uuid(),
  kycStatus: kycStatusSchema,
  rejectionReason: z.string().nullable(),
  /** How many live sessions the decision revoked — 0 unless it removed authority. */
  sessionsRevoked: z.number().int().nonnegative(),
  /** A14: true when the suspension is shelved until the live job completes. */
  suspensionPending: z.boolean(),
});
export type AdminKycResult = z.infer<typeof adminKycResultSchema>;
