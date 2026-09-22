import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type {
  AnalyticsBandDay,
  AnalyticsDay,
  AnalyticsGridCell,
  AnalyticsZoneDay,
} from '@towing/api-contracts';
import { DB_READER, type DatabaseExecutor } from '../../db/db.module';

/**
 * W17's rollup readers — the analytics screens' read path.
 *
 * `DB_READER` (the read-through handle; `DATABASE_READ_URL` when a replica
 * exists — §9.4.13's "queries hit read replica at scale"), and NO writes in
 * this file: `analytics-rollup.ts` owns every write, which is what keeps the
 * sole-writer guard (`db/ledger/sole-writer.spec.ts`) meaningful.
 *
 * EVERY `day` IS SELECTED AS TEXT (`day::text`) — node-postgres parses a
 * `date` into a JS Date at LOCAL midnight, and a day that shifts by a
 * timezone on its way out of the database is the classic analytics bug.
 * Money/rate columns are cast `::float8` because `bigint` arrives as a string.
 */
@Injectable()
export class AnalyticsRepo {
  constructor(@Inject(DB_READER) private readonly db: DatabaseExecutor) {}

  async daily(from: string, to: string): Promise<AnalyticsDay[]> {
    const rows = (await this.db.execute(sql`
      select day::text as day,
             bookings_created, bookings_matched, bookings_completed, bookings_paid,
             bookings_cancelled, no_drivers_found,
             gmv_paise::float8 as gmv_paise, commission_paise::float8 as commission_paise,
             tax_paise::float8 as tax_paise, discount_paise::float8 as discount_paise,
             refunds_paise::float8 as refunds_paise, aov_paise::float8 as aov_paise,
             take_rate_bps, fill_rate_bps, ttm_p50_s, ttm_p90_s, on_time_bps,
             active_drivers, new_customers, coupon_redemptions, sos_alerts, sos_ack_p95_s
        from analytics_daily
       where day >= ${from}::date and day <= ${to}::date
       order by day asc
    `)) as unknown as Array<Record<string, unknown>>;

    return rows.map((row) => ({
      day: row.day as string,
      bookingsCreated: Number(row.bookings_created),
      bookingsMatched: Number(row.bookings_matched),
      bookingsCompleted: Number(row.bookings_completed),
      bookingsPaid: Number(row.bookings_paid),
      bookingsCancelled: Number(row.bookings_cancelled),
      noDriversFound: Number(row.no_drivers_found),
      gmvPaise: Math.round(Number(row.gmv_paise)),
      commissionPaise: Math.round(Number(row.commission_paise)),
      taxPaise: Math.round(Number(row.tax_paise)),
      discountPaise: Math.round(Number(row.discount_paise)),
      refundsPaise: Math.round(Number(row.refunds_paise)),
      aovPaise: Math.round(Number(row.aov_paise)),
      takeRateBps: Number(row.take_rate_bps),
      fillRateBps: Number(row.fill_rate_bps),
      ttmP50Seconds: row.ttm_p50_s === null ? null : Number(row.ttm_p50_s),
      ttmP90Seconds: row.ttm_p90_s === null ? null : Number(row.ttm_p90_s),
      onTimeBps: row.on_time_bps === null ? null : Number(row.on_time_bps),
      activeDrivers: Number(row.active_drivers),
      newCustomers: Number(row.new_customers),
      couponRedemptions: Number(row.coupon_redemptions),
      sosAlerts: Number(row.sos_alerts),
      sosAckP95Seconds: row.sos_ack_p95_s === null ? null : Number(row.sos_ack_p95_s),
    }));
  }

  async bands(from: string, to: string): Promise<AnalyticsBandDay[]> {
    const rows = (await this.db.execute(sql`
      select day::text as day, band::text as band, bookings_paid,
             gmv_paise::float8 as gmv_paise, commission_paise::float8 as commission_paise,
             driver_payout_paise::float8 as driver_payout_paise
        from analytics_band_daily
       where day >= ${from}::date and day <= ${to}::date
       order by day asc, band asc
    `)) as unknown as Array<Record<string, unknown>>;

    return rows.map((row) => ({
      day: row.day as string,
      band: row.band as 'A' | 'B' | 'C',
      bookingsPaid: Number(row.bookings_paid),
      gmvPaise: Math.round(Number(row.gmv_paise)),
      commissionPaise: Math.round(Number(row.commission_paise)),
      driverPayoutPaise: Math.round(Number(row.driver_payout_paise)),
    }));
  }

