import type {
  AdminOpsActivityResponse,
  AdminOpsBadgesResponse,
  AdminOpsDashboardResponse,
  AdminOpsLiveQuery,
  AdminOpsLiveResponse,
} from '@towing/api-contracts';
import { adminApiFetch } from '@/lib/adminApiClient';
import { env } from '@/lib/env';
import { resolveMock } from '@/lib/mockUtils';
import {
  adminOpsActivityMock,
  adminOpsBadgesMock,
  adminOpsKpisMock,
  adminOpsLiveMock,
} from '../mocks/adminOps.mock';

/**
 * W3/W4's reads — `/v1/admin/ops/*` through the BFF proxy.
 *
 * Read-only by construction: the dashboard and map observe, they do not act.
 * Every mutation the console offers lives on the screen that owns its domain
 * (KYC decisions on the queue, payout decisions in Finance), so there is
 * nothing here for a mock to fake or an idempotency key to wrap.
 */
export interface AdminOpsDataSource {
  dashboard(): Promise<AdminOpsDashboardResponse>;
  badges(): Promise<AdminOpsBadgesResponse>;
  activity(): Promise<AdminOpsActivityResponse>;
  live(query: AdminOpsLiveQuery): Promise<AdminOpsLiveResponse>;
}

/** The `empty` dev-state: a valid payload of zeros, not a broken one. */
const emptyDashboard: AdminOpsDashboardResponse = {
  kpis: {
    activeRides: 0,
    searching: 0,
    onlineDrivers: 0,
    dispatchableNow: null,
    todayGmvPaise: 0,
    todayCommissionPaise: 0,
    pendingKyc: 0,
    pendingPayouts: 0,
    fillRatePct: null,
    cancelledToday: 0,
    completedUnpaid: 0,
    timeToMatchP50Seconds: null,
    timeToMatchP90Seconds: null,
  },
  at: new Date().toISOString(),
  degraded: true,
};

const mockSource: AdminOpsDataSource = {
  dashboard: () =>
    resolveMock(
      env.mockAdminOpsState,
      { kpis: adminOpsKpisMock, at: new Date().toISOString(), degraded: false },
      emptyDashboard,
    ),
  badges: () =>
    resolveMock(
      env.mockAdminOpsState,
      { badges: adminOpsBadgesMock, at: new Date().toISOString() },
      { badges: { ...adminOpsBadgesMock, pendingKyc: 0, pendingPayouts: 0, deletionRequests: 0 }, at: new Date().toISOString() },
    ),
  activity: () =>
    resolveMock(
      env.mockAdminOpsState,
      { items: adminOpsActivityMock, backfilled: false },
      { items: [], backfilled: true },
    ),
  live: () =>
    resolveMock(env.mockAdminOpsState, adminOpsLiveMock, {
      drivers: [],
      bookings: [],
      zones: [],
      at: new Date().toISOString(),
      degraded: false,
    }),
};

const restSource: AdminOpsDataSource = {
  dashboard: () => adminApiFetch<AdminOpsDashboardResponse>('ops/dashboard'),
  badges: () => adminApiFetch<AdminOpsBadgesResponse>('ops/badges'),
  activity: () => adminApiFetch<AdminOpsActivityResponse>('ops/activity'),
  live: (query) => {
    const params = new URLSearchParams();
    if (query.zoneId) params.set('zoneId', query.zoneId);
    if (query.status) params.set('status', query.status);
    const qs = params.toString();
    return adminApiFetch<AdminOpsLiveResponse>(`ops/live${qs ? `?${qs}` : ''}`);
  },
};

export const adminOpsDataSource: AdminOpsDataSource = env.useMocks ? mockSource : restSource;
