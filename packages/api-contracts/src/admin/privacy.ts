import { z } from 'zod';
import {
  accountExportResponseSchema,
  deletionRequestStatusSchema,
} from '../common/account-privacy';
import { pageEnvelopeSchema, pageQuerySchema } from '../common/pagination';

/**
 * W19 — the privacy console (§20.4 DPDP), `/admin/privacy`.
 *
 * THE QUEUE IS THE COMPLIANCE ARTEFACT. A deletion request is not a button
 * that deletes: it is a workflow (requested → approved → executing →
 * completed, with `on_hold` and `rejected` as the two ways it stops) whose row
 * survives the erasure it authorised. The detail envelope therefore carries the
 * erasure job's ordered step log verbatim — "what exactly did we delete, and
 * when" is the question a regulator asks, and the answer has to be data, not a
 * log file.
 *
 * `subjectLabel` is a display convenience resolved at read time from
 * `users`/`drivers` — null once the subject has been anonymised, because by
 * then there is no name left to show and showing the tombstone (`deleted:<id>`)
 * as if it were a person would be worse than showing nothing.
 */

export const ADMIN_PRIVACY_SUBJECT_TYPES = ['user', 'driver'] as const;
export const adminPrivacySubjectTypeSchema = z.enum(ADMIN_PRIVACY_SUBJECT_TYPES);

export const ERASURE_JOB_STATUSES = ['queued', 'running', 'completed', 'failed'] as const;
export const erasureJobStatusSchema = z.enum(ERASURE_JOB_STATUSES);

export const erasureStepLogEntrySchema = z.object({
  step: z.string(),
  outcome: z.enum(['done', 'skipped', 'refused']),
  /** Rows touched (or objects deleted) by the step. */
  count: z.number().int(),
  detail: z.string().optional(),
  at: z.iso.datetime(),
});
export type ErasureStepLogEntry = z.infer<typeof erasureStepLogEntrySchema>;

export const erasureJobSchema = z.object({
  id: z.uuid(),
  status: erasureJobStatusSchema,
  steps: z.array(erasureStepLogEntrySchema),
  /** The hold reason or exception when `failed`. */
  error: z.string().nullable(),
  startedAt: z.iso.datetime().nullable(),
  finishedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
});
export type ErasureJob = z.infer<typeof erasureJobSchema>;

export const adminDeletionRequestSchema = z.object({
  id: z.uuid(),
  subjectType: adminPrivacySubjectTypeSchema,
  subjectId: z.uuid(),
  /** Masked name/mobile when the subject still exists; null once anonymised. */
  subjectLabel: z.string().nullable(),
  status: deletionRequestStatusSchema,
  /** The subject's own words, when they gave any. */
  reason: z.string().nullable(),
  holdReason: z.string().nullable(),
  decidedBy: z.uuid().nullable(),
  decidedAt: z.iso.datetime().nullable(),
  executedAt: z.iso.datetime().nullable(),
  anonymisedAt: z.iso.datetime().nullable(),
  requestedAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  /** The most recent execution attempt, or null while none has run. */
  latestJob: erasureJobSchema.nullable(),
});
export type AdminDeletionRequest = z.infer<typeof adminDeletionRequestSchema>;

export const adminDeletionRequestsQuerySchema = pageQuerySchema.extend({
  status: deletionRequestStatusSchema.optional(),
  subjectType: adminPrivacySubjectTypeSchema.optional(),
});
export type AdminDeletionRequestsQuery = z.infer<typeof adminDeletionRequestsQuerySchema>;

export const adminDeletionRequestsResponseSchema = pageEnvelopeSchema(adminDeletionRequestSchema);
export type AdminDeletionRequestsResponse = z.infer<
  typeof adminDeletionRequestsResponseSchema
>;

/** `POST …/approve|reject` — a reason is optional; the audit row carries who. */
export const adminDeletionDecisionSchema = z
  .object({ reason: z.string().trim().max(500).optional() })
  .default({});
