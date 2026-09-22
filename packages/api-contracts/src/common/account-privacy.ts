import { z } from 'zod';

/**
 * §20.4 DPDP — consent capture, account deletion and data export. Dual-realm
 * (customer AND driver both get these three routes on their own `/v1/me`), so
 * these live in `common/` per the flat-barrel rule: a name declared in two
 * realm folders is a build error, same reasoning as `kycStatusSchema`.
 */

/**
 * A deletion request's workflow vocabulary (W19). Declared here rather than in
 * `admin/privacy.ts` because both realms read it: the customer POST returns
 * the row's status, and the admin lane advances it. The migration's CHECK is
 * pinned against this union by `migration-0033.spec.ts`.
 */
export const DELETION_REQUEST_STATUSES = [
  'requested',
  'on_hold',
  'approved',
  'executing',
  'completed',
  'rejected',
] as const;
export const deletionRequestStatusSchema = z.enum(DELETION_REQUEST_STATUSES);
export type DeletionRequestStatus = z.infer<typeof deletionRequestStatusSchema>;

export const consentPolicyTypeSchema = z.enum(['privacy_policy', 'terms_of_service']);
export type ConsentPolicyType = z.infer<typeof consentPolicyTypeSchema>;

/** `POST /v1/me/consent` — first-run capture, versioned so a policy change can force re-consent later. */
export const consentRecordRequestSchema = z.object({
  policyType: consentPolicyTypeSchema,
  policyVersion: z.string().min(1),
});
export type ConsentRecordRequest = z.infer<typeof consentRecordRequestSchema>;

export const consentActionSchema = z.enum(['granted', 'withdrawn']);
export type ConsentAction = z.infer<typeof consentActionSchema>;

export const consentRecordSchema = z.object({
  policyType: consentPolicyTypeSchema,
  policyVersion: z.string(),
  action: consentActionSchema,
  consentedAt: z.iso.datetime(),
});
export type ConsentRecord = z.infer<typeof consentRecordSchema>;

/**
 * `POST /v1/me/consent/withdraw`.
 *
 * WHAT WITHDRAWAL MEANS HERE (Ehsan, 23 Sep): marketing stops; the account
 * keeps working. Bookings, receipts and safety messages continue, because they
 * are how MiTow runs a trip the customer has paid for — stopping those would
 * be abandoning a service mid-delivery rather than respecting a preference.
 * A customer who wants the account gone has `DELETE /v1/me` for that, and the
 * app says so at the point of withdrawal rather than making this button mean
 * two different things.
 */
export const consentWithdrawRequestSchema = z.object({
  policyType: consentPolicyTypeSchema,
});
export type ConsentWithdrawRequest = z.infer<typeof consentWithdrawRequestSchema>;

/**
 * `DELETE /v1/me` request body — a reason is optional, never required to act
 * on your own data. `.default({})` rather than `.optional()` on the whole
 * object: a DELETE commonly carries no body at all, which arrives here as
 * `undefined`, not `{}` — without the default, `ZodValidationPipe` 422s a
 * perfectly ordinary "delete my account, no reason given" request.
 */
export const accountDeletionRequestSchema = z
  .object({
    reason: z.string().max(500).optional(),
  })
  .default({});
export type AccountDeletionRequest = z.infer<typeof accountDeletionRequestSchema>;

/**
 * `DELETE /v1/me` response — files a request; Phase 20's retention/erasure
 * worker executes it. Not a hard delete here: bookings/ledger rows FK to the
 * subject and must survive for accounting/audit history.
 */
export const accountDeletionResponseSchema = z.object({
  requestId: z.uuid(),
  /**
   * The row's CURRENT status, not a creation literal. `POST /v1/me` still
   * always creates one in `requested`, but the console owns the workflow from
   * there (hold, approve, execute) and a widened enum costs nothing at the one
   * call site while sparing a client a second schema when it re-reads a row.
   */
  status: deletionRequestStatusSchema,
  requestedAt: z.iso.datetime(),
});
export type AccountDeletionResponse = z.infer<typeof accountDeletionResponseSchema>;

/**
 * `GET /v1/me/export` — sections keyed by resource name so a later phase can
 * append one without a breaking change. A driver's export has no
 * vehicles/addresses/emergencyContacts section (those are customer-only
 * tables) — `undefined` there, not an empty array, so a client can tell
 * "doesn't apply to this realm" apart from "applies and is empty."
 */
export const accountExportResponseSchema = z.object({
  profile: z.record(z.string(), z.unknown()).nullable(),
  vehicles: z.array(z.record(z.string(), z.unknown())).optional(),
  addresses: z.array(z.record(z.string(), z.unknown())).optional(),
  emergencyContacts: z.array(z.record(z.string(), z.unknown())).optional(),
  consents: z.array(consentRecordSchema),
});
export type AccountExportResponse = z.infer<typeof accountExportResponseSchema>;
