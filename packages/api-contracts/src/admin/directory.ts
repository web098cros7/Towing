import { z } from 'zod';
import { unsignedPaiseSchema } from '../common/money';
import { pageEnvelopeSchema, pageQuerySchema } from '../common/pagination';
import { jobStatusSchema } from '../fleet/jobs';

/**
 * W6's directory contracts — users/drivers/fleets search and detail, suspension
 * (self-service requests included), and read-only impersonation (G8).
 *
 * The two union constants below are the source of truth for migration 0024's
 * CHECK constraints: `migration-0024.spec.ts` pins the SQL literals to these
 * lists — the house rule wherever a CHECK duplicates a TypeScript union.
 */

/** Who a suspension request can be about. */
export const SUSPENSION_REQUEST_SUBJECT_TYPES = ['user', 'driver', 'fleet'] as const;
export const suspensionRequestSubjectTypeSchema = z.enum(SUSPENSION_REQUEST_SUBJECT_TYPES);
export type SuspensionRequestSubjectType = z.infer<typeof suspensionRequestSubjectTypeSchema>;

/** The request lifecycle: `open` → `approved` | `rejected`; one open per subject. */
export const SUSPENSION_REQUEST_STATUSES = ['open', 'approved', 'rejected'] as const;
export const suspensionRequestStatusSchema = z.enum(SUSPENSION_REQUEST_STATUSES);
export type SuspensionRequestStatus = z.infer<typeof suspensionRequestStatusSchema>;

/**
 * Directory filters that are booleans on the wire. Query strings are strings;
 * anything but the literal `true`/`false` is a 400 rather than a guess.
 */
export const adminDirectoryBooleanQuerySchema = z
  .enum(['true', 'false'])
  .transform((value) => value === 'true');
export type AdminDirectoryBooleanQuery = z.infer<typeof adminDirectoryBooleanQuerySchema>;

// ---------------------------------------------------------------------------
// Users directory (§9.4.4)
// ---------------------------------------------------------------------------

/** `account_status` — rendered verbatim by the lists and detail. */
export const adminDirectoryUserStatusSchema = z.enum(['active', 'suspended', 'deleted']);

export const adminDirectoryUsersQuerySchema = pageQuerySchema.extend({
  /** Trigram over names, exact over mobiles, prefix over ids — see the repo. */
  q: z.string().trim().min(1).optional(),
  status: adminDirectoryUserStatusSchema.optional(),
});
export type AdminDirectoryUsersQuery = z.infer<typeof adminDirectoryUsersQuerySchema>;

export const adminDirectoryUserSchema = z.object({
  id: z.uuid(),
  name: z.string().nullable(),
  mobile: z.string(),
  email: z.string().nullable(),
  status: adminDirectoryUserStatusSchema,
  suspendedAt: z.iso.datetime().nullable(),
  suspensionReason: z.string().nullable(),
  createdAt: z.iso.datetime(),
});
export type AdminDirectoryUser = z.infer<typeof adminDirectoryUserSchema>;

export const adminDirectoryUsersResponseSchema = pageEnvelopeSchema(adminDirectoryUserSchema);
export type AdminDirectoryUsersResponse = z.infer<typeof adminDirectoryUsersResponseSchema>;

export const adminDirectoryUserDetailSchema = adminDirectoryUserSchema.extend({
  /** Lifetime booking count — the one stat the detail header shows. */
  bookingsCount: z.number().int().nonnegative(),
});
export type AdminDirectoryUserDetail = z.infer<typeof adminDirectoryUserDetailSchema>;

