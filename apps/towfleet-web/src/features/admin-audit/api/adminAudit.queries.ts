'use client';

import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import type { AdminAuditQuery } from '@towing/api-contracts';
import { adminAuditKeys } from './adminAudit.keys';
import { adminAuditDataSource } from './adminAuditDataSource';

/**
 * The feed is CURSOR-paginated and "Load more" appends, so this is the one
 * `useInfiniteQuery` in the admin console. Page-based keys would also have
 * worked, but a keyset cursor's whole point is that new rows arriving at the
 * head cannot shift what "page 2" contains — refetching page-based sweeps
 * across a busy audit trail.
 *
 * `staleTime: 0`: audit rows are append-only and an operator opens this screen
 * precisely when they suspect something just happened.
 */
export function useAdminAuditFeed(query: AdminAuditQuery) {
  return useInfiniteQuery({
    queryKey: adminAuditKeys.list(query),
    queryFn: ({ pageParam }) =>
      adminAuditDataSource.list({ ...query, cursor: pageParam ?? undefined }),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    staleTime: 0,
  });
}

export function useAdminAuditDetail(id: string | null) {
  return useQuery({
    queryKey: adminAuditKeys.detail(id),
    queryFn: () => adminAuditDataSource.detail(id!),
    enabled: id !== null,
  });
}
