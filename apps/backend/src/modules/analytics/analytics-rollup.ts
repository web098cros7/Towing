import { sql } from 'drizzle-orm';
import type {
  AnalyticsBandDay,
  AnalyticsDay,
  AnalyticsGridCell,
  AnalyticsZoneDay,
} from '@towing/api-contracts';
import type { Database, DatabaseExecutor } from '../../db/db.module';

/**
 * W17's rollup engine — the whole computation for ONE IST day, absolutely.
 *
 * ABSOLUTE, NEVER INCREMENTAL. BullMQ is at-least-once: a redelivered
 * `analytics.rollup` job must not double a day's numbers, so `writeDay`
 * deletes the day's rows and inserts the recomputed set inside one
 * transaction. Nothing anywhere in this file adds to a stored value — the
 * earnings projector (`earnings-projector.ts`) set this pattern and documents
 * why at length.
 *
 * ONE COMPUTE PATH FOR TWO READERS. The nightly job persists what
 * `computeDay` returns; the live "today" read in `analytics.service.ts`
 * computes the same struct WITHOUT persisting (10 s memo). One query set
 * means a number on the dashboard cannot differ from the number that will be
 * written for that day tonight.
 *
 * THE FOUR §22.1 EVENTS ARE NOT THE SOURCE. The tracker
 * (`analytics-events.ts`) proves the events fire; the metrics here come from
 * the domain tables (bookings, payments, refunds, attempts, sos_alerts),
 * which are the facts the money already reconciles against.
 *
 * ON-TIME IS NULL BY CONSTRUCTION: no promised-arrival column exists
 * (`eta_seconds` is a live estimate, not a commitment), and shipping a metric
 * that measures nothing is worse than an honest null. When a promised ETA
 * lands, only the query below changes.
 */

export interface ComputedDay {
  daily: Omit<AnalyticsDay, 'day'>;
  zones: Array<Omit<AnalyticsZoneDay, 'day'>>;
  bands: Array<Omit<AnalyticsBandDay, 'day'>>;
  grid: Array<Omit<AnalyticsGridCell, 'day'>>;
}

/** `degree` rounding for the demand grid — ~1.1 km cells; NO backticks in here, they end the template. */
const GRID = 2;

