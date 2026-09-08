import type { AlertsFilter } from '../types';

export const alertsKeys = {
  all: ['alerts'] as const,
  list: (filter: AlertsFilter) => [...alertsKeys.all, 'list', filter] as const,
};
