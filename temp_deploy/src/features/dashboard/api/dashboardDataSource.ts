import type { DashboardSummaryDto } from '@towing/api-contracts';
import { apiFetch } from '@/lib/apiClient';
import { env } from '@/lib/env';
import { resolveMock } from '@/lib/mockUtils';
import { dashboardMock } from '../mocks/dashboard.mock';
import type { DashboardSummary } from '../types';

/** UI ↔ backend boundary: the REST impl swaps in with no hook/component changes. */
export interface DashboardDataSource {
  getSummary(): Promise<DashboardSummary>;
}

const mockSource: DashboardDataSource = {
  getSummary: () =>
    resolveMock(env.mockDashboardState, dashboardMock, {
      kpis: { activeTrucks: 0, totalTrucks: 0, jobsToday: 0, revenueTodayPaise: 0, utilizationPct: 0 },
      alerts: [],
    }),
};

const restSource: DashboardDataSource = {
  getSummary: () => apiFetch<DashboardSummaryDto>('dashboard'),
};

export const dashboardDataSource: DashboardDataSource = env.useMocks ? mockSource : restSource;
