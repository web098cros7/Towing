import { env } from '@/lib/env';
import type { DashboardData } from '../types';
import { dashboardMockSource } from './dashboardMockSource';
import { dashboardRestSource } from './dashboardRestSource';

/**
 * Boundary between UI and backend. Selected by `env.useMocks` — the same
 * switch every other feature uses — so query hooks and components never know
 * which one they are talking to.
 */
export interface DashboardDataSource {
  getDashboard(): Promise<DashboardData>;
}

export const dashboardDataSource: DashboardDataSource = env.useMocks
  ? dashboardMockSource
  : dashboardRestSource;
