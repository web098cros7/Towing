import { z } from 'zod';
import { docReviewStatusSchema, driverDocTypeSchema, kycStatusSchema } from '../common/enums';
import { pageEnvelopeSchema, pageQuerySchema } from '../common/pagination';
import { driverCapabilitiesResponseSchema, driverCapabilitiesUpdateSchema } from '../driver/kyc';
import { vehicleClassSchema } from '../fleet/trucks';
import { adminKycResultSchema } from './auth';
import { adminDirectoryBooleanQuerySchema, adminDirectoryBookingSchema } from './directory';

/**
 * Admin KYC queue + per-document review (Phase 11, `modules/admin-drivers`) —
 * the console built on top of Phase 10's single `POST .../kyc` decision route.
 */

export const adminPendingDocumentSchema = z.object({
  id: z.uuid(),
  docType: driverDocTypeSchema,
  status: docReviewStatusSchema,
  rejectionReason: z.string().nullable(),
  /** Short-TTL `storage.presignGet()` URL — re-fetch the queue once it expires, don't cache it. */
  thumbnailUrl: z.url(),
});
export type AdminPendingDocument = z.infer<typeof adminPendingDocumentSchema>;

/**
 * `GET /v1/admin/drivers/pending` — scoped to `kyc_status = 'pending'` only (§3.1: "submitted and awaiting a
 * human"). W7 paginated it: the queue is the one list that grows with supply.
 */
export const adminPendingDriversQuerySchema = pageQuerySchema;
export type AdminPendingDriversQuery = z.infer<typeof adminPendingDriversQuerySchema>;

/**
 * W7's "GPS on map", shipped as what the data actually is: the driver's LAST
 * KNOWN location. No document carries capture-time coordinates — that is a
 * phase-2 contract change and a driver-app release away.
 */
export const adminPendingDriverLocationSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  /** `drivers.last_ping_at` — the moment the position was observed. */
  at: z.iso.datetime(),
});
export type AdminPendingDriverLocation = z.infer<typeof adminPendingDriverLocationSchema>;

export const adminPendingDriverSchema = z.object({
  id: z.uuid(),
  name: z.string().nullable(),
  mobile: z.string(),
  vehicleClass: vehicleClassSchema.nullable(),
  longDistanceEnabled: z.boolean(),
  kycSubmittedAt: z.iso.datetime().nullable(),
  /** Null for a driver who never pinged — the drawer says so instead of drawing an empty map. */
  lastKnownLocation: adminPendingDriverLocationSchema.nullable(),
  documents: z.array(adminPendingDocumentSchema),
});
export type AdminPendingDriver = z.infer<typeof adminPendingDriverSchema>;

export const adminPendingDriversResponseSchema = pageEnvelopeSchema(adminPendingDriverSchema);
export type AdminPendingDriversResponse = z.infer<typeof adminPendingDriversResponseSchema>;

/**
 * `GET /v1/admin/drivers/:id/document-versions` — W7's history.
 *
 * One row per UPLOAD, not per review: a version is created `pending` on
 * `confirm()` and completed when an admin reviews it. `supersededAt` marks a
 * file that a later resubmission replaced, so the old object stays viewable
 * (and W19's erasure can still find it).
 */
export const adminDriverDocumentVersionSchema = z.object({
  id: z.uuid(),
  docType: driverDocTypeSchema,
  status: docReviewStatusSchema,
  rejectionReason: z.string().nullable(),
  verifiedBy: z.uuid().nullable(),
  verifiedAt: z.iso.datetime().nullable(),
  supersededAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  /** Short-TTL presigned GET for this version's own object — superseded ones included. */
  thumbnailUrl: z.url(),
});
export type AdminDriverDocumentVersion = z.infer<typeof adminDriverDocumentVersionSchema>;

export const adminDriverDocumentVersionsResponseSchema = z.object({
  items: z.array(adminDriverDocumentVersionSchema),
});
export type AdminDriverDocumentVersionsResponse = z.infer<
  typeof adminDriverDocumentVersionsResponseSchema
>;

