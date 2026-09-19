'use client';

import { useQuery } from '@tanstack/react-query';
import { adminDispatchKeys } from './adminDispatch.keys';
import { adminDispatchDataSource } from './adminDispatchDataSource';

/**
 * §6.7's knobs. `staleTime: 0` with a focus refetch: an incident is exactly when
 * two operators are in this screen at once, and a stale kill switch is the one
 * stale value that makes someone think the wrong thing is broken.
 */
export function useAdminDispatchConfig() {
  return useQuery({
    queryKey: adminDispatchKeys.config(),
    queryFn: () => adminDispatchDataSource.config(),
    staleTime: 0,
    refetchOnWindowFocus: true,
  });
}

export function useAdminAppConfig() {
  return useQuery({
    queryKey: adminDispatchKeys.appConfig(),
    queryFn: () => adminDispatchDataSource.appConfig(),
    staleTime: 0,
    refetchOnWindowFocus: true,
  });
}
