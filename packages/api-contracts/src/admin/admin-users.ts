import { z } from 'zod';
import { adminSubRoleSchema } from '../common/enums';
import { pageEnvelopeSchema, pageQuerySchema } from '../common/pagination';

/**
 * Admin user management (W2, spec §4.2 "Manage admins & roles", §9.4.1).
 *
 * `admin.manage` throughout — super_admin only. The detail and list shapes
 * NEVER carry `password_hash`, `twofa_secret_enc` (or the legacy
 * `twofa_secret`): `redactAdminForAudit` in the backend enforces the same
 * projection on audit before/after rows, and `admin-users.e2e.spec.ts`
 * asserts the keys are absent by enumeration.
 */

export const adminAccountStatusSchema = z.enum(['active', 'suspended', 'deleted']);
export type AdminAccountStatus = z.infer<typeof adminAccountStatusSchema>;

export const adminAdminListItemSchema = z.object({
  id: z.uuid(),
  email: z.email(),
  name: z.string(),
  mobile: z.string(),
  subRole: adminSubRoleSchema,
  status: adminAccountStatusSchema,
  twofaEnabled: z.boolean(),
  receivesOpsAlerts: z.boolean(),
  mustChangePassword: z.boolean(),
  lastLoginAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
});
export type AdminAdminListItem = z.infer<typeof adminAdminListItemSchema>;

export const adminAdminsQuerySchema = pageQuerySchema.extend({
  subRole: adminSubRoleSchema.optional(),
  status: adminAccountStatusSchema.optional(),
  q: z.string().trim().min(2).max(100).optional(),
});
export type AdminAdminsQuery = z.infer<typeof adminAdminsQuerySchema>;

export const adminAdminsListResponseSchema = pageEnvelopeSchema(adminAdminListItemSchema);
export type AdminAdminsListResponse = z.infer<typeof adminAdminsListResponseSchema>;

export const adminAdminDetailSchema = adminAdminListItemSchema.extend({
  createdBy: z.uuid().nullable(),
  deactivatedAt: z.iso.datetime().nullable(),
  deactivatedBy: z.uuid().nullable(),
  twofaConfirmedAt: z.iso.datetime().nullable(),
});
export type AdminAdminDetail = z.infer<typeof adminAdminDetailSchema>;

/**
 * Create invites by setting a temporary password, returned ONCE in the
 * response. SES is still sandboxed, so email invites cannot be relied on —
 * the creating super admin hands the password over out of band instead.
 */
export const adminCreateAdminSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.email(),
  mobile: z.string().trim().min(7).max(20),
  subRole: adminSubRoleSchema,
  receivesOpsAlerts: z.boolean().optional(),
});
export type AdminCreateAdmin = z.infer<typeof adminCreateAdminSchema>;

export const adminCreateAdminResponseSchema = z.object({
  admin: adminAdminDetailSchema,
  /** Single reveal — the backend never stores or returns it again. */
  temporaryPassword: z.string(),
});
export type AdminCreateAdminResponse = z.infer<typeof adminCreateAdminResponseSchema>;

export const adminUpdateAdminSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  subRole: adminSubRoleSchema.optional(),
  receivesOpsAlerts: z.boolean().optional(),
  /** Reason is required: a role change without one is unauditable. */
  reason: z.string().trim().min(5).max(500),
});
export type AdminUpdateAdmin = z.infer<typeof adminUpdateAdminSchema>;

export const adminDeactivateAdminSchema = z.object({
  reason: z.string().trim().min(5).max(500),
});
export type AdminDeactivateAdmin = z.infer<typeof adminDeactivateAdminSchema>;

/** Password reset issues a temporary password AND sets the forced-change flag. */
export const adminResetPasswordResponseSchema = z.object({
  adminId: z.uuid(),
  /** Single reveal, like creation. */
  temporaryPassword: z.string(),
});
export type AdminResetPasswordResponse = z.infer<typeof adminResetPasswordResponseSchema>;

// --- TOTP self-service -----------------------------------------------------

export const adminTotpEnrollResponseSchema = z.object({
  /** The API returns the URI; the WEB renders the QR (guide §W2). */
  otpauthUri: z.string(),
  /** Masked, so the enrol screen can say which secret it is confirming. */
  secretPreview: z.string(),
});
export type AdminTotpEnrollResponse = z.infer<typeof adminTotpEnrollResponseSchema>;

export const adminTotpConfirmSchema = z.object({
  code: z.string().regex(/^\d{6}$/),
});
export type AdminTotpConfirm = z.infer<typeof adminTotpConfirmSchema>;

export const adminTotpDisableSchema = z.object({
  reason: z.string().trim().min(5).max(500),
});
export type AdminTotpDisable = z.infer<typeof adminTotpDisableSchema>;

/** Recovery codes are shown ONCE at generation; only hashes are stored. */
export const adminRecoveryCodesResponseSchema = z.object({
  codes: z.array(z.string()).min(1).max(20),
});
export type AdminRecoveryCodesResponse = z.infer<typeof adminRecoveryCodesResponseSchema>;

// --- Forced password change -------------------------------------------------

export const adminPasswordPolicySchema = z
  .string()
  .min(8)
  .max(128)
  .regex(/[A-Z]/, 'needs an uppercase letter')
  .regex(/[0-9]/, 'needs a digit');
export type AdminPasswordPolicy = z.infer<typeof adminPasswordPolicySchema>;

/**
 * Completes a forced change with the still-live login challenge — no session
 * exists yet at this point (verify refused to mint one), so the challenge is
 * the only authority this route accepts.
 */
export const adminCompletePasswordChangeSchema = z.object({
  challengeId: z.uuid(),
  newPassword: adminPasswordPolicySchema,
});
export type AdminCompletePasswordChange = z.infer<typeof adminCompletePasswordChangeSchema>;
