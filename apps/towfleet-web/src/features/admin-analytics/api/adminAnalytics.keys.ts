import type { AnalyticsExportDataset } from '@towing/api-contracts';

export interface AnalyticsRange {
  from: string;
  to: string;
}

export const adminAnalyticsKeys = {
  all: ['admin-analytics'] as const,
  summary: (range: AnalyticsRange) => [...adminAnalyticsKeys.all, 'summary', range] as const,
  revenue: (range: AnalyticsRange) => [...adminAnalyticsKeys.all, 'revenue', range] as const,
  drivers: (range: AnalyticsRange) => [...adminAnalyticsKeys.all, 'drivers', range] as const,
  geo: (range: AnalyticsRange) => [...adminAnalyticsKeys.all, 'geo', range] as const,
};

export type { AnalyticsExportDataset };
