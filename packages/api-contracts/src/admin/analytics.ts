import { z } from 'zod';

/**
 * W17 — analytics and reports (§9.4.13, §22.2/§22.3), `/admin/analytics`.
 *
 * EVERY NUMBER CROSSES AS AN INTEGER. Money is paise; rates are BASIS POINTS
 * (`takeRateBps`, `fillRateBps` — 1 bp = 0.01%); durations are whole seconds.
 * The spec's own wording is "effective take rate" and "fill rate" — values
 * like 12.34% — and a float here would be the one number two screens format
 * differently. The console divides by 100 at the edge.
 *
 * ONE SHAPE PER GRAIN. `analyticsDay` is the `analytics_daily` row; the other
 * endpoints add their grain (bands, zones, grid cells) beside the same day
 * rows rather than inventing a response shape per screen.
 *
 * `onTimeBps` IS NULLABLE AND CURRENTLY ALWAYS NULL. No promised-arrival
 * column exists to measure against (`eta_seconds` is a LIVE estimate, not a
 * commitment), and the milestone's decision (recorded in the rollup SQL) is
 * to ship the column null rather than a metric that means nothing. When a
 * promised-ETA field lands, only the rollup query changes.
 */

export const analyticsDaySchema = z.object({
  day: z.iso.date(),
  bookingsCreated: z.number().int(),
  bookingsMatched: z.number().int(),
  bookingsCompleted: z.number().int(),
  bookingsPaid: z.number().int(),
  bookingsCancelled: z.number().int(),
  noDriversFound: z.number().int(),
  gmvPaise: z.number().int(),
  commissionPaise: z.number().int(),
  taxPaise: z.number().int(),
  discountPaise: z.number().int(),
  refundsPaise: z.number().int(),
  aovPaise: z.number().int(),
  takeRateBps: z.number().int(),
  fillRateBps: z.number().int(),
  ttmP50Seconds: z.number().int().nullable(),
  ttmP90Seconds: z.number().int().nullable(),
  /** Null until a promised-ETA column exists — see the file header. */
  onTimeBps: z.number().int().nullable(),
  /** Distinct drivers who accepted at least one offer that day. */
  activeDrivers: z.number().int(),
  newCustomers: z.number().int(),
  couponRedemptions: z.number().int(),
  sosAlerts: z.number().int(),
  sosAckP95Seconds: z.number().int().nullable(),
});
export type AnalyticsDay = z.infer<typeof analyticsDaySchema>;

/** The range's sums; `driverDays` is summed by day (a driver who worked twice counts twice). */
export const analyticsTotalsSchema = z.object({
  bookingsCreated: z.number().int(),
  bookingsMatched: z.number().int(),
  bookingsCompleted: z.number().int(),
  bookingsPaid: z.number().int(),
  bookingsCancelled: z.number().int(),
  noDriversFound: z.number().int(),
  gmvPaise: z.number().int(),
  commissionPaise: z.number().int(),
  taxPaise: z.number().int(),
  discountPaise: z.number().int(),
  refundsPaise: z.number().int(),
  aovPaise: z.number().int(),
  takeRateBps: z.number().int(),
  fillRateBps: z.number().int(),
  cancellationRateBps: z.number().int(),
  driverDays: z.number().int(),
  newCustomers: z.number().int(),
  couponRedemptions: z.number().int(),
  sosAlerts: z.number().int(),
});
export type AnalyticsTotals = z.infer<typeof analyticsTotalsSchema>;

export const analyticsRangeQuerySchema = z.object({
  /** IST dates, inclusive. Default: the last 30 days ending today. */
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
});
export type AnalyticsRangeQuery = z.infer<typeof analyticsRangeQuerySchema>;

export const analyticsSummaryResponseSchema = z.object({
  days: z.array(analyticsDaySchema),
  totals: analyticsTotalsSchema,
});
export type AnalyticsSummaryResponse = z.infer<typeof analyticsSummaryResponseSchema>;

