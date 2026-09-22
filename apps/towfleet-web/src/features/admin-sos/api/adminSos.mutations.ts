'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import type {
  AdminSosBroadcastBody,
  AdminSosContactBody,
  AdminSosNoteBody,
  AdminSosResolveBody,
} from '@towing/api-contracts';
import { adminOpsKeys } from '@/features/admin-ops/api/adminOps.keys';
import { adminSosKeys } from './adminSos.keys';
import { adminSosDataSource } from './adminSosDataSource';

/**
 * W14's SOS workflow writes. `retry: false` throughout — every one of these is
 * an audited operator action with a timeline row behind it, and a blind retry
 * after a timeout would either duplicate an event or land on an alert another
 * operator just resolved (409). Re-reading the fresh detail is the better
 * answer, and it is what the invalidation below produces.
 */
function useSosInvalidation() {
  const queryClient = useQueryClient();

  return () => {
    void queryClient.invalidateQueries({ queryKey: adminSosKeys.all });
    // The badge (`openSos`) and the dashboard tile both count open incidents;
    // the socket pushes fresh numbers every 10 s, but this makes the console
    // correct immediately after an in-page action even if the socket is down.
    void queryClient.invalidateQueries({ queryKey: adminOpsKeys.all });
  };
}

export function useAcknowledgeSos(alertId: string) {
  const invalidate = useSosInvalidation();
  return useMutation({
    mutationFn: () => adminSosDataSource.acknowledge(alertId),
    retry: false,
    onSuccess: invalidate,
  });
}

export function useAddSosNote(alertId: string) {
  const invalidate = useSosInvalidation();
  return useMutation({
    mutationFn: (body: AdminSosNoteBody) => adminSosDataSource.note(alertId, body),
    retry: false,
    onSuccess: invalidate,
  });
}

export function useContactSos(alertId: string) {
  const invalidate = useSosInvalidation();
  return useMutation({
    mutationFn: (body: AdminSosContactBody) => adminSosDataSource.contact(alertId, body),
    retry: false,
    onSuccess: invalidate,
  });
}

export function useResolveSos(alertId: string) {
  const invalidate = useSosInvalidation();
  return useMutation({
    mutationFn: (body: AdminSosResolveBody) => adminSosDataSource.resolve(alertId, body),
    retry: false,
    onSuccess: invalidate,
  });
}

export function useBroadcastSos(alertId: string) {
  const invalidate = useSosInvalidation();
  return useMutation({
    mutationFn: (body: AdminSosBroadcastBody) => adminSosDataSource.broadcast(alertId, body),
    retry: false,
    onSuccess: invalidate,
  });
}
