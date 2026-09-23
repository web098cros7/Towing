import { z } from 'zod';
// Moved to `common/enums` in Phase 10 — the driver realm's own session contract
// needs it too, and the package barrel is flat, so it can only be declared once.
// Re-exported here so `kycStatusSchema` keeps resolving for existing importers.
import { kycStatusSchema } from '../common/enums';
import { unsignedPaiseSchema } from '../common/money';
import { pageEnvelopeSchema, pageQuerySchema } from '../common/pagination';
import { vehicleClassSchema } from './trucks';

export const fleetDriverSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  phone: z.string(),
  kycStatus: kycStatusSchema,
  isOnline: z.boolean(),
  assignedTruckPlate: z.string().nullable(),
  rating: z.number().nullable(),
  tripsTotal: z.number().int(),
  /** SUM(driver_share_credit) since the IST month start. */
  monthNetPaise: unsignedPaiseSchema,
});
export type FleetDriverDto = z.infer<typeof fleetDriverSchema>;

export const driversListQuerySchema = pageQuerySchema;
export const driversListResponseSchema = pageEnvelopeSchema(fleetDriverSchema);
export type DriversListResponse = z.infer<typeof driversListResponseSchema>;

/**
 * Invite creates a KYC-`incomplete` driver row; the driver completes KYC in
 * TowPartner and approval stays central with platform admin (spec §9.3.5).
 * NOTE: `drivers.mobile` is globally unique — inviting a number that already
 * exists (even as an independent driver) returns 409 `duplicate_mobile`.
 */
export const driverInviteSchema = z.object({
  name: z.string().min(2).max(80),
  mobile: z.string().regex(/^\+[1-9]\d{7,14}$/, 'Use E.164 format, e.g. +919845012345'),
  vehicleClass: vehicleClassSchema.optional(),
});
export type DriverInviteRequest = z.infer<typeof driverInviteSchema>;

/** `truckId: null` unassigns. One driver per truck, enforced by a partial unique index. */
export const assignTruckSchema = z.object({
  truckId: z.uuid().nullable(),
});
export type AssignTruckRequest = z.infer<typeof assignTruckSchema>;

/**
 * ADM-23: one driver's performance, for the fleet that employs them. The spec
 * asks for "per-driver performance (trips, rating, earnings)"; the list row has
 * only lifetime totals.
 *
 * The window is the last `PERFORMANCE_WINDOW_DAYS` days for trips and
 * earnings. Rating and the two rates are the driver's standing figures (the
 * ones dispatch scores them on), not per-window.
 */
export const PERFORMANCE_WINDOW_DAYS = 30;

export const fleetDriverPerformanceSchema = z.object({
  driverId: z.uuid(),
  name: z.string(),
  windowDays: z.number().int(),
  trips: z.object({
    /** Finished trips: completed, paid, or refunded afterwards. */
    completed: z.number().int(),
    cancelled: z.number().int(),
    /** Jobs the driver could not complete and handed back. */
    unable: z.number().int(),
  }),
  /** 0–100, what dispatch scores the driver on. Null until there is history. */
  acceptanceRatePct: z.number().nullable(),
  completionRatePct: z.number().nullable(),
  /** 1–5 from customers, and how many ratings it rests on (all time). */
  rating: z.number().nullable(),
  ratingsCount: z.number().int(),
  /**
   * What this driver's jobs earned in the window, NET of refund clawbacks,
   * split the way the ledger credited it.
   */
  earnings: z.object({
    fleetSharePaise: z.number().int(),
    driverSharePaise: z.number().int(),
  }),
  /** The ten most recent jobs, newest first, each openable at `/jobs/[id]`. */
  recentJobs: z.array(
    z.object({
      id: z.uuid(),
      code: z.string(),
      status: z.string(),
      grossPaise: unsignedPaiseSchema,
      createdAt: z.iso.datetime(),
    }),
  ),
});
export type FleetDriverPerformance = z.infer<typeof fleetDriverPerformanceSchema>;
