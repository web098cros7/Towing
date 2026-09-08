import type { DateRange, SplitsFilter } from '../types';

export const earningsKeys = {
  all: ['earnings'] as const,
  summary: (range: DateRange = {}) => [...earningsKeys.all, 'summary', range] as const,
  splits: (filter: SplitsFilter = {}) => [...earningsKeys.all, 'splits', filter] as const,
  payouts: () => [...earningsKeys.all, 'payouts'] as const,
};
