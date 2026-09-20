'use client';

import { useQuery } from '@tanstack/react-query';
import { adminAnalyticsDataSource } from './adminAnalyticsDataSource';
import { adminAnalyticsKeys, type AnalyticsRange } from './adminAnalytics.keys';

/**
 * The four reads. `staleTime: 0` + focus refetch like the other consoles; the
 * server memoises today's live compute for 10 s, so polling these costs a
 * rollup read and never a full-day recompute per keystroke.
 */

export function useAnalyticsSummary(range: AnalyticsRange, enabled = true) {
  return useQuery({
    queryKey: adminAnalyticsKeys.summary(range),
    queryFn: () => adminAnalyticsDataSource.summary(range),
    enabled,
    staleTime: 0,
    refetchOnWindowFocus: true,
  });
}

export function useAnalyticsRevenue(range: AnalyticsRange, enabled = true) {
  return useQuery({
    queryKey: adminAnalyticsKeys.revenue(range),
    queryFn: () => adminAnalyticsDataSource.revenue(range),
    enabled,
    staleTime: 0,
    refetchOnWindowFocus: true,
  });
}

export function useAnalyticsDrivers(range: AnalyticsRange, enabled = true) {
  return useQuery({
    queryKey: adminAnalyticsKeys.drivers(range),
    queryFn: () => adminAnalyticsDataSource.drivers(range),
    enabled,
    staleTime: 0,
    refetchOnWindowFocus: true,
  });
}

export function useAnalyticsGeo(range: AnalyticsRange, enabled = true) {
  return useQuery({
    queryKey: adminAnalyticsKeys.geo(range),
    queryFn: () => adminAnalyticsDataSource.geo(range),
    enabled,
    staleTime: 0,
    refetchOnWindowFocus: true,
  });
}