export const adminDirectoryBookingSchema = z.object({
  id: z.uuid(),
  status: jobStatusSchema,
  serviceType: z.string(),
  zoneId: z.uuid().nullable(),
  driverId: z.uuid().nullable(),
  totalPaise: unsignedPaiseSchema,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type AdminDirectoryBooking = z.infer<typeof adminDirectoryBookingSchema>;

export const adminDirectoryUserBookingsQuerySchema = pageQuerySchema;
export type AdminDirectoryUserBookingsQuery = z.infer<typeof adminDirectoryUserBookingsQuerySchema>;

export const adminDirectoryUserBookingsResponseSchema = pageEnvelopeSchema(
  adminDirectoryBookingSchema,
);
export type AdminDirectoryUserBookingsResponse = z.infer<
  typeof adminDirectoryUserBookingsResponseSchema
>;

// ---------------------------------------------------------------------------
// Suspension (§9.4.4, §4.2's request flow)
// ---------------------------------------------------------------------------

/** A reason is REQUIRED everywhere — it lands in the audit row and the request. */
export const adminDirectorySuspendBodySchema = z.object({
  reason: z.string().trim().min(4).max(500),
});
export type AdminDirectorySuspendBody = z.infer<typeof adminDirectorySuspendBodySchema>;

export const adminDirectorySuspendResponseSchema = z.object({
  subjectId: z.uuid(),
  subjectType: suspensionRequestSubjectTypeSchema,
  status: z.enum(['suspended', 'active']),
  /** Searching bookings cancelled as a side effect (users only; 0 otherwise). */
  cancelledSearchingBookings: z.number().int().nonnegative(),
});
export type AdminDirectorySuspendResponse = z.infer<typeof adminDirectorySuspendResponseSchema>;

export const adminSuspensionRequestSchema = z.object({
  id: z.uuid(),
  subjectType: suspensionRequestSubjectTypeSchema,
  subjectId: z.uuid(),
  reason: z.string(),
  status: suspensionRequestStatusSchema,
  requestedBy: z.uuid(),
  createdAt: z.iso.datetime(),
  decidedBy: z.uuid().nullable(),
  decidedAt: z.iso.datetime().nullable(),
  decisionNote: z.string().nullable(),
});
export type AdminSuspensionRequest = z.infer<typeof adminSuspensionRequestSchema>;

export const adminSuspensionRequestsResponseSchema = z.object({
  items: z.array(adminSuspensionRequestSchema),
});
export type AdminSuspensionRequestsResponse = z.infer<typeof adminSuspensionRequestsResponseSchema>;

// ---------------------------------------------------------------------------
// W6: fleets directory (§9.4.5)
// ---------------------------------------------------------------------------

/** `fleet_status` — pending (never activated) is different from suspended. */
export const adminFleetStatusSchema = z.enum(['pending', 'active', 'suspended']);

export const adminFleetsQuerySchema = pageQuerySchema.extend({
  q: z.string().trim().min(1).optional(),
  status: adminFleetStatusSchema.optional(),
});
export type AdminFleetsQuery = z.infer<typeof adminFleetsQuerySchema>;

export const adminFleetItemSchema = z.object({
  id: z.uuid(),
  businessName: z.string(),
  status: adminFleetStatusSchema,
  gstin: z.string().nullable(),
  ownerId: z.uuid(),
  ownerName: z.string().nullable(),
  ownerMobile: z.string(),
  /** The dry-run numbers the suspend confirmation shows: what goes offline. */
  driversCount: z.number().int().nonnegative(),
  onlineDriversCount: z.number().int().nonnegative(),
  trucksCount: z.number().int().nonnegative(),
  suspendedAt: z.iso.datetime().nullable(),
  suspensionReason: z.string().nullable(),
  createdAt: z.iso.datetime(),
});
export type AdminFleetItem = z.infer<typeof adminFleetItemSchema>;

export const adminFleetsResponseSchema = pageEnvelopeSchema(adminFleetItemSchema);
export type AdminFleetsResponse = z.infer<typeof adminFleetsResponseSchema>;

/**
 * The detail IS the item — the counts are what the screen needs, and a
 * separate shape under a second name would just be the same fields twice.
 */
export const adminFleetDetailSchema = adminFleetItemSchema;
export type AdminFleetDetail = z.infer<typeof adminFleetDetailSchema>;

/** A reason is required and the UI shows a typed-name confirmation. */
export const adminFleetSuspendBodySchema = z.object({
  reason: z.string().trim().min(4).max(500),
});
export type AdminFleetSuspendBody = z.infer<typeof adminFleetSuspendBodySchema>;

export const adminFleetSuspensionResponseSchema = z.object({
  fleetId: z.uuid(),
  status: adminFleetStatusSchema,
  /** Drivers affected — the confirmation's number, echoed back. */
  driverCount: z.number().int().nonnegative(),
});
export type AdminFleetSuspensionResponse = z.infer<typeof adminFleetSuspensionResponseSchema>;

export const adminSuspensionRequestsQuerySchema = z.object({
  status: suspensionRequestStatusSchema.optional(),
});
export type AdminSuspensionRequestsQuery = z.infer<typeof adminSuspensionRequestsQuerySchema>;

export const adminSuspensionRequestCreateBodySchema = z.object({
  subjectType: suspensionRequestSubjectTypeSchema,
  subjectId: z.uuid(),
  reason: z.string().trim().min(4).max(500),
});
export type AdminSuspensionRequestCreateBody = z.infer<
  typeof adminSuspensionRequestCreateBodySchema
>;

export const adminSuspensionRequestDecisionBodySchema = z.object({
  note: z.string().trim().max(500).optional(),
});
export type AdminSuspensionRequestDecisionBody = z.infer<
  typeof adminSuspensionRequestDecisionBodySchema
>;

// ---------------------------------------------------------------------------
// W6: the zone picker (C9) — directory filters and the restrictions editor
// ---------------------------------------------------------------------------

/** Id/name/active is everything the pickers show; the editor is W13's. */
export const adminDirectoryZoneSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  isActive: z.boolean(),
});
export type AdminDirectoryZone = z.infer<typeof adminDirectoryZoneSchema>;

export const adminDirectoryZonesResponseSchema = z.object({
  items: z.array(adminDirectoryZoneSchema),
});
export type AdminDirectoryZonesResponse = z.infer<typeof adminDirectoryZonesResponseSchema>;