export async function computeDay(db: DatabaseExecutor, day: string): Promise<ComputedDay> {
  const [dailyRow] = (await db.execute(sql`
    with bounds as (
      select (${day}::date::timestamp at time zone 'Asia/Kolkata') as day_start,
             ((${day}::date + 1)::timestamp at time zone 'Asia/Kolkata') as day_end
    )
    select
      (select count(*)::int from bookings b, bounds w
        where b.created_at >= w.day_start and b.created_at < w.day_end) as bookings_created,
      (select count(distinct a.booking_id)::int
         from dispatch_attempts a, bounds w
        where a.outcome = 'accepted'
          and a.responded_at >= w.day_start and a.responded_at < w.day_end) as bookings_matched,
      (select count(*)::int from bookings b, bounds w
        where b.completed_at >= w.day_start and b.completed_at < w.day_end) as bookings_completed,
      (select count(*)::int from bookings b, bounds w
        where b.paid_at >= w.day_start and b.paid_at < w.day_end) as bookings_paid,
      (select count(*)::int from booking_status_history h, bounds w
        where h.status = 'cancelled'
          and h.created_at >= w.day_start and h.created_at < w.day_end) as bookings_cancelled,
      (select count(*)::int from booking_status_history h, bounds w
        where h.status = 'no_drivers_found'
          and h.created_at >= w.day_start and h.created_at < w.day_end) as no_drivers_found,
      (select coalesce(sum(b.total), 0)::float8 from bookings b, bounds w
        where b.paid_at >= w.day_start and b.paid_at < w.day_end) as gmv,
      (select coalesce(sum(b.commission_amount), 0)::float8 from bookings b, bounds w
        where b.paid_at >= w.day_start and b.paid_at < w.day_end) as commission,
      (select coalesce(sum(b.tax_amount), 0)::float8 from bookings b, bounds w
        where b.paid_at >= w.day_start and b.paid_at < w.day_end) as tax,
      (select coalesce(sum(b.discount), 0)::float8 from bookings b, bounds w
        where b.paid_at >= w.day_start and b.paid_at < w.day_end) as discount,
      (select coalesce(sum(r.amount), 0)::float8 from refunds r, bounds w
        where r.status = 'processed'
          and r.processed_at >= w.day_start and r.processed_at < w.day_end) as refunds,
      (select (percentile_cont(0.5) within group (
          order by extract(epoch from (a.responded_at - b.created_at))))::float8
         from dispatch_attempts a
         join bookings b on b.id = a.booking_id
         cross join bounds w
        where a.outcome = 'accepted'
          and a.responded_at >= w.day_start and a.responded_at < w.day_end) as ttm_p50,
      (select (percentile_cont(0.9) within group (
          order by extract(epoch from (a.responded_at - b.created_at))))::float8
         from dispatch_attempts a
         join bookings b on b.id = a.booking_id
         cross join bounds w
        where a.outcome = 'accepted'
          and a.responded_at >= w.day_start and a.responded_at < w.day_end) as ttm_p90,
      (select count(distinct a.driver_id)::int
         from dispatch_attempts a, bounds w
        where a.outcome = 'accepted'
          and a.responded_at >= w.day_start and a.responded_at < w.day_end) as active_drivers,
      (select count(*)::int from users u, bounds w
        where u.created_at >= w.day_start and u.created_at < w.day_end) as new_customers,
      (select count(*)::int from coupon_redemptions c, bounds w
        where c.created_at >= w.day_start and c.created_at < w.day_end) as coupon_redemptions,
      (select count(*)::int from sos_alerts s, bounds w
        where s.created_at >= w.day_start and s.created_at < w.day_end) as sos_alerts,
      (select (percentile_cont(0.95) within group (
          order by extract(epoch from (s.acknowledged_at - s.created_at))))::float8
         from sos_alerts s, bounds w
        where s.created_at >= w.day_start and s.created_at < w.day_end
          and s.acknowledged_at is not null) as sos_ack_p95
  `)) as unknown as Array<{
    bookings_created: number;
    bookings_matched: number;
    bookings_completed: number;
    bookings_paid: number;
    bookings_cancelled: number;
    no_drivers_found: number;
    gmv: number;
    commission: number;
    tax: number;
    discount: number;
    refunds: number;
    ttm_p50: number | null;
    ttm_p90: number | null;
    active_drivers: number;
    new_customers: number;
    coupon_redemptions: number;
    sos_alerts: number;
    sos_ack_p95: number | null;
  }>;

  const row = dailyRow!;
  // THE DOMAIN TABLES STORE RUPEES (NUMERIC(12,2)); the rollup stores PAISE.
  // One multiplication here, and every consumer of the rollup is paise-clean.
  const gmvPaise = Math.round(row.gmv * 100);
  const commissionPaise = Math.round(row.commission * 100);

  const daily: ComputedDay['daily'] = {
    bookingsCreated: row.bookings_created,
    bookingsMatched: row.bookings_matched,
    bookingsCompleted: row.bookings_completed,
    bookingsPaid: row.bookings_paid,
    bookingsCancelled: row.bookings_cancelled,
    noDriversFound: row.no_drivers_found,
    gmvPaise,
    commissionPaise,
    taxPaise: Math.round(row.tax * 100),
    discountPaise: Math.round(row.discount * 100),
    refundsPaise: Math.round(row.refunds * 100),
    aovPaise: row.bookings_paid > 0 ? Math.round(gmvPaise / row.bookings_paid) : 0,
    takeRateBps: gmvPaise > 0 ? Math.round((commissionPaise / gmvPaise) * 10_000) : 0,
    fillRateBps:
      row.bookings_created > 0
        ? Math.round((row.bookings_matched / row.bookings_created) * 10_000)
        : 0,
    ttmP50Seconds: row.ttm_p50 === null ? null : Math.round(row.ttm_p50),
    ttmP90Seconds: row.ttm_p90 === null ? null : Math.round(row.ttm_p90),
    onTimeBps: null,
    activeDrivers: row.active_drivers,
    newCustomers: row.new_customers,
    couponRedemptions: row.coupon_redemptions,
    sosAlerts: row.sos_alerts,
    sosAckP95Seconds: row.sos_ack_p95 === null ? null : Math.round(row.sos_ack_p95),
  };

  const zoneRows = (await db.execute(sql`
    with bounds as (
      select (${day}::date::timestamp at time zone 'Asia/Kolkata') as day_start,
             ((${day}::date + 1)::timestamp at time zone 'Asia/Kolkata') as day_end
    )
    select z.id as zone_id,
           z.name as zone_name,
           count(b.id)::int as bookings_created,
           count(b.id) filter (where exists (
             select 1 from dispatch_attempts a
              where a.booking_id = b.id and a.outcome = 'accepted'
                and a.responded_at >= w.day_start and a.responded_at < w.day_end))::int
             as bookings_matched,
           count(b.id) filter (where b.status = 'no_drivers_found')::int as no_drivers,
           coalesce(sum(b.total) filter (
             where b.paid_at >= w.day_start and b.paid_at < w.day_end), 0)::float8 as gmv,
           coalesce(sum(b.commission_amount) filter (
             where b.paid_at >= w.day_start and b.paid_at < w.day_end), 0)::float8 as commission,
           (percentile_cont(0.5) within group (
             order by extract(epoch from (
               (select min(a2.responded_at) from dispatch_attempts a2
                 where a2.booking_id = b.id and a2.outcome = 'accepted') - b.created_at))))::float8
             as ttm_p50
      from bookings b
      join service_zones z on z.id = b.zone_id
      cross join bounds w
     where b.created_at >= w.day_start and b.created_at < w.day_end
     group by z.id, z.name
  `)) as unknown as Array<{
    zone_id: string;
    zone_name: string;
    bookings_created: number;
    bookings_matched: number;
    no_drivers: number;
    gmv: number;
    commission: number;
    ttm_p50: number | null;
  }>;

  const bandRows = (await db.execute(sql`
    with bounds as (
      select (${day}::date::timestamp at time zone 'Asia/Kolkata') as day_start,
             ((${day}::date + 1)::timestamp at time zone 'Asia/Kolkata') as day_end
    )
    select b.commission_band::text as band,
           count(*)::int as bookings_paid,
           coalesce(sum(b.total), 0)::float8 as gmv,
           coalesce(sum(b.commission_amount), 0)::float8 as commission,
           coalesce(sum(b.driver_payout), 0)::float8 as driver_payout
      from bookings b
      cross join bounds w
     where b.paid_at >= w.day_start and b.paid_at < w.day_end
       and b.commission_band is not null
     group by b.commission_band
  `)) as unknown as Array<{
    band: 'A' | 'B' | 'C';
    bookings_paid: number;
    gmv: number;
    commission: number;
    driver_payout: number;
  }>;

  const gridRows = (await db.execute(sql`
    with bounds as (
      select (${day}::date::timestamp at time zone 'Asia/Kolkata') as day_start,
             ((${day}::date + 1)::timestamp at time zone 'Asia/Kolkata') as day_end
    )
    select extract(hour from (b.created_at at time zone 'Asia/Kolkata'))::int as hour,
           round(b.pickup_lat::numeric, ${GRID})::float8 as cell_lat,
           round(b.pickup_lng::numeric, ${GRID})::float8 as cell_lng,
           count(*)::int as bookings,
           count(*) filter (where b.status = 'no_drivers_found')::int as no_drivers,
           avg(b.search_wave)::float8 as avg_wave
      from bookings b
      cross join bounds w
     where b.created_at >= w.day_start and b.created_at < w.day_end
     group by 1, 2, 3
  `)) as unknown as Array<{
    hour: number;
    cell_lat: number;
    cell_lng: number;
    bookings: number;
    no_drivers: number;
    avg_wave: number | null;
  }>;

  return {
    daily,
    zones: zoneRows.map((zone) => ({
      zoneId: zone.zone_id,
      zoneName: zone.zone_name,
      bookingsCreated: zone.bookings_created,
      bookingsMatched: zone.bookings_matched,
      noDriversFound: zone.no_drivers,
      gmvPaise: Math.round(zone.gmv * 100),
      commissionPaise: Math.round(zone.commission * 100),
      ttmP50Seconds: zone.ttm_p50 === null ? null : Math.round(zone.ttm_p50),
    })),
    bands: bandRows.map((band) => ({
      band: band.band,
      bookingsPaid: band.bookings_paid,
      gmvPaise: Math.round(band.gmv * 100),
      commissionPaise: Math.round(band.commission * 100),
      driverPayoutPaise: Math.round(band.driver_payout * 100),
    })),
    grid: gridRows.map((cell) => ({
      hour: cell.hour,
      cellLat: cell.cell_lat,
      cellLng: cell.cell_lng,
      bookings: cell.bookings,
      noDrivers: cell.no_drivers,
      avgWave: cell.avg_wave === null ? null : Math.round(cell.avg_wave * 10) / 10,
    })),
  };
}

