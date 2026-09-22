import { Inject, Injectable } from '@nestjs/common';
import type {
  AnalyticsDay,
  AnalyticsDriverResponse,
  AnalyticsGeoResponse,
  AnalyticsRangeQuery,
  AnalyticsRevenueResponse,
  AnalyticsSummaryResponse,
  AnalyticsTotals,
} from '@towing/api-contracts';
import { streamCsv } from '../../common/csv/csv';
import { ApiException } from '../../common/errors/api-exception';
import { DB, type Database } from '../../db/db.module';
import type { Response } from 'express';
import { computeDay, type ComputedDay } from './analytics-rollup';
import { AnalyticsRepo } from './analytics.repo';

const IST_MS = 5.5 * 3_600_000;
const DAY_MS = 86_400_000;

/** Today's IST calendar date, as `YYYY-MM-DD`. */
function istDayKey(at: Date = new Date()): string {
  return new Date(at.getTime() + IST_MS).toISOString().slice(0, 10);
}

function addDays(day: string, delta: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + delta * DAY_MS).toISOString().slice(0, 10);
}

/**
 * W17's read side (§9.4.13): closed days from the rollups, TODAY computed live.
 *
 * THE MERGE IS THE DESIGN. The nightly job cannot have today's row yet, so a
 * dashboard that read only rollups would show yesterday's numbers as "today's"
 * or nothing at all until 00:15 IST. Every method here assembles
 * `rollups(closed days) + liveCompute(today)` — through the SAME `computeDay`
 * the job persists, so the number on screen and tonight's row can never
 * disagree. The live day is memoised for 10 s (`LIVE_TTL_MS`), the same
 * cache-then-recompute cadence as the ops dashboard.
 */
@Injectable()
export class AnalyticsService {
  private static readonly LIVE_TTL_MS = 10_000;
  private readonly liveCache = new Map<string, { at: number; value: ComputedDay }>();

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly repo: AnalyticsRepo,
  ) {}

  async summary(query: AnalyticsRangeQuery): Promise<AnalyticsSummaryResponse> {
    const { from, to } = resolveRange(query);
    const days = await this.daysFor(from, to);
    return { days, totals: totalsOf(days) };
  }

  /** The marketplace's own slice is the day rows; the console charts them. */
  async marketplace(query: AnalyticsRangeQuery): Promise<AnalyticsSummaryResponse> {
    return this.summary(query);
  }

  async revenue(query: AnalyticsRangeQuery): Promise<AnalyticsRevenueResponse> {
    const { from, to } = resolveRange(query);
    const days = await this.daysFor(from, to);
    const today = istDayKey();

    const closedTo = minDay(to, addDays(today, -1));
    const persisted = from <= closedTo ? await this.repo.bands(from, closedTo) : [];
    const live =
      to >= today && from <= today
        ? (await this.liveComputed(today)).bands.map((band) => ({ ...band, day: today }))
        : [];

    return { days, totals: totalsOf(days), bands: [...persisted, ...live] };
  }

  async drivers(query: AnalyticsRangeQuery): Promise<AnalyticsDriverResponse> {
    const { from, to } = resolveRange(query);
    const days = await this.daysFor(from, to);
    const [ratings, currentAverages] = await Promise.all([
      this.repo.ratings(from, to),
      this.repo.driverAverages(),
    ]);
    return { days, totals: totalsOf(days), ratings, currentAverages };
  }

  async geo(query: AnalyticsRangeQuery): Promise<AnalyticsGeoResponse> {
    const { from, to } = resolveRange(query);
    const today = istDayKey();
    const closedTo = minDay(to, addDays(today, -1));

    const [gridPersisted, zonesPersisted] =
      from <= closedTo
        ? await Promise.all([this.repo.grid(from, closedTo), this.repo.zones(from, closedTo)])
        : [[], []];

    let gridLive: AnalyticsGeoResponse['grid'] = [];
    let zonesLive: AnalyticsGeoResponse['zones'] = [];
    if (to >= today && from <= today) {
      const live = await this.liveComputed(today);
      gridLive = live.grid.map((cell) => ({ ...cell, day: today }));
      zonesLive = live.zones.map((zone) => ({ ...zone, day: today }));
    }

    return { grid: [...gridPersisted, ...gridLive], zones: [...zonesPersisted, ...zonesLive] };
  }

  /**
   * §22.3's export. ONE PROPERTY MATTERS MOST and is asserted in the spec:
   * aggregate columns only — no customer, driver, mobile, address or name
   * column exists in any dataset, the same rule the fleet statement export
   * already keeps.
   */
  async exportCsv(query: AnalyticsRangeQuery & { dataset: string }, res: Response): Promise<void> {
    const { from, to } = resolveRange(query);

    const DATASETS: Record<string, { header: string[]; rows: string[][] }> = {};

    if (
      query.dataset === 'summary' ||
      query.dataset === 'marketplace' ||
      query.dataset === 'drivers'
    ) {
      const days = await this.daysFor(from, to);
      DATASETS.summary = {
        header: [
          'day',
          'bookings_created',
          'bookings_matched',
          'bookings_completed',
          'bookings_paid',
          'bookings_cancelled',
          'no_drivers_found',
          'gmv_paise',
          'commission_paise',
          'tax_paise',
          'discount_paise',
          'refunds_paise',
          'aov_paise',
          'take_rate_bps',
          'fill_rate_bps',
          'ttm_p50_s',
          'ttm_p90_s',
          'active_drivers',
          'new_customers',
          'coupon_redemptions',
          'sos_alerts',
          'sos_ack_p95_s',
        ],
        rows: days.map(dailyCsvRow),
      };
    } else if (query.dataset === 'revenue') {
      const bands = await this.revenue(query).then((result) => result.bands);
      DATASETS.revenue = {
        header: [
          'day',
          'band',
          'bookings_paid',
          'gmv_paise',
          'commission_paise',
          'driver_payout_paise',
        ],
        rows: bands.map((band) => [
          band.day,
          band.band,
          String(band.bookingsPaid),
          String(band.gmvPaise),
          String(band.commissionPaise),
          String(band.driverPayoutPaise),
        ]),
      };
    } else {
      const geo = await this.geo(query);
      DATASETS.geo = {
        header: ['day', 'hour', 'cell_lat', 'cell_lng', 'bookings', 'no_drivers', 'avg_wave'],
        rows: geo.grid.map((cell) => [
          cell.day,
          String(cell.hour),
          cell.cellLat.toFixed(2),
          cell.cellLng.toFixed(2),
          String(cell.bookings),
          String(cell.noDrivers),
          cell.avgWave === null ? '' : cell.avgWave.toFixed(1),
        ]),
      };
    }

    const dataset = DATASETS[query.dataset]!;
    let cursor = 0;
    await streamCsv(
      res,
      { filename: `analytics-${query.dataset}-${from}-to-${to}.csv`, header: dataset.header },
      async () => {
        const batch = dataset.rows.slice(cursor, cursor + 500);
        cursor += batch.length;
        return batch;
      },
    );
  }

  // ────────────────────────────────────────────────────────── internals ────

  private async daysFor(from: string, to: string): Promise<AnalyticsDay[]> {
    const today = istDayKey();
    const closedTo = minDay(to, addDays(today, -1));
    const persisted = from <= closedTo ? await this.repo.daily(from, closedTo) : [];
    const live =
      to >= today && from <= today
        ? [{ day: today, ...(await this.liveComputed(today)).daily }]
        : [];
    return [...persisted, ...live];
  }

  /**
   * Today's whole compute, memoised for 10 s. The grains (zones/bands/grid)
   * are kept WHOLE here and sliced by each caller — the response shapes only
   * ever carry what their contract declares, so the live row a client sees is
   * byte-for-byte the shape a rollup row has.
   */
  private async liveComputed(day: string): Promise<ComputedDay> {
    const cached = this.liveCache.get(day);
    if (cached && Date.now() - cached.at < AnalyticsService.LIVE_TTL_MS) {
      return cached.value;
    }
    const value = await computeDay(this.db, day);
    this.liveCache.set(day, { at: Date.now(), value });
    return value;
  }
}

