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
