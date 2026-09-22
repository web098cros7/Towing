'use client';

import { useQuery } from '@tanstack/react-query';
import type { AdminAdminsQuery } from '@towing/api-contracts';
import { adminAdminsKeys } from './adminAdmins.keys';
import { adminAdminsDataSource } from './adminAdminsDataSource';

/**
 * W2's admin directory. `staleTime: 0` like the finance queue: two super
 * admins can be working the same roster, and a row somebody else just
 * deactivated must not still carry a live button.
 */
export function useAdminAdmins(query: AdminAdminsQuery) {
  return useQuery({
    queryKey: adminAdminsKeys.list(query),
    queryFn: () => adminAdminsDataSource.list(query),
    staleTime: 0,
    refetchOnWindowFocus: true,
  });
}

export function useAdminAdminDetail(id: string | null) {
  return useQuery({
    queryKey: adminAdminsKeys.detail(id ?? 'none'),
    queryFn: () => adminAdminsDataSource.detail(id!),
    enabled: id !== null,
  });
}
