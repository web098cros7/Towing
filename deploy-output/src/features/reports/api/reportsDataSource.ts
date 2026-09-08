import { apiFetch } from '@/lib/apiClient';
import { env } from '@/lib/env';
import { mockDelay } from '@/lib/mockUtils';
import { reportsMock } from '../mocks/reports.mock';
import type { ReportQuery, ReportResponse } from '../types';

export interface ReportsDataSource {
  generate(query: ReportQuery): Promise<ReportResponse>;
}

const mockSource: ReportsDataSource = {
  generate: async (query) => {
    await mockDelay();
    if (env.mockReportsState === 'error') throw new Error('Mock error state (forced via env)');
    if (env.mockReportsState === 'empty') {
      return query.groupBy === 'period'
        ? { groupBy: 'period', period: { from: query.from, to: query.to }, granularity: query.granularity, rows: [] }
        : { groupBy: query.groupBy, period: { from: query.from, to: query.to }, rows: [] };
    }
    return reportsMock(query);
  },
};

const restSource: ReportsDataSource = {
  generate: (query) => apiFetch<ReportResponse>(`reports${toQueryString(query)}`),
};

export const reportsDataSource: ReportsDataSource = env.useMocks ? mockSource : restSource;

/**
 * §9.3.8's CSV export. A plain download link rather than a fetch — the response
 * is streamed by the backend and the browser handles it, exactly as the jobs
 * export does.
 */
export function reportsExportUrl(query: ReportQuery): string {
  return `/api/proxy/reports/export.csv${toQueryString(query)}`;
}

function toQueryString(query: ReportQuery): string {
  const search = new URLSearchParams({
    groupBy: query.groupBy,
    from: query.from,
    to: query.to,
    granularity: query.granularity,
  });
  return `?${search.toString()}`;
}
