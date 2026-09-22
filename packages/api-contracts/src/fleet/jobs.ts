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
