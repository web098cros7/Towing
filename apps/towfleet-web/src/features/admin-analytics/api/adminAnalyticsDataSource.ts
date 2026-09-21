import type {
  AnalyticsDriverResponse,
  AnalyticsExportDataset,
  AnalyticsGeoResponse,
  AnalyticsRangeQuery,
  AnalyticsRevenueResponse,
  AnalyticsSummaryResponse,
} from '@towing/api-contracts';
import { adminApiFetch } from '@/lib/adminApiClient';
import { env } from '@/lib/env';
import { mockDelay, resolveMock } from '@/lib/mockUtils';
import {
  mockDriverAnalytics,
  mockGeo,
  mockRevenue,
  mockSummary,
} from '../mocks/adminAnalytics.mock';
import type { AnalyticsRange } from './adminAnalytics.keys';

/**
 * W17's analytics reads (§9.4.13).
 *
 * EXPORTS ARE PLAIN LINKS, not fetches: `/analytics/export.csv` is a streamed
 * byte download served by the proxy, and the browser is better at downloading
 * it than a `fetch`+Blob dance (`adminBookingsDataSource`'s precedent). The
 * URL builder lives here so the console never hand-assembles a proxy path.
 */
export interface AdminAnalyticsDataSource {
  summary(range: AnalyticsRange): Promise<AnalyticsSummaryResponse>;
  revenue(range: AnalyticsRange): Promise<AnalyticsRevenueResponse>;
  drivers(range: AnalyticsRange): Promise<AnalyticsDriverResponse>;
  geo(range: AnalyticsRange): Promise<AnalyticsGeoResponse>;
  exportCsvUrl(dataset: AnalyticsExportDataset, range: AnalyticsRange): string;
}

const rangeQuery = (range: AnalyticsRange): string =>
  new URLSearchParams({ from: range.from, to: range.to }).toString();

const mockSource: AdminAnalyticsDataSource = {
  summary: async (range) => {
    await mockDelay(200);
    return resolveMock(env.mockAdminAnalyticsState, mockSummary(range), {
      days: [],
      totals: {
        bookingsCreated: 0,
        bookingsMatched: 0,
        bookingsCompleted: 0,
        bookingsPaid: 0,
        bookingsCancelled: 0,
        noDriversFound: 0,
        gmvPaise: 0,
        commissionPaise: 0,
        taxPaise: 0,
        discountPaise: 0,
        refundsPaise: 0,
        aovPaise: 0,
        takeRateBps: 0,
        fillRateBps: 0,
        cancellationRateBps: 0,
        driverDays: 0,
        newCustomers: 0,
        couponRedemptions: 0,
        sosAlerts: 0,
      },
    });
  },
  revenue: async (range) => {
    await mockDelay(200);
    return resolveMock(env.mockAdminAnalyticsState, mockRevenue(range), {
      days: [],
      totals: mockSummary(range).totals,
      bands: [],
    });
  },
  drivers: async (range) => {
    await mockDelay(200);
    return resolveMock(env.mockAdminAnalyticsState, mockDriverAnalytics(range), {
      days: [],
      totals: mockSummary(range).totals,
      ratings: [],
      currentAverages: { acceptancePct: null, completionPct: null, averageRating: null },
    });
  },
  geo: async (range) => {
    await mockDelay(200);
    return resolveMock(env.mockAdminAnalyticsState, mockGeo(range), { grid: [], zones: [] });
  },
  exportCsvUrl: (dataset, range) =>
    `/api/admin-proxy/analytics/export.csv?${new URLSearchParams({
      dataset,
      from: range.from,
      to: range.to,
    }).toString()}`,
};

const restSource: AdminAnalyticsDataSource = {
  summary: (range) =>
    adminApiFetch<AnalyticsSummaryResponse>(`analytics/summary?${rangeQuery(range)}`),
  revenue: (range) =>
    adminApiFetch<AnalyticsRevenueResponse>(`analytics/revenue?${rangeQuery(range)}`),
  drivers: (range) =>
    adminApiFetch<AnalyticsDriverResponse>(`analytics/drivers?${rangeQuery(range)}`),
  geo: (range) => adminApiFetch<AnalyticsGeoResponse>(`analytics/geo?${rangeQuery(range)}`),
  exportCsvUrl: (dataset, range) =>
    `/api/admin-proxy/analytics/export.csv?${new URLSearchParams({
      dataset,
      from: range.from,
      to: range.to,
    }).toString()}`,
};

export const adminAnalyticsDataSource: AdminAnalyticsDataSource = env.useMocks
  ? mockSource
  : restSource;

/** Nothing both sources need from the API beyond the range — re-exported for the panel. */
export type { AnalyticsRangeQuery };
