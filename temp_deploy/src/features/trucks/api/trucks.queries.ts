import { useQuery } from '@tanstack/react-query';
import { trucksKeys } from './trucks.keys';
import { trucksDataSource } from './trucksDataSource';

export function useTrucks() {
  return useQuery({
    queryKey: trucksKeys.list(),
    queryFn: () => trucksDataSource.list(),
  });
}
