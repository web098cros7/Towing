'use client';

import { useQuery } from '@tanstack/react-query';
import type { AdminOpsLiveQuery } from '@towing/api-contracts';
import type { RealtimeMode } from '@/features/realtime/types';
import { adminOpsDataSource } from './adminOpsDataSource';
import { adminOpsKeys } from './adminOps.keys';

/**
 * W3's dashboard reads (§9.4.2).
 *
 * The polling rule mirrors `useFleetPositions`: while the socket is up,
 * `ops:metrics` / `ops:badges` frames patch the cache and there is no polling;
 * once the transport falls back to `polling` (§19.2), each query refetches on
 * the same 10 s cadence the backend caches at.
 */
const pollingInterval = (mode: RealtimeMode): number | false =>
  mode === 'polling' ? 10_000 : false;

export function useAdminOpsDashboard(enabled: boolean, mode: RealtimeMode) {
  return useQuery({
    queryKey: adminOpsKeys.dashboard(),
    queryFn: () => adminOpsDataSource.dashboard(),
    enabled,
    refetchInterval: pollingInterval(mode),
  });
}

export function useAdminOpsBadges(enabled: boolean, mode: RealtimeMode) {
  return useQuery({
    queryKey: adminOpsKeys.badges(),
    queryFn: () => adminOpsDataSource.badges(),
    enabled,
    refetchInterval: pollingInterval(mode),
  });
}

export function useAdminOpsActivity(enabled: boolean, mode: RealtimeMode) {
  return useQuery({
    queryKey: adminOpsKeys.activity(),
    queryFn: () => adminOpsDataSource.activity(),
    enabled,
    refetchInterval: pollingInterval(mode),
  });
}

/**
 * W4's live snapshot. `staleTime: 0` because the map resyncs from REST on every
 * (re)connect and every filter change — a cached snapshot with a filter applied
 * is exactly the stale-marker problem the resync exists to prevent.
 */
export function useAdminOpsLive(
  query: AdminOpsLiveQuery,
  enabled: boolean,
  mode: RealtimeMode,
) {
  return useQuery({
    queryKey: adminOpsKeys.live({ zoneId: query.zoneId ?? null, status: query.status ?? null }),
    queryFn: () => adminOpsDataSource.live(query),
    enabled,
    refetchInterval: pollingInterval(mode),
    staleTime: 0,
  });
}
