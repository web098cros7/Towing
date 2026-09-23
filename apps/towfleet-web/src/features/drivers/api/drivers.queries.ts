import { useQuery } from '@tanstack/react-query';
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
