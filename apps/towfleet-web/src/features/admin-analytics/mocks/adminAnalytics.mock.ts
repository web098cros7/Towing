import type {
  AnalyticsDay,
  AnalyticsDriverResponse,
  AnalyticsGeoResponse,
  AnalyticsRevenueResponse,
  AnalyticsSummaryResponse,
  AnalyticsTotals,
} from '@towing/api-contracts';
import type { AnalyticsRange } from '../api/adminAnalytics.keys';

/**
 * W17's analytics console, mocked DETERMINISTICALLY.
 *
 * A reading screen with mutations is a made-up story; here the read itself is
 * the product, so the mock's job is to be shaped exactly like the API and
 * stable between runs (the e2e asserts numbers, and `Math.random` would make
 * every assertion a coin toss). Every figure derives from the day's index in
 * the range — same day, same numbers, forever.
 */

const DAY_MS = 86_400_000;
const IST_MS = 5.5 * 3_600_000;
const MAX_DAYS = 45;

const istToday = (): string => new Date(Date.now() + IST_MS).toISOString().slice(0, 10);

const addDays = (day: string, delta: number): string =>
  new Date(Date.parse(`${day}T00:00:00Z`) + delta * DAY_MS).toISOString().slice(0, 10);

function daysInRange(range: AnalyticsRange): string[] {
  const days: string[] = [];
  let cursor = range.from;
  while (cursor <= range.to && days.length < MAX_DAYS) {
    days.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return days;
}

/** Deterministic wobble — no RNG, index in, stable number out. */
const wobble = (index: number, modulo: number): number => (index * 37 + 11) % modulo;

function dayRow(day: string, index: number): AnalyticsDay {
  const created = 40 + wobble(index, 25);
  const matched = Math.round(created * (0.72 + wobble(index, 17) / 100));
  const cancelled = Math.min(created - matched, 2 + wobble(index, 5));
  const noDrivers = Math.max(0, created - matched - cancelled);
  const completed = Math.max(0, matched - 1 - wobble(index, 3));
  const paid = Math.max(0, completed - wobble(index, 2));
  const avgFarePaise = 175_000 + wobble(index, 60) * 1_000;
  const gmvPaise = paid * avgFarePaise;
  const commissionPaise = Math.round(gmvPaise * (0.09 + wobble(index, 4) / 100));
  const discountPaise = wobble(index, 7) * 5_000;
  const refundsPaise = wobble(index, 3) * 12_000;
  const ttmP50Seconds = 240 + wobble(index, 180);

  return {
    day,
    bookingsCreated: created,
    bookingsMatched: matched,
    bookingsCompleted: completed,
    bookingsPaid: paid,
    bookingsCancelled: cancelled,
    noDriversFound: noDrivers,
    gmvPaise,
    commissionPaise,
    taxPaise: 0,
    discountPaise,
    refundsPaise,
    aovPaise: paid > 0 ? Math.round(gmvPaise / paid) : 0,
    takeRateBps: gmvPaise > 0 ? Math.round((commissionPaise / gmvPaise) * 10_000) : 0,
    fillRateBps: created > 0 ? Math.round((matched / created) * 10_000) : 0,
    ttmP50Seconds,
    ttmP90Seconds: Math.round(ttmP50Seconds * 1.6),
    onTimeBps: null,
    activeDrivers: 30 + wobble(index, 31),
    newCustomers: 3 + wobble(index, 10),
    couponRedemptions: wobble(index, 7),
    sosAlerts: wobble(index, 3),
    sosAckP95Seconds: 20 + wobble(index, 70),
  };
}

/** Mirrors the backend's `totalsOf` — the console must not invent its own arithmetic. */
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

export function mockSummary(range: AnalyticsRange): AnalyticsSummaryResponse {
  const days = daysInRange(range).map((day, index) => dayRow(day, index));
  return { days, totals: totalsOf(days) };
}

export function mockRevenue(range: AnalyticsRange): AnalyticsRevenueResponse {
  const summary = mockSummary(range);
  const bands = summary.days.flatMap((day, index) =>
    (['A', 'B', 'C'] as const).map((band) => {
      const share = band === 'A' ? 0.5 : band === 'B' ? 0.3 : 0.2;
      const bookingsPaid = Math.round(day.bookingsPaid * share);
      const gmvPaise = Math.round(day.gmvPaise * share);
      const commissionPaise = Math.round(day.commissionPaise * share);
      const payoutShare = band === 'A' ? 0.55 : 0.7;
      return {
        day: day.day,
        band,
        bookingsPaid,
        gmvPaise,
        commissionPaise,
        driverPayoutPaise: Math.round((gmvPaise - commissionPaise) * payoutShare),
      };
    }),
  );
  void wobble;
  return { days: summary.days, totals: summary.totals, bands };
}

export function mockDriverAnalytics(range: AnalyticsRange): AnalyticsDriverResponse {
  const summary = mockSummary(range);
  return {
    days: summary.days,
    totals: summary.totals,
    ratings: [
      { rating: 1, count: 3 },
      { rating: 2, count: 7 },
      { rating: 3, count: 24 },
      { rating: 4, count: 96 },
      { rating: 5, count: 141 },
    ],
    currentAverages: { acceptancePct: 82.5, completionPct: 94.2, averageRating: 4.6 },
  };
}

export function mockGeo(range: AnalyticsRange): AnalyticsGeoResponse {
  const days = daysInRange(range);
  const focus = days[days.length - 1] ?? istToday();

  const grid = [];
  const hours = [8, 10, 12, 14, 16, 18, 20];
  for (const [hourIndex, hour] of hours.entries()) {
    for (let latStep = 0; latStep < 4; latStep += 1) {
      for (let lngStep = 0; lngStep < 4; lngStep += 1) {
        const seed = hourIndex * 16 + latStep * 4 + lngStep;
        grid.push({
          day: focus,
          hour,
          cellLat: Number((12.9 + latStep * 0.04).toFixed(2)),
          cellLng: Number((77.5 + lngStep * 0.05).toFixed(2)),
          bookings: 1 + wobble(seed, 9),
          noDrivers: wobble(seed, 3),
          avgWave: 1 + wobble(seed, 21) / 10,
        });
      }
    }
  }

  const zones = days.slice(-3).flatMap((day, dayIndex) =>
    ['Contract Ops Zone', 'Airport corridor', 'Old city'].map((zoneName, zoneIndex) => ({
      day,
      zoneId: `00000000-0000-4000-8000-00000000000${dayIndex}${zoneIndex}`,
      zoneName,
      bookingsCreated: 12 + wobble(dayIndex * 3 + zoneIndex, 20),
      bookingsMatched: 9 + wobble(dayIndex * 3 + zoneIndex, 12),
      noDriversFound: wobble(dayIndex + zoneIndex, 4),
      gmvPaise: (12 + wobble(dayIndex * 3 + zoneIndex, 20)) * 210_000,
      commissionPaise: (12 + wobble(dayIndex * 3 + zoneIndex, 20)) * 21_000,
      ttmP50Seconds: 240 + wobble(dayIndex + zoneIndex, 120),
    })),
  );

  return { grid, zones };
}

export { istToday, addDays };
