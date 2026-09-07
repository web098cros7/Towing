import { z } from 'zod';
import { paiseSchema, unsignedPaiseSchema } from '../common/money';
import { cursorEnvelopeSchema, cursorQuerySchema } from '../common/pagination';
import { jobSplitSchema } from '../fleet/earnings';

/**
 * §9.2.4 — the driver's own earnings.
 *
 * **`jobSplitSchema` is imported, not redeclared.** §9.2.4's acceptance
 * criterion is that every trip's commission math is "visible and
 * audit-consistent", and the fleet console renders the same five numbers for
 * the same booking from `GET /v1/fleet/earnings/splits`. Two hand-written
 * copies of that shape is exactly how a driver and their fleet owner end up
 * looking at different numbers for the same job and neither being wrong.
 *
 * **READ STRAIGHT FROM THE LEDGER, NOT FROM `earnings_daily`.** The projection
 * is keyed `(fleet_id, day, driver_id)` with `fleet_id` NOT NULL, so an
 * independent driver has no cell in it at all — and more decisively, §9.2.4
 * says "earnings derived from ledger", which is a property the read either has
 * by construction or has to prove about a projector. `DriverEarningsRepo`
 * takes the first option.
 */

export const driverEarningsQuerySchema = z.object({
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
});
export type DriverEarningsQuery = z.infer<typeof driverEarningsQuerySchema>;

export const driverEarningsTotalsSchema = z.object({
  jobs: z.number().int(),
  grossPaise: unsignedPaiseSchema,
  commissionPaise: unsignedPaiseSchema,
  /**
   * What actually reached this driver's wallet: `driver_share_credit` for a
   * fleet driver, `fare_credit` for an independent one. Never the fleet's half.
   */
  netPaise: paiseSchema,
});
export type DriverEarningsTotalsDto = z.infer<typeof driverEarningsTotalsSchema>;

/**
 * A point on the daily chart.
 *
 * `day` IS AN ISO DATE, NOT A PRE-FORMATTED LABEL. The driver app's mock used
 * strings like `'12 May'`; a server that hands those out has already decided
 * the locale and the timezone for every client, which is the correction Phase
 * 15 made on the customer side and this repeats. The IST grain matches the
 * fleet projection's exactly, so the two charts cannot disagree by 5.5 hours.
 */
export const driverEarningsPointSchema = z.object({
  day: z.iso.date(),
  jobs: z.number().int(),
  netPaise: paiseSchema,
});
export type DriverEarningsPointDto = z.infer<typeof driverEarningsPointSchema>;

/**
 * §9.2.4's balance block. `availablePaise` already nets off money locked in
 * `requested`/`processing` payouts, so the app never has to do that arithmetic
 * — and never disagrees with the server about what is withdrawable.
 */
export const driverWalletSchema = z.object({
  balancePaise: paiseSchema,
  availablePaise: paiseSchema,
  minPayoutPaise: unsignedPaiseSchema,
  maxPayoutPaise: unsignedPaiseSchema,
  payoutAccountLinked: z.boolean(),
});
export type DriverWalletDto = z.infer<typeof driverWalletSchema>;

export const driverEarningsSummarySchema = z.object({
  period: z.object({ from: z.iso.date(), to: z.iso.date() }),
  wallet: driverWalletSchema,
  totals: driverEarningsTotalsSchema,
  trend: z.array(driverEarningsPointSchema),
});
export type DriverEarningsSummaryDto = z.infer<typeof driverEarningsSummarySchema>;

export const driverTripsQuerySchema = cursorQuerySchema.extend({
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
});
export type DriverTripsQuery = z.infer<typeof driverTripsQuerySchema>;

export const driverTripsResponseSchema = cursorEnvelopeSchema(jobSplitSchema);
export type DriverTripsResponse = z.infer<typeof driverTripsResponseSchema>;

/** §12.2's weekly digest reads the same rows this serves. */
export const driverWeeklyBucketSchema = z.object({
  /** Monday of the IST week. */
  weekStart: z.iso.date(),
  jobs: z.number().int(),
  grossPaise: unsignedPaiseSchema,
  commissionPaise: unsignedPaiseSchema,
  netPaise: paiseSchema,
});
export type DriverWeeklyBucketDto = z.infer<typeof driverWeeklyBucketSchema>;

export const driverWeeklyResponseSchema = z.object({
  weeks: z.array(driverWeeklyBucketSchema),
});
export type DriverWeeklyResponse = z.infer<typeof driverWeeklyResponseSchema>;

/**
 * The raw ledger feed — every leg, not just the settlements.
 *
 * Payouts, cancellation compensation and §14.5 reversals all land here, which
 * is why `amountPaise` is signed and why the driver app's `TransactionKind`
 * had to grow beyond `job | bonus`. A driver whose balance moved deserves to
 * see the row that moved it.
 */
export const driverTransactionSchema = z.object({
  id: z.uuid(),
  amountPaise: paiseSchema,
  type: z.string(),
  reason: z.string().nullable(),
  bookingId: z.uuid().nullable(),
  createdAt: z.iso.datetime(),
});
export type DriverTransactionDto = z.infer<typeof driverTransactionSchema>;

export const driverTransactionsResponseSchema = cursorEnvelopeSchema(driverTransactionSchema);
export type DriverTransactionsResponse = z.infer<typeof driverTransactionsResponseSchema>;