/** Revenue adds the §22.2 commission-by-band breakdown. */
export const analyticsBandDaySchema = z.object({
  day: z.iso.date(),
  band: z.enum(['A', 'B', 'C']),
  bookingsPaid: z.number().int(),
  gmvPaise: z.number().int(),
  commissionPaise: z.number().int(),
  driverPayoutPaise: z.number().int(),
});
export type AnalyticsBandDay = z.infer<typeof analyticsBandDaySchema>;

export const analyticsRevenueResponseSchema = z.object({
  days: z.array(analyticsDaySchema),
  totals: analyticsTotalsSchema,
  bands: z.array(analyticsBandDaySchema),
});
export type AnalyticsRevenueResponse = z.infer<typeof analyticsRevenueResponseSchema>;

/** Drivers adds the rating distribution + the fleet's current quality averages. */
export const analyticsDriverResponseSchema = z.object({
  days: z.array(analyticsDaySchema),
  totals: analyticsTotalsSchema,
  ratings: z.array(z.object({ rating: z.number().int().min(1).max(5), count: z.number().int() })),
  /**
   * Averages of `drivers.acceptance_rate` / `completion_rate` — CURRENT
   * snapshots, not period metrics (no history table exists). Labelled as
   * current in the UI so nobody reads them as "this month".
   */
  currentAverages: z.object({
    acceptancePct: z.number().nullable(),
    completionPct: z.number().nullable(),
    averageRating: z.number().nullable(),
  }),
});
export type AnalyticsDriverResponse = z.infer<typeof analyticsDriverResponseSchema>;

export const analyticsZoneDaySchema = z.object({
  day: z.iso.date(),
  zoneId: z.uuid(),
  zoneName: z.string(),
  bookingsCreated: z.number().int(),
  bookingsMatched: z.number().int(),
  noDriversFound: z.number().int(),
  gmvPaise: z.number().int(),
  commissionPaise: z.number().int(),
  ttmP50Seconds: z.number().int().nullable(),
});
export type AnalyticsZoneDay = z.infer<typeof analyticsZoneDaySchema>;

export const analyticsGridCellSchema = z.object({
  day: z.iso.date(),
  hour: z.number().int().min(0).max(23),
  /** ~0.01° cells (~1.1 km); the rounding IS the aggregation. */
  cellLat: z.number(),
  cellLng: z.number(),
  bookings: z.number().int(),
  noDrivers: z.number().int(),
  avgWave: z.number().nullable(),
});
export type AnalyticsGridCell = z.infer<typeof analyticsGridCellSchema>;

export const analyticsGeoResponseSchema = z.object({
  grid: z.array(analyticsGridCellSchema),
  zones: z.array(analyticsZoneDaySchema),
});
export type AnalyticsGeoResponse = z.infer<typeof analyticsGeoResponseSchema>;

export const ANALYTICS_EXPORT_DATASETS = [
  'summary',
  'marketplace',
  'revenue',
  'drivers',
  'geo',
] as const;
export const analyticsExportDatasetSchema = z.enum(ANALYTICS_EXPORT_DATASETS);
export type AnalyticsExportDataset = z.infer<typeof analyticsExportDatasetSchema>;

export const analyticsExportQuerySchema = analyticsRangeQuerySchema.extend({
  dataset: analyticsExportDatasetSchema.default('summary'),
});
export type AnalyticsExportQuery = z.infer<typeof analyticsExportQuerySchema>;

/** The manual trigger (`POST /admin/analytics/rollup`) — the cron's on-demand twin. */
export const analyticsRollupRequestSchema = z.object({
  /** IST day to recompute; omitted = yesterday (what the cron does). */
  day: z.iso.date().optional(),
});
export type AnalyticsRollupRequest = z.infer<typeof analyticsRollupRequestSchema>;

export const analyticsRollupResponseSchema = z.object({
  queued: z.literal(true),
  day: z.iso.date(),
});
export type AnalyticsRollupResponse = z.infer<typeof analyticsRollupResponseSchema>;
