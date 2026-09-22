import { z } from 'zod';

/**
 * The audit viewer (§3.5, §20.4).
 *
 * One shape for both consumers: the full feed (`GET /v1/admin/audit`) and the
 * subject-scoped timeline that every detail screen renders from the same
 * endpoint with `?subjectType=&subjectId=`. The DETAIL shape adds the
 * before/after snapshots, which the list deliberately omits — a 50-row feed of
 * whole-row JSON is not a list, it is a database dump.
 */

export const adminAuditEntrySchema = z.object({
  id: z.uuid(),
  adminId: z.uuid(),
  /** Dotted verb, e.g. `driver.kyc.approve`. Free text by design — the set grows every phase. */
  action: z.string(),
  subjectType: z.string(),
  subjectId: z.uuid().nullable(),
  reason: z.string().nullable(),
  ip: z.string().nullable(),
  userAgent: z.string().nullable(),
  createdAt: z.iso.datetime(),
});
export type AdminAuditEntry = z.infer<typeof adminAuditEntrySchema>;

export const adminAuditDetailSchema = adminAuditEntrySchema.extend({
  /**
   * Whole-row snapshots as recorded. `unknown` rather than a structured type:
   * the shape belongs to the action that wrote the row (`driver.kyc.approve`
   * stores a driver slice, `admin.session_revoke` a session slice), and a
   * union here would have to grow in lockstep with every writer.
   */
  before: z.unknown().nullable(),
  after: z.unknown().nullable(),
});
export type AdminAuditDetail = z.infer<typeof adminAuditDetailSchema>;

export const adminAuditListResponseSchema = z.object({
  entries: z.array(adminAuditEntrySchema),
  /**
   * Opaque keyset cursor — the last row's `(created_at, id)`. Null means the
   * feed is exhausted. Opaque on purpose: the client echoes it back, so the
   * ordering key can change without a contract change.
   */
  nextCursor: z.string().nullable(),
});
export type AdminAuditListResponse = z.infer<typeof adminAuditListResponseSchema>;

/**
 * Query for the feed. `action` is a PREFIX filter (`driver.kyc` matches
 * `driver.kyc.approve` and `driver.kyc.reject`), which is how the console's
 * "show me every KYC decision" view is expressed without a facet list.
 */
export const adminAuditQuerySchema = z.object({
  adminId: z.uuid().optional(),
  action: z.string().min(1).max(120).optional(),
  subjectType: z.string().min(1).max(50).optional(),
  subjectId: z.uuid().optional(),
  from: z.iso.datetime().optional(),
  to: z.iso.datetime().optional(),
  cursor: z.string().max(300).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});
export type AdminAuditQuery = z.infer<typeof adminAuditQuerySchema>;
