import { useQuery } from '@tanstack/react-query';
import { reportsKeys } from './reports.keys';
import { reportsDataSource } from './reportsDataSource';
import type { ReportQuery } from '../types';

/**
 * `enabled: false` — a report runs when the operator presses Generate, not on
 * every parameter change. §9.3.8's AC is that report queries "hit read paths
 * (no impact on live ops)", and firing one per pill click would make the
 * console the noisiest reader of the projection.
 */
export function useReport(query: ReportQuery) {
  return useQuery({
    queryKey: reportsKeys.report(query),
    queryFn: () => reportsDataSource.generate(query),
    enabled: false,
    // A generated report is a snapshot of a closed period; refetching it on
    // focus would replace what the operator is reading mid-scroll.
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
}
