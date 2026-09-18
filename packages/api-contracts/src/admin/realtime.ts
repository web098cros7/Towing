import { z } from 'zod';
import { jobStatusSchema } from '../fleet/jobs';

/**
 * Platform-wide operational events on `ops:events` (A18, §12.1 admin feed).
 *
 * Every booking status change is visible to an admin subscriber regardless of
 * fleet — the tenant-scoped `fleet:events` cannot serve a console that watches
 * the whole marketplace. W1 (badges, activity, live map) and W14 (SOS alerts)
 * extend this union; the channel stays one.
 */
export const opsBookingStatusEventSchema = z.object({
  kind: z.literal('booking_status'),
  bookingId: z.uuid(),
  from: jobStatusSchema,
  to: jobStatusSchema,
  zoneId: z.uuid().nullable(),
  driverId: z.uuid().nullable(),
  userId: z.uuid(),
  fleetId: z.uuid().nullable(),
  at: z.iso.datetime(),
});
export type OpsBookingStatusEvent = z.infer<typeof opsBookingStatusEventSchema>;

/** A booking entered the system — no transition performs this edge. */
export const opsBookingCreatedEventSchema = z.object({
  kind: z.literal('booking_created'),
  bookingId: z.uuid(),
  zoneId: z.uuid(),
  userId: z.uuid(),
  at: z.iso.datetime(),
});
export type OpsBookingCreatedEvent = z.infer<typeof opsBookingCreatedEventSchema>;

export const opsEventSchema = z.discriminatedUnion('kind', [
  opsBookingStatusEventSchema,
  opsBookingCreatedEventSchema,
]);
export type OpsEvent = z.infer<typeof opsEventSchema>;
