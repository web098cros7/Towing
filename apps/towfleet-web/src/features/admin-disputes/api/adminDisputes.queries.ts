'use client';

import { useQuery } from '@tanstack/react-query';
import type { AdminDisputesQuery } from '@towing/api-contracts';
import { adminDisputesKeys } from './adminDisputes.keys';
import { adminDisputesDataSource } from './adminDisputesDataSource';

/** The queue — `staleTime: 0` for the same two-operators-one-queue reason as
 * the bookings list and Finance's approvals. */
export function useAdminDisputes(query: AdminDisputesQuery) {
  return useQuery({
    queryKey: adminDisputesKeys.list(query),
    queryFn: () => adminDisputesDataSource.list(query),
    staleTime: 0,
    refetchOnWindowFocus: true,
  });
}

/** The drawer's detail. Presigned evidence URLs expire quickly, so the drawer
 * refetches on focus rather than pinning a dead URL for the session. */
export function useAdminDispute(disputeId: string | null) {
  return useQuery({
    queryKey: adminDisputesKeys.detail(disputeId ?? ''),
    queryFn: () => adminDisputesDataSource.detail(disputeId as string),
    enabled: Boolean(disputeId),
    staleTime: 0,
    refetchOnWindowFocus: true,
  });
}