function resolveRange(query: AnalyticsRangeQuery): { from: string; to: string } {
  const today = istDayKey();
  const to = query.to ?? today;
  const from = query.from ?? addDays(to, -29);
  if (from > to) {
    throw ApiException.validation('`from` must not be after `to`', { from, to });
  }
  return { from, to };
}

function minDay(a: string, b: string): string {
  return a < b ? a : b;
}

function totalsOf(days: AnalyticsDay[]): AnalyticsTotals {
  const sum = (pick: (day: AnalyticsDay) => number): number =>
    days.reduce((total, day) => total + pick(day), 0);

  const gmvPaise = sum((day) => day.gmvPaise);
  const commissionPaise = sum((day) => day.commissionPaise);
  const bookingsCreated = sum((day) => day.bookingsCreated);
  const bookingsMatched = sum((day) => day.bookingsMatched);
  const bookingsCancelled = sum((day) => day.bookingsCancelled);
  const bookingsPaid = sum((day) => day.bookingsPaid);

  return {
    bookingsCreated,
    bookingsMatched,
    bookingsCompleted: sum((day) => day.bookingsCompleted),
    bookingsPaid,
    bookingsCancelled,
    noDriversFound: sum((day) => day.noDriversFound),
    gmvPaise,
    commissionPaise,
    taxPaise: sum((day) => day.taxPaise),
    discountPaise: sum((day) => day.discountPaise),
    refundsPaise: sum((day) => day.refundsPaise),
    aovPaise: bookingsPaid > 0 ? Math.round(gmvPaise / bookingsPaid) : 0,
    takeRateBps: gmvPaise > 0 ? Math.round((commissionPaise / gmvPaise) * 10_000) : 0,
    fillRateBps: bookingsCreated > 0 ? Math.round((bookingsMatched / bookingsCreated) * 10_000) : 0,
    cancellationRateBps:
      bookingsCreated > 0 ? Math.round((bookingsCancelled / bookingsCreated) * 10_000) : 0,
    driverDays: sum((day) => day.activeDrivers),
    newCustomers: sum((day) => day.newCustomers),
    couponRedemptions: sum((day) => day.couponRedemptions),
    sosAlerts: sum((day) => day.sosAlerts),
  };
}

function dailyCsvRow(day: AnalyticsDay): string[] {
  return [
    day.day,
    String(day.bookingsCreated),
    String(day.bookingsMatched),
    String(day.bookingsCompleted),
    String(day.bookingsPaid),
    String(day.bookingsCancelled),
    String(day.noDriversFound),
    String(day.gmvPaise),
    String(day.commissionPaise),
    String(day.taxPaise),
    String(day.discountPaise),
    String(day.refundsPaise),
    String(day.aovPaise),
    String(day.takeRateBps),
    String(day.fillRateBps),
    day.ttmP50Seconds === null ? '' : String(day.ttmP50Seconds),
    day.ttmP90Seconds === null ? '' : String(day.ttmP90Seconds),
    String(day.activeDrivers),
    String(day.newCustomers),
    String(day.couponRedemptions),
    String(day.sosAlerts),
    day.sosAckP95Seconds === null ? '' : String(day.sosAckP95Seconds),
  ];
}
