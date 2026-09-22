'use client';

import { useQuery } from '@tanstack/react-query';
import { adminPricingKeys } from './adminPricing.keys';
import { adminPricingDataSource } from './adminPricingDataSource';

/**
 * The rate card. `staleTime: 0` with a focus refetch: two operators can be
 * looking at the same fare table, and a price somebody else moved must not sit
 * on screen as if it were current. The write paths return the fresh config and
 * seed the cache directly, so the save animation does not wait for a refetch.
 */
export function useAdminPricing() {
  return useQuery({
    queryKey: adminPricingKeys.config(),
    queryFn: () => adminPricingDataSource.config(),
    staleTime: 0,
    refetchOnWindowFocus: true,
  });
}

/** §9.4.8's version history — opened on demand, so it can afford to be lazy. */
export function useAdminPricingHistory() {
  return useQuery({
    queryKey: adminPricingKeys.history(),
    queryFn: () => adminPricingDataSource.history(),
    staleTime: 30_000,
  });
}
