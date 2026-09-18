import { z } from 'zod';
import { otpCodeSchema, sessionTokensSchema } from '../common/auth';
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
  otp: otpCodeSchema,
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