export type AdminDeletionDecision = z.infer<typeof adminDeletionDecisionSchema>;

/** `POST …/hold` — the reason is REQUIRED. A parked legal obligation with no explanation is a bug. */
export const adminDeletionHoldSchema = z.object({
  reason: z.string().trim().min(3).max(500),
});
export type AdminDeletionHold = z.infer<typeof adminDeletionHoldSchema>;

export const RETENTION_ENFORCED_KEYS = [
  'location_paths',
  'delivery_logs',
  'webhook_events',
] as const;

export const adminRetentionPolicySchema = z.object({
  policyKey: z.string(),
  retentionDays: z.number().int(),
  description: z.string(),
  /**
   * Whether the nightly sweep actually deletes by this row. `false` for the
   * regimes that are policy-only (KYC's regulatory floor, the audit trail, and
   * `wave_logs` which the analytics job purges on the same 30-day clock) —
   * rendered so an operator reading "7 years" knows it is a floor, not a
   * scheduled DELETE.
   */
  enforced: z.boolean(),
  updatedAt: z.iso.datetime(),
});
export type AdminRetentionPolicy = z.infer<typeof adminRetentionPolicySchema>;

export const adminRetentionPoliciesResponseSchema = z.object({
  items: z.array(adminRetentionPolicySchema),
});
export type AdminRetentionPoliciesResponse = z.infer<
  typeof adminRetentionPoliciesResponseSchema
>;

export const adminRetentionUpdateSchema = z.object({
  policies: z
    .array(
      z.object({
        policyKey: z.string().trim().min(1).max(60),
        /** Bounded at 100 years — a fat-finger `999999` must not read as "keep forever". */
        retentionDays: z.number().int().min(1).max(36_500),
      }),
    )
    .min(1)
    .max(20),
});
export type AdminRetentionUpdate = z.infer<typeof adminRetentionUpdateSchema>;

/**
 * `POST /admin/users/:id/correct` — DPDP's correction right, served by an
 * operator on a request. At least one field must actually change; `reason` is
 * required so the audit row says WHY someone's identity was edited.
 */
export const adminUserCorrectionSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    email: z.email().optional(),
    mobile: z
      .string()
      .trim()
      .regex(/^\d{10}$/, 'mobile must be 10 digits')
      .optional(),
    reason: z.string().trim().min(3).max(500),
  })
  .refine(
    (body) => body.name !== undefined || body.email !== undefined || body.mobile !== undefined,
    { message: 'at least one of name, email or mobile is required' },
  );
export type AdminUserCorrection = z.infer<typeof adminUserCorrectionSchema>;

export const adminUserCorrectionResponseSchema = z.object({
  id: z.uuid(),
  name: z.string().nullable(),
  email: z.string().nullable(),
  mobile: z.string(),
});
export type AdminUserCorrectionResponse = z.infer<typeof adminUserCorrectionResponseSchema>;

/**
 * `GET /admin/users/:id/export` — the operator-served access request. The
 * profile/consent/vehicle sections are the SAME shape `/v1/me/export` returns
 * (one builder feeds both, so a customer and the operator acting for them
 * cannot receive different data); the booking list is added because an
 * operator has no app to open and "what has this person booked" is the first
 * question an access request asks.
 */
export const adminSubjectExportResponseSchema = accountExportResponseSchema.extend({
  subjectType: adminPrivacySubjectTypeSchema,
  subjectId: z.uuid(),
  generatedAt: z.iso.datetime(),
  bookings: z.array(
    z.object({
      id: z.uuid(),
      status: z.string(),
      /** Domain tables store rupees as NUMERIC — the export passes them through raw. */
      total: z.string(),
      createdAt: z.iso.datetime(),
      completedAt: z.iso.datetime().nullable(),
    }),
  ),
});
export type AdminSubjectExportResponse = z.infer<typeof adminSubjectExportResponseSchema>;
