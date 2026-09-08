import type { AlertsListResponse } from '@towing/api-contracts';
import { apiFetch } from '@/lib/apiClient';
import { env } from '@/lib/env';
import { mockDelay, resolveMock } from '@/lib/mockUtils';
import { alertsMock } from '../mocks/alerts.mock';
import type { AlertsFilter, RecheckResult, StoredAlert } from '../types';

export interface AlertsDataSource {
  list(filter: AlertsFilter): Promise<StoredAlert[]>;
  /** Re-runs the compliance sweep for this fleet so a renewal lands immediately. */
  recheck(): Promise<RecheckResult>;
}

const mockSource: AlertsDataSource = {
  list: async (filter) => {
    const all = await resolveMock(env.mockAlertsState, alertsMock, []);
    return all.filter(
      (alert) =>
        (filter.includeResolved || alert.resolvedAt === null) &&
        (!filter.severity || alert.severity === filter.severity),
    );
  },
  recheck: async () => {
    await mockDelay();
    return {
      expired: 0,
      expiringSoon: 0,
      trucksBlocked: 0,
      trucksCleared: 0,
      alertsOpened: 0,
      alertsResolved: 0,
    };
  },
};

const restSource: AlertsDataSource = {
  list: async (filter) => {
    const params = new URLSearchParams({ limit: '100' });
    if (filter.includeResolved) params.set('includeResolved', 'true');
    if (filter.severity) params.set('severity', filter.severity);
    const res = await apiFetch<AlertsListResponse>(`alerts?${params.toString()}`);
    return res.items;
  },
  recheck: () => apiFetch<RecheckResult>('alerts/recheck', { method: 'POST' }),
};

export const alertsDataSource: AlertsDataSource = env.useMocks ? mockSource : restSource;
