'use client';

import { useQuery } from '@tanstack/react-query';
import type { AdminSosQuery } from '@towing/api-contracts';
import { adminSosKeys } from './adminSos.keys';
import { adminSosDataSource } from './adminSosDataSource';

/**
 * The SOS queue. `refetchInterval` is deliberate here — sharper than the other
 * queues' `staleTime: 0` — because this screen is the fallback when the socket
 * is down (§19.2's force-polling mode): a 15 s poll is the difference between
 * "ops sees it" and "ops sees it when they next click something".
 */
export function useAdminSos(query: AdminSosQuery) {
  return useQuery({
    queryKey: adminSosKeys.list(query),
    queryFn: () => adminSosDataSource.list(query),
    staleTime: 0,
    refetchOnWindowFocus: true,
    refetchInterval: 15_000,
  });
}

/** The shell banner's read: every open incident, polled so it survives a dead socket. */
export function useOpenSosAlerts(enabled: boolean) {
  return useQuery({
    queryKey: adminSosKeys.open(),
    queryFn: () => adminSosDataSource.list({ open: true, page: 1, limit: 10 }),
    enabled,
    staleTime: 0,
    refetchOnWindowFocus: true,
    refetchInterval: 10_000,
  });
}

export function useAdminSosDetail(alertId: string | null) {
  return useQuery({
    queryKey: adminSosKeys.detail(alertId ?? ''),
    queryFn: () => adminSosDataSource.detail(alertId as string),
    enabled: Boolean(alertId),
    staleTime: 0,
    refetchOnWindowFocus: true,
  });
}
