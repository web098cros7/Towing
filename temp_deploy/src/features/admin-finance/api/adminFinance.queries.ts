'use client';

import { useQuery } from '@tanstack/react-query';
import type { AdminPayoutsQuery } from '@towing/api-contracts';
import { adminFinanceKeys } from './adminFinance.keys';
import { adminFinanceDataSource } from './adminFinanceDataSource';

/**
 * §9.4.10's queue.
 *
 * `staleTime: 0` and a window-focus refetch, deliberately: two Finance
 * operators can be working the same queue, and a row somebody else has already
 * approved must not still be sitting there with a live button. The 409 from
 * `decideApproval` is the real guard, but showing a stale queue makes that
 * error look like a bug.
 */
export function useAdminPayouts(query: AdminPayoutsQuery) {
  return useQuery({
    queryKey: adminFinanceKeys.payouts(query),
    queryFn: () => adminFinanceDataSource.payouts(query),
    staleTime: 0,
    refetchOnWindowFocus: true,
  });
}

export function useAdminFinanceConfig() {
  return useQuery({
    queryKey: adminFinanceKeys.config(),
    queryFn: () => adminFinanceDataSource.config(),
  });
}
