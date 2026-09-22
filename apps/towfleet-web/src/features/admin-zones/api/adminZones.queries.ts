'use client';

import { useQuery } from '@tanstack/react-query';
import { adminZonesKeys } from './adminZones.keys';
import { adminZonesDataSource } from './adminZonesDataSource';

/**
 * The zone set, and one zone's shapes.
 *
 * `staleTime: 0` on both: two operators drawing in the same state is the normal
 * case, and a shape is exactly the kind of value where a stale read looks like
 * a bug in the resolver rather than a stale cache.
 */
export function useAdminZones() {
  return useQuery({
    queryKey: adminZonesKeys.list(),
    queryFn: () => adminZonesDataSource.list(),
    staleTime: 0,
    refetchOnWindowFocus: true,
  });
}

export function useAdminZoneVersions(zoneId: string | null) {
  return useQuery({
    queryKey: adminZonesKeys.versions(zoneId ?? 'none'),
    queryFn: () => adminZonesDataSource.versions(zoneId!),
    enabled: !!zoneId,
    staleTime: 0,
  });
}
