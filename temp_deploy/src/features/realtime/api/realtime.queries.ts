import { useQuery } from '@tanstack/react-query';
import { realtimeKeys } from './realtime.keys';
import { realtimeDataSource } from './realtimeDataSource';
import type { PositionsSnapshot, RealtimeMode } from '../types';

/**
 * The map's data. In `live` mode this holds the REST snapshot that socket
 * batches patch into; in `polling` mode the same query becomes the transport
 * (§19.2 — "apps poll REST for state every 10s").
 */
export function useFleetPositions(mode: RealtimeMode) {
  return useQuery<PositionsSnapshot>({
    queryKey: realtimeKeys.positions(),
    queryFn: () => realtimeDataSource.snapshot(),
    // Only poll when the socket is not carrying updates; polling alongside a
    // live socket would overwrite fresher socket positions with older REST ones.
    refetchInterval: mode === 'polling' ? 10_000 : false,
    // Positions are never "fresh" in the caching sense — the socket or the
    // interval decides when to refetch, not staleTime.
    staleTime: 0,
    enabled: mode !== 'offline',
  });
}
