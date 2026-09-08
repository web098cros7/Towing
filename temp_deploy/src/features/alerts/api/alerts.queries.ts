import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { dashboardKeys } from '@/features/dashboard/api/dashboard.keys';
import { trucksKeys } from '@/features/trucks/api/trucks.keys';
import { alertsKeys } from './alerts.keys';
import { alertsDataSource } from './alertsDataSource';
import type { AlertsFilter } from '../types';

export function useAlerts(filter: AlertsFilter) {
  return useQuery({
    queryKey: alertsKeys.list(filter),
    queryFn: () => alertsDataSource.list(filter),
  });
}

export function useRecheckCompliance() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => alertsDataSource.recheck(),
    onSuccess: () => {
      // A re-check can resolve alerts AND move trucks between `active` and
      // `non_compliant`, which changes the dashboard KPIs and the truck list.
      void queryClient.invalidateQueries({ queryKey: alertsKeys.all });
      void queryClient.invalidateQueries({ queryKey: dashboardKeys.all });
      void queryClient.invalidateQueries({ queryKey: trucksKeys.all });
    },
  });
}