  async zones(from: string, to: string): Promise<AnalyticsZoneDay[]> {
    const rows = (await this.db.execute(sql`
      select z.day::text as day, z.zone_id, s.name as zone_name,
             z.bookings_created, z.bookings_matched, z.no_drivers_found,
             z.gmv_paise::float8 as gmv_paise, z.commission_paise::float8 as commission_paise,
             z.ttm_p50_s
        from analytics_zone_daily z
        join service_zones s on s.id = z.zone_id
       where z.day >= ${from}::date and z.day <= ${to}::date
       order by z.day asc, s.name asc
    `)) as unknown as Array<Record<string, unknown>>;

    return rows.map((row) => ({
      day: row.day as string,
      zoneId: row.zone_id as string,
      zoneName: row.zone_name as string,
      bookingsCreated: Number(row.bookings_created),
      bookingsMatched: Number(row.bookings_matched),
      noDriversFound: Number(row.no_drivers_found),
      gmvPaise: Math.round(Number(row.gmv_paise)),
      commissionPaise: Math.round(Number(row.commission_paise)),
      ttmP50Seconds: row.ttm_p50_s === null ? null : Number(row.ttm_p50_s),
    }));
  }

  async grid(from: string, to: string): Promise<AnalyticsGridCell[]> {
    const rows = (await this.db.execute(sql`
      select day::text as day, hour, cell_lat::float8 as cell_lat, cell_lng::float8 as cell_lng,
             bookings, no_drivers, avg_wave::float8 as avg_wave
        from analytics_demand_grid
       where day >= ${from}::date and day <= ${to}::date
       order by day asc, hour asc, cell_lat asc, cell_lng asc
    `)) as unknown as Array<Record<string, unknown>>;

    return rows.map((row) => ({
      day: row.day as string,
      hour: Number(row.hour),
      cellLat: Number(row.cell_lat),
      cellLng: Number(row.cell_lng),
      bookings: Number(row.bookings),
      noDrivers: Number(row.no_drivers),
      avgWave: row.avg_wave === null ? null : Number(row.avg_wave),
    }));
  }

  /** §22.2's rating distribution: customer→driver reviews, 1–5, for the range. */
  async ratings(from: string, to: string): Promise<Array<{ rating: number; count: number }>> {
    const rows = (await this.db.execute(sql`
      select rating, count(*)::int as count
        from ratings
       where direction = 'customer_to_driver'
         and created_at >= (${from}::date::timestamp at time zone 'Asia/Kolkata')
         and created_at < ((${to}::date + 1)::timestamp at time zone 'Asia/Kolkata')
       group by rating
       order by rating asc
    `)) as unknown as Array<{ rating: number; count: number }>;

    return rows.map((row) => ({ rating: Number(row.rating), count: Number(row.count) }));
  }

  /**
   * Averages of the CURRENT driver quality columns — snapshots, not period
   * metrics (no history table exists); the UI labels them as current.
   */
  async driverAverages(): Promise<{
    acceptancePct: number | null;
    completionPct: number | null;
    averageRating: number | null;
  }> {
    const rows = (await this.db.execute(sql`
      select avg(acceptance_rate)::float8 as acceptance,
             avg(completion_rate)::float8 as completion,
             avg(rating)::float8 as rating
        from drivers
       where kyc_status = 'approved'
    `)) as unknown as Array<{
      acceptance: number | null;
      completion: number | null;
      rating: number | null;
    }>;

    const row = rows[0];
    const one = (value: number | null): number | null =>
      value === null ? null : Math.round(value * 10) / 10;
    return {
      acceptancePct: one(row?.acceptance ?? null),
      completionPct: one(row?.completion ?? null),
      averageRating: one(row?.rating ?? null),
    };
  }
}
