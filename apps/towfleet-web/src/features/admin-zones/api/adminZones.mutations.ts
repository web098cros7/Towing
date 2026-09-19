'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { AdminZoneCreate, AdminZonePreviewRequest, AdminZoneUpdate } from '@towing/api-contracts';
import { adminZonesKeys } from './adminZones.keys';
import { adminZonesDataSource } from './adminZonesDataSource';

/**
 * Every write here can move where a live driver is considered to be, and the
 * deactivate path can evict them — so no retries (a timed-out write that
 * committed would be replayed as a second reshape), and every success
 * invalidates the whole `admin-zones` key: the list carries the version number
 * and the versions drawer reads what the write just appended.
 */
function invalidate(queryClient: ReturnType<typeof useQueryClient>) {
  void queryClient.invalidateQueries({ queryKey: adminZonesKeys.all });
}

export function useCreateZone() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: AdminZoneCreate) => adminZonesDataSource.create(body),
    retry: false,
    onSuccess: () => invalidate(queryClient),
  });
}

export function useUpdateZone() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { zoneId: string; body: AdminZoneUpdate }) =>
      adminZonesDataSource.update(input.zoneId, input.body),
    retry: false,
    onSuccess: () => invalidate(queryClient),
  });
}

export function useSetZoneActive() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { zoneId: string; active: boolean; reason?: string }) =>
      adminZonesDataSource.setActive(input.zoneId, input.active, input.reason),
    retry: false,
    onSuccess: () => invalidate(queryClient),
  });
}

export function useRestoreZoneVersion() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { zoneId: string; versionId: string }) =>
      adminZonesDataSource.restore(input.zoneId, input.versionId),
    retry: false,
    onSuccess: () => invalidate(queryClient),
  });
}

/**
 * A dry run, so `useMutation` fits better than `useQuery`: it is a POST with a
 * body, it must not be cached, and it must not refetch on focus.
 */
export function usePreviewZone() {
  return useMutation({
    mutationFn: (body: AdminZonePreviewRequest) => adminZonesDataSource.preview(body),
    retry: false,
  });
}
