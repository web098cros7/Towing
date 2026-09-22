import { z } from 'zod';
import { serviceTypeSchema } from '../common/enums';
import { unsignedPaiseSchema } from '../common/money';
import { cursorEnvelopeSchema } from '../common/pagination';
import { jobStatusSchema } from '../fleet/jobs';
import { vehicleClassSchema } from '../fleet/trucks';
import { driverJobPaymentSchema, jobEarningsSchema } from './jobs';

/**
 * The driver's own card, and their job history.
 *
 * `GET /v1/driver/me` — the driver's own card (Home greeting, Profile header,
 * Personal Information); `truck` is the fleet truck currently assigned, null
 * for an independent driver without one.
 */
export const driverProfileSchema = z.object({
  id: z.uuid(),
  name: z.string().nullable(),
  mobile: z.string(),
  /** Optional, and the driver's own to set — MiTow never requires one. */
  email: z.string().nullable(),
  photoUrl: z.string().nullable(),
  rating: z.number().nullable(),
  totalTrips: z.number().int().nonnegative(),
  acceptanceRatePct: z.number().nullable(),
  completionRatePct: z.number().nullable(),
  level: z.string(),
  kycStatus: z.string(),
  memberSince: z.iso.datetime(),
  fleet: z
    .object({
      id: z.uuid(),
      name: z.string(),
    })
    .nullable(),
  truck: z
    .object({
      plate: z.string(),
      make: z.string().nullable(),
      model: z.string().nullable(),
      vehicleClass: vehicleClassSchema,
    })
    .nullable(),
});
export type DriverProfile = z.infer<typeof driverProfileSchema>;

/** One row of the driver's job history feed. */
export const driverJobHistoryItemSchema = z.object({
  bookingId: z.uuid(),
  reference: z.string(),
  status: jobStatusSchema,
  serviceType: serviceTypeSchema,
  vehicleClass: vehicleClassSchema,
  pickupAddress: z.string().nullable(),
  dropAddress: z.string().nullable(),
  distanceKm: z.number().nullable(),
  earnings: jobEarningsSchema,
  paymentMethod: z.enum(['cash', 'online']).nullable(),
  createdAt: z.iso.datetime(),
  completedAt: z.iso.datetime().nullable(),
});
export type DriverJobHistoryItem = z.infer<typeof driverJobHistoryItemSchema>;

export const driverJobHistoryQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  status: z.enum(['all', 'completed', 'cancelled']).default('all'),
});
export type DriverJobHistoryQuery = z.infer<typeof driverJobHistoryQuerySchema>;

export const driverJobHistoryResponseSchema = cursorEnvelopeSchema(driverJobHistoryItemSchema);
export type DriverJobHistoryResponse = z.infer<typeof driverJobHistoryResponseSchema>;

// Re-exported so the driver app can type the detail response without a second
// import path; the shape is the same DriverJob the execution routes return.
export { driverJobPaymentSchema };
export type { DriverJobPayment } from './jobs';

/**
 * `PUT /v1/driver/me` — the only field a driver may change about themselves.
 *
 * ⚠ `name` IS NOT HERE, and that is the interesting one. A driver's name is
 * their name on their driving licence (Ehsan, 23 Sep): it is the identity the
 * platform verified, pays against, and shows a customer who is about to get
 * into a vehicle with them. A driver who could retype it could quietly become
 * somebody else between two jobs. It is set when the licence is checked, and
 * changing it is a verification decision, not a profile edit.
 *
 * Also absent: `mobile` (it is the login identity — changing it is an auth
 * flow), the truck and its plate/papers (the fleet assigns and renews those
 * from the console; a driver editing their own plate would contradict the
 * assignment the fleet made), and `vehicleClass`/`longDistanceEnabled`
 * (already editable at `PUT driver/capabilities`). KYC status and documents
 * are an admin decision.
 *
 * The photo is not here either because it has its own presign/confirm pair.
 */
export const driverProfileUpdateSchema = z.object({
  email: z.string().email().nullable().optional(),
});
export type DriverProfileUpdate = z.infer<typeof driverProfileUpdateSchema>;

/** `POST /v1/driver/photo/presign` — a slot to PUT the profile photo bytes to. */
export const driverPhotoPresignResponseSchema = z.object({
  uploadUrl: z.string(),
  key: z.string(),
  expiresAt: z.iso.datetime(),
});
export type DriverPhotoPresignResponse = z.infer<typeof driverPhotoPresignResponseSchema>;

/** `POST /v1/driver/photo/confirm` — the key from the presign response, once uploaded. */
export const driverPhotoConfirmSchema = z.object({ key: z.string().min(1).max(300) });
export type DriverPhotoConfirm = z.infer<typeof driverPhotoConfirmSchema>;
