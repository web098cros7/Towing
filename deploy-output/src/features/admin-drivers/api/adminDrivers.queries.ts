import { useQuery } from '@tanstack/react-query';
import { adminDriversKeys } from './adminDrivers.keys';
import { adminDriversDataSource } from './adminDriversDataSource';

export function useAdminPendingDrivers() {
  return useQuery({
    queryKey: adminDriversKeys.pending(),
    queryFn: () => adminDriversDataSource.pending(),
  });
}
