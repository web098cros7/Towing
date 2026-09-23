import { z } from 'zod';
import {
  docReviewStatusSchema,
  driverDocTypeSchema,
  kycStatusSchema,
  serviceTypeSchema,
} from '../common/enums';
import { vehicleClassSchema } from '../fleet/trucks';

/**
 * Driver KYC submission (Phase 11, `modules/driver-kyc`) — §3.1 layer 1, the
 * app side of the gate. TowPartner's wizard (Phase 12) is the first UI on top
 * of this; this phase ships the API only.
 */

export const driverKycPresignRequestSchema = z.object({
  docType: driverDocTypeSchema,
});
export type DriverKycPresignRequest = z.infer<typeof driverKycPresignRequestSchema>;

/**
 * A presigned PUT the client uploads bytes to directly, plus the `key` it
 * must echo back to `POST /v1/driver/kyc/documents/confirm` once the upload
 * succeeds — the presign call cannot itself know the upload happened.
 */
export const driverKycPresignResponseSchema = z.object({
  uploadUrl: z.url(),
  key: z.string(),
  expiresAt: z.iso.datetime(),
});
export type DriverKycPresignResponse = z.infer<typeof driverKycPresignResponseSchema>;

export const driverKycConfirmRequestSchema = z.object({
  docType: driverDocTypeSchema,
  key: z.string().min(1),
});
export type DriverKycConfirmRequest = z.infer<typeof driverKycConfirmRequestSchema>;

export const driverKycDocumentStatusSchema = z.object({
  docType: driverDocTypeSchema,
  status: docReviewStatusSchema,
  rejectionReason: z.string().nullable(),
});
export type DriverKycDocumentStatus = z.infer<typeof driverKycDocumentStatusSchema>;

export const driverKycStatusResponseSchema = z.object({
  kycStatus: kycStatusSchema,
  /** Overall note from the last `reject`/`request_info` admin decision, if any. */
  rejectionReason: z.string().nullable(),
  documents: z.array(driverKycDocumentStatusSchema),
});
export type DriverKycStatusResponse = z.infer<typeof driverKycStatusResponseSchema>;

export const driverKycSubmitResponseSchema = z.object({
  kycStatus: kycStatusSchema,
  kycSubmittedAt: z.iso.datetime(),
});
export type DriverKycSubmitResponse = z.infer<typeof driverKycSubmitResponseSchema>;

/**
 * The two service types a tow truck offers by being a tow truck.
 *
 * `vehicle_class` already decides these (`service_type` enum: "roadside
 * services are open to both truck classes; tows are not"), so they are NOT
 * driver-selectable — a wheel-lift is matched to a wheel-lift job and that is
 * the whole rule. They are named here so dispatch and the app agree on which
 * half of the enum the driver's own choice governs.
 */
export const CORE_SERVICE_TYPES = ['tow', 'accident_recovery'] as const;

/**
 * The roadside jobs a driver opts into during onboarding.
 *
 * Every one of these needs kit or training the truck class says nothing about:
 * a jump pack, a spare-change trolley jack, a fuel can, a lockout kit. A
 * flatbed that carries none of it should not be offered a flat-tyre job, which
 * is exactly what happened before this list existed — dispatch matched on
 * vehicle class alone and sent whoever was nearest.
 *
 * Adding a new roadside service (Winch Out) means adding it to `serviceType`
 * and to this list; drivers then see a new unticked row and are not offered it
 * until they tick it. That is deliberate — a silent opt-in would offer the job
 * to everyone on day one.
 */
export const OPTIONAL_SERVICE_TYPES = [
  'battery',
  'flat_tyre',
  'fuel',
  'breakdown',
  'lockout',
] as const;

/**
 * Compile-time exhaustiveness: every `serviceType` is either core or optional.
 * Add a value to the enum without classifying it above and this line stops
 * compiling — which is the point. An unclassified service would match the core
 * branch of no filter and the opt-in list of no driver, so it would be bookable
 * and permanently undispatchable, with nothing to show for it but an empty
 * candidate list.
 */
const _everyServiceTypeIsClassified:
  | (typeof CORE_SERVICE_TYPES)[number]
  | (typeof OPTIONAL_SERVICE_TYPES)[number] = undefined as unknown as z.infer<
  typeof serviceTypeSchema
>;
void _everyServiceTypeIsClassified;

/** One of the roadside services a driver can tick — `serviceType` minus the core two. */
export const optionalServiceTypeSchema = z.enum(OPTIONAL_SERVICE_TYPES);
export type OptionalServiceType = z.infer<typeof optionalServiceTypeSchema>;

/** §3.2 — vehicle class, the Band C long-haul opt-in and the roadside services, all admin-revocable (`admin/drivers.ts`). */
export const driverCapabilitiesUpdateSchema = z
  .object({
    vehicleClass: vehicleClassSchema.optional(),
    longDistanceEnabled: z.boolean().optional(),
    /**
     * The complete roadside set, not a delta — sending `[]` means "I offer no
     * roadside jobs", which is a legitimate answer for a plain tow operator.
     * Omitting the key leaves the stored set alone, so a client that predates
     * this field cannot wipe it.
     */
    services: z.array(optionalServiceTypeSchema).max(OPTIONAL_SERVICE_TYPES.length).optional(),
  })
  .refine(
    (body) =>
      body.vehicleClass !== undefined ||
      body.longDistanceEnabled !== undefined ||
      body.services !== undefined,
    { message: 'At least one of vehicleClass, longDistanceEnabled or services must be provided' },
  );
export type DriverCapabilitiesUpdate = z.infer<typeof driverCapabilitiesUpdateSchema>;

export const driverCapabilitiesResponseSchema = z.object({
  vehicleClass: vehicleClassSchema.nullable(),
  longDistanceEnabled: z.boolean(),
  services: z.array(optionalServiceTypeSchema),
});
export type DriverCapabilitiesResponse = z.infer<typeof driverCapabilitiesResponseSchema>;