/**
 * Persist one day absolutely. DELETE-then-INSERT for all four tables inside
 * ONE transaction: a day whose zone rows no longer exist (a zone was deleted)
 * or whose grid shrank must come out exactly as recomputed — an upsert-only
 * pass would leave the vanished rows behind forever.
 */
export async function writeDay(db: Database, day: string): Promise<void> {
  const computed = await computeDay(db, day);

  await db.transaction(async (tx) => {
    const daily = computed.daily;
    await tx.execute(sql`delete from analytics_daily where day = ${day}::date`);
    await tx.execute(sql`
      insert into analytics_daily (
        day, bookings_created, bookings_matched, bookings_completed, bookings_paid,
        bookings_cancelled, no_drivers_found, gmv_paise, commission_paise, tax_paise,
        discount_paise, refunds_paise, aov_paise, take_rate_bps, fill_rate_bps,
        ttm_p50_s, ttm_p90_s, on_time_bps, active_drivers, new_customers,
        coupon_redemptions, sos_alerts, sos_ack_p95_s, updated_at
      ) values (
        ${day}::date, ${daily.bookingsCreated}, ${daily.bookingsMatched},
        ${daily.bookingsCompleted}, ${daily.bookingsPaid}, ${daily.bookingsCancelled},
        ${daily.noDriversFound}, ${daily.gmvPaise}, ${daily.commissionPaise},
        ${daily.taxPaise}, ${daily.discountPaise}, ${daily.refundsPaise},
        ${daily.aovPaise}, ${daily.takeRateBps}, ${daily.fillRateBps},
        ${daily.ttmP50Seconds}, ${daily.ttmP90Seconds}, ${daily.onTimeBps},
        ${daily.activeDrivers}, ${daily.newCustomers}, ${daily.couponRedemptions},
        ${daily.sosAlerts}, ${daily.sosAckP95Seconds}, now()
      )
    `);

    await tx.execute(sql`delete from analytics_zone_daily where day = ${day}::date`);
    for (const zone of computed.zones) {
      await tx.execute(sql`
        insert into analytics_zone_daily (
          day, zone_id, bookings_created, bookings_matched, no_drivers_found,
          gmv_paise, commission_paise, ttm_p50_s
        ) values (
          ${day}::date, ${zone.zoneId}::uuid, ${zone.bookingsCreated},
          ${zone.bookingsMatched}, ${zone.noDriversFound}, ${zone.gmvPaise},
          ${zone.commissionPaise}, ${zone.ttmP50Seconds}
        )
      `);
    }

    await tx.execute(sql`delete from analytics_band_daily where day = ${day}::date`);
    for (const band of computed.bands) {
      await tx.execute(sql`
        insert into analytics_band_daily (
          day, band, bookings_paid, gmv_paise, commission_paise, driver_payout_paise
        ) values (
          ${day}::date, ${band.band}::commission_band, ${band.bookingsPaid},
          ${band.gmvPaise}, ${band.commissionPaise}, ${band.driverPayoutPaise}
        )
      `);
    }

    await tx.execute(sql`delete from analytics_demand_grid where day = ${day}::date`);
    for (const cell of computed.grid) {
      await tx.execute(sql`
        insert into analytics_demand_grid (day, hour, cell_lat, cell_lng, bookings, no_drivers, avg_wave)
        values (
          ${day}::date, ${cell.hour}, ${cell.cellLat}::numeric, ${cell.cellLng}::numeric,
          ${cell.bookings}, ${cell.noDrivers}, ${cell.avgWave}::numeric
        )
      `);
    }
  });
}

/**
 * §22.2's retention half: `dispatch_wave_logs` past 30 days are purged by the
 * same job (the index `idx_dispatch_wave_logs_ran_at` was added in migration
 * 0023 for exactly this). The logs exist for the inspector's window, not
 * forever — a wave log row carries candidate ids, not money.
 */
export async function purgeWaveLogs(db: DatabaseExecutor, days = 30): Promise<number> {
  // `returning id` rather than a rowCount: the postgres.js driver hands back
  // rows, not a Result object, so the count must come from the RETURNING set.
  const rows = (await db.execute(sql`
    delete from dispatch_wave_logs
     where ran_at < now() - make_interval(days => ${days})
    returning id
  `)) as unknown as Array<{ id: string }>;
  return rows.length;
}
