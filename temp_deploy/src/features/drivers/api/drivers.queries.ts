import { useQuery } from '@tanstack/react-query';
import { driversKeys } from './drivers.keys';
import { driversDataSource } from './driversDataSource';

export function useDrivers() {
  return useQuery({
    queryKey: driversKeys.list(),
    queryFn: () => driversDataSource.list(),
  });
}
