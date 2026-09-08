import { useQuery } from '@tanstack/react-query';
import { dashboardKeys } from './dashboard.keys';
import { dashboardDataSource } from './dashboardDataSource';

export function useDashboardSummary() {
  return useQuery({
    queryKey: dashboardKeys.summary(),
    queryFn: () => dashboardDataSource.getSummary(),
  });
}
