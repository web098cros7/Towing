import type { ReportQuery } from '../types';

export const reportsKeys = {
  all: ['reports'] as const,
  report: (query: ReportQuery) => [...reportsKeys.all, 'report', query] as const,
};
