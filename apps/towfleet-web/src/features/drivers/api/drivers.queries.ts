import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { driversKeys } from './drivers.keys';
import { driversDataSource } from './driversDataSource';

/** Fetched only while a driver's panel is open (`driverId` set). */
export function useDriverPerformance(driverId: string | null) {
  return useQuery({
    queryKey: driversKeys.performance(driverId ?? ''),
    queryFn: () => driversDataSource.performance(driverId!),
    enabled: driverId !== null,
  });
}

export function useDrivers() {
  return useQuery({
    queryKey: driversKeys.list(),
    queryFn: () => driversDataSource.list(),
  });
}

/** 0042: set one driver's share, or clear it (null) to follow the fleet's default. */
export function useUpdateDriverShare(driverId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (driverSharePct: number | null) =>
      driversDataSource.updateShare(driverId, driverSharePct),
    retry: false,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: driversKeys.performance(driverId) }),
  });
}