/**
 * `POST /v1/admin/drivers/:id/documents/:docId/review` — genuinely new in
 * Phase 11: Phase 10 only ever decided at the driver level, never per-document.
 */
export const adminDocumentReviewSchema = z
  .object({
    decision: z.enum(['approve', 'reject']),
    reason: z.string().min(3).max(500).optional(),
  })
  .refine((body) => body.decision !== 'reject' || Boolean(body.reason), {
    message: 'A rejection reason is required',
    path: ['reason'],
  });
export type AdminDocumentReview = z.infer<typeof adminDocumentReviewSchema>;

export const adminDocumentReviewResultSchema = z.object({
  documentId: z.uuid(),
  docType: driverDocTypeSchema,
  status: docReviewStatusSchema,
  rejectionReason: z.string().nullable(),
});
export type AdminDocumentReviewResult = z.infer<typeof adminDocumentReviewResultSchema>;

/** `PUT /v1/admin/drivers/:id/capabilities` — same shape as the driver's own self-service PUT (`driver/kyc.ts`); admin can additionally revoke the §3.2 long-haul opt-in. */
export const adminCapabilitiesUpdateSchema = driverCapabilitiesUpdateSchema;
export type AdminCapabilitiesUpdate = z.infer<typeof adminCapabilitiesUpdateSchema>;

export const adminCapabilitiesResponseSchema = driverCapabilitiesResponseSchema;
export type AdminCapabilitiesResponse = z.infer<typeof adminCapabilitiesResponseSchema>;

// ---------------------------------------------------------------------------
// W7: bulk decisions
// ---------------------------------------------------------------------------

/**
 * `POST /v1/admin/drivers/kyc/bulk` — capped at 50 for the reason §9.4.3
 * gives: bulk approval is exactly the action the spec wants a human on.
 *
 * A bulk REJECT always carries one shared reason (the refine below); a single
 * reject without a reason is refused by `adminKycDecisionSchema` too, and a
 * bulk path must not be the way around that.
 */
export const adminKycBulkRequestSchema = z
  .object({
    decision: z.enum(['approve', 'reject']),
    driverIds: z.array(z.uuid()).min(1).max(50),
    reason: z.string().trim().min(3).max(500).optional(),
  })
  .refine((body) => body.decision !== 'reject' || Boolean(body.reason), {
    message: 'A shared rejection reason is required',
    path: ['reason'],
  });
export type AdminKycBulkRequest = z.infer<typeof adminKycBulkRequestSchema>;

/**
 * PER-ITEM RESULTS, never all-or-nothing: one driver holding a live booking or
 * a driver who was already decided elsewhere must not roll back the other 49.
 */
export const adminKycBulkItemResultSchema = z.object({
  driverId: z.uuid(),
  ok: z.boolean(),
  /** The driver's status after the decision; null on failure. */
  kycStatus: kycStatusSchema.nullable(),
  error: z
    .object({
      /** An `ErrorCodes` value — typed as text so a new code needs no contract bump. */
      code: z.string(),
      message: z.string(),
    })
    .nullable(),
});
export type AdminKycBulkItemResult = z.infer<typeof adminKycBulkItemResultSchema>;

export const adminKycBulkResponseSchema = z.object({
  decision: z.enum(['approve', 'reject']),
  succeeded: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  results: z.array(adminKycBulkItemResultSchema),
});
export type AdminKycBulkResponse = z.infer<typeof adminKycBulkResponseSchema>;

// ---------------------------------------------------------------------------
// W6: the drivers directory (§9.4.4) — search, detail, suspension, zones
// ---------------------------------------------------------------------------

/**
 * `GET /v1/admin/drivers` — same search rules as the users directory (trigram
 * name, exact mobile, id prefix), plus the §3.2 facts an operator filters by.
 */
export const adminDriversDirectoryQuerySchema = pageQuerySchema.extend({
  q: z.string().trim().min(1).optional(),
  kycStatus: kycStatusSchema.optional(),
  online: adminDirectoryBooleanQuerySchema.optional(),
  longDistance: adminDirectoryBooleanQuerySchema.optional(),
  zoneId: z.uuid().optional(),
  fleetId: z.uuid().optional(),
  vehicleClass: vehicleClassSchema.optional(),
  minRating: z.coerce.number().min(0).max(5).optional(),
});
export type AdminDriversDirectoryQuery = z.infer<typeof adminDriversDirectoryQuerySchema>;

