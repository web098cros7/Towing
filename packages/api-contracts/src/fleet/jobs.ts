import { z } from 'zod';
import { paiseSchema, unsignedPaiseSchema } from '../common/money';
import { cursorEnvelopeSchema, cursorQuerySchema } from '../common/pagination';

/** Full §5.1 machine — the DB has all eleven; clients must render every one. */
export const jobStatusSchema = z.enum([
  'searching',
  'assigned',
  'en_route',
  'arrived',
  'in_progress',
  'completed',
  'paid',
  'cancelled',
  'no_drivers_found',
  'disputed',
  /**
   * A full refund landed. Distinct from `disputed`, which means somebody is
   * contesting the trip — a refund is a decision, not an argument, and the
   * two were the same status until 0037.
   */
  'refunded',
]);
export type JobStatus = z.infer<typeof jobStatusSchema>;

export const commissionBandSchema = z.enum(['A', 'B', 'C']);

export const jobSchema = z.object({
  id: z.uuid(),
  /** Display-only, derived from the id — bookings have no code column. */
  code: z.string(),
  serviceType: z.string(),
  status: jobStatusSchema,
  driverName: z.string().nullable(),
  /**
   * The driver's CURRENT assigned truck — an approximation for historical
   * jobs, since bookings do not (yet) record the truck that ran them.
   */
  truckPlate: z.string().nullable(),
  pickupArea: z.string(),
  dropArea: z.string().nullable(),
  distanceKm: z.number(),
  grossPaise: unsignedPaiseSchema,
  /** Nullable: locked at confirm, but the schema allows unconfirmed rows. */
  commissionBand: commissionBandSchema.nullable(),
  commissionPct: z.number().nullable(),
  commissionPaise: paiseSchema,
  poolPaise: paiseSchema,
  createdAt: z.iso.datetime(),
});
export type JobDto = z.infer<typeof jobSchema>;

export const jobsQuerySchema = cursorQuerySchema.extend({
  status: jobStatusSchema.optional(),
  /** Inclusive ISO date bounds on created_at. */
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
});
export type JobsQuery = z.infer<typeof jobsQuerySchema>;

export const jobsListResponseSchema = cursorEnvelopeSchema(jobSchema);
export type JobsListResponse = z.infer<typeof jobsListResponseSchema>;

/**
 * ADM-23: one job, as the fleet owner needs to answer "why did I earn this on
 * that job?" The spec promises a timeline, the fare and how the money was
 * split; the list row has only the totals.
 */

/** Who moved a job to a status. `mitow` is an admin: fleets see the role, never the person. */
export const jobActorSchema = z.enum(['customer', 'driver', 'fleet_owner', 'mitow', 'system']);
export type JobActor = z.infer<typeof jobActorSchema>;

export const jobTimelineEntrySchema = z.object({
  status: jobStatusSchema,
  actor: jobActorSchema,
  at: z.iso.datetime(),
});
export type JobTimelineEntry = z.infer<typeof jobTimelineEntrySchema>;

/** Every line of the customer's fare, as it was locked when they confirmed. */
export const jobFareSchema = z.object({
  basePaise: paiseSchema,
  distancePaise: paiseSchema,
  nightPaise: paiseSchema,
  highwayPaise: paiseSchema,
  accidentPaise: paiseSchema,
  waitingPaise: paiseSchema,
  surgePaise: paiseSchema,
  /** A coupon's value. Shown as a deduction; the split below already absorbs it. */
  discountPaise: paiseSchema,
  taxPaise: paiseSchema,
  totalPaise: paiseSchema,
});
export type JobFare = z.infer<typeof jobFareSchema>;

/**
 * Where the money went.
 *
 * The shares are READ FROM THE LEDGER, not recomputed: they are what the fleet
 * and the driver were actually credited, which is what reconciles against a
 * statement. Null until the job settles. `refundedPaise` is what later
 * refunds took back from this fleet's side of the trip.
 */
export const jobMoneySplitSchema = z.object({
  settled: z.boolean(),
  commissionPaise: paiseSchema,
  fleetSharePaise: paiseSchema.nullable(),
  driverSharePaise: paiseSchema.nullable(),
  refundedPaise: paiseSchema,
});
export type JobMoneySplit = z.infer<typeof jobMoneySplitSchema>;

export const jobDetailSchema = jobSchema.extend({
  pickupAddress: z.string().nullable(),
  dropAddress: z.string().nullable(),
  /**
   * The truck that RAN this job, when the booking recorded it; otherwise the
   * driver's current truck, as on the list.
   */
  truckPlate: z.string().nullable(),
  paymentMethod: z.enum(['upi', 'card', 'cash', 'wallet']).nullable(),
  fare: jobFareSchema,
  split: jobMoneySplitSchema,
  cancellation: z
    .object({
      by: jobActorSchema.nullable(),
      reason: z.string().nullable(),
      feePaise: paiseSchema,
      driverCompensationPaise: paiseSchema,
    })
    .nullable(),
  timeline: z.array(jobTimelineEntrySchema),
});
export type JobDetail = z.infer<typeof jobDetailSchema>;