export const adminDriverDirectoryItemSchema = z.object({
  id: z.uuid(),
  name: z.string().nullable(),
  mobile: z.string(),
  kycStatus: kycStatusSchema,
  isOnline: z.boolean(),
  lastPingAt: z.iso.datetime().nullable(),
  zoneId: z.uuid().nullable(),
  zoneName: z.string().nullable(),
  fleetId: z.uuid().nullable(),
  fleetName: z.string().nullable(),
  vehicleClass: vehicleClassSchema.nullable(),
  longDistanceEnabled: z.boolean(),
  /** 0–5; still a seeded default until Phase 19 writes it. */
  rating: z.number().nullable(),
  /** A14: a live job shelves the suspension until it ends. */
  suspensionPending: z.boolean(),
  suspendedAt: z.iso.datetime().nullable(),
  suspensionReason: z.string().nullable(),
  createdAt: z.iso.datetime(),
});
export type AdminDriverDirectoryItem = z.infer<typeof adminDriverDirectoryItemSchema>;

export const adminDriversDirectoryResponseSchema = pageEnvelopeSchema(
  adminDriverDirectoryItemSchema,
);
export type AdminDriversDirectoryResponse = z.infer<typeof adminDriversDirectoryResponseSchema>;

/** One §6.10 zone reference, for the restrictions editor and its reads. */
export const adminDriverZoneRefSchema = z.object({ zoneId: z.uuid(), name: z.string() });
export type AdminDriverZoneRef = z.infer<typeof adminDriverZoneRefSchema>;

export const adminDriverDirectoryDetailSchema = adminDriverDirectoryItemSchema.extend({
  /** Lifetime booking count — the detail header's stat. */
  bookingsCount: z.number().int().nonnegative(),
  /** §6.10: the zones this driver is BLOCKED from (denylist — see the repo). */
  zoneRestrictions: z.array(adminDriverZoneRefSchema),
});
export type AdminDriverDirectoryDetail = z.infer<typeof adminDriverDirectoryDetailSchema>;

export const adminDriverBookingsResponseSchema = pageEnvelopeSchema(adminDirectoryBookingSchema);
export type AdminDriverBookingsResponse = z.infer<typeof adminDriverBookingsResponseSchema>;

/** The driver's trips list takes the same page query as the user's. */
export const adminDriverBookingsQuerySchema = pageQuerySchema;
export type AdminDriverBookingsQuery = z.infer<typeof adminDriverBookingsQuerySchema>;

/**
 * `POST /v1/admin/drivers/:id/suspend` — the dedicated A14 route (the KYC
 * decision route keeps its own contract). `mode` is A14's shelf: the default
 * lets the driver finish a live job, `immediate` is refused while one exists
 * (the reassign/cancel disposition is W8).
 */
export const adminDriverSuspendBodySchema = z.object({
  reason: z.string().trim().min(3).max(500),
  mode: z.enum(['after_current_job', 'immediate']).optional(),
});
export type AdminDriverSuspendBody = z.infer<typeof adminDriverSuspendBodySchema>;

/** Suspend and reactivate both answer with the A14 result the console already renders. */
export const adminDriverDecisionResponseSchema = adminKycResultSchema;
export type AdminDriverDecisionResponse = z.infer<typeof adminDriverDecisionResponseSchema>;

export const adminDriverZonesUpdateSchema = z.object({
  /** Full replacement — the editor saves the new set, not a delta. */
  zoneIds: z.array(z.uuid()).max(500),
});
export type AdminDriverZonesUpdate = z.infer<typeof adminDriverZonesUpdateSchema>;

export const adminDriverZonesResponseSchema = z.object({
  driverId: z.uuid(),
  zoneRestrictions: z.array(adminDriverZoneRefSchema),
});
export type AdminDriverZonesResponse = z.infer<typeof adminDriverZonesResponseSchema>;
