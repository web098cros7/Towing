import { useMutation, useQueryClient } from '@tanstack/react-query';
import { adminDriversKeys } from './adminDrivers.keys';
import { adminDriversDataSource, type CapabilitiesUpdateInput } from './adminDriversDataSource';
import type { AdminPendingDriver, KycDecision } from '../types';

/** Approve / reject / request-info / suspend / reactivate — the driver-level §3.1 decision. */
export function useDecideKyc() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      driverId,
      decision,
      reason,
    }: {
      driverId: string;
      decision: KycDecision;
      reason?: string;
    }) => adminDriversDataSource.decideKyc(driverId, decision, reason),
    onSuccess: () => {
      // Every decision changes whether the driver still belongs in the queue.
      void queryClient.invalidateQueries({ queryKey: adminDriversKeys.pending() });
    },
  });
}

/** Per-document approve/reject — new in Phase 11. */
export function useReviewDocument() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      driverId,
      documentId,
      decision,
      reason,
    }: {
      driverId: string;
      documentId: string;
      decision: 'approve' | 'reject';
      reason?: string;
    }) => adminDriversDataSource.reviewDocument(driverId, documentId, decision, reason),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: adminDriversKeys.pending() });
    },
  });
}

/** §3.2 — admin can revoke (or grant) the long-distance opt-in and reclassify vehicle class. */
export function useUpdateDriverCapabilities() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ driverId, input }: { driverId: string; input: CapabilitiesUpdateInput }) =>
      adminDriversDataSource.updateCapabilities(driverId, input),
    onSuccess: (response, { driverId, input }) => {
      // A19: merge the toggle into the queue cache for instant feedback, then
      // invalidate so server truth settles right after. The drawer derives its
      // row from this cache, so it updates without a reload either way.
      queryClient.setQueryData<AdminPendingDriver[]>(adminDriversKeys.pending(), (previous) =>
        previous?.map((row) =>
          row.id === driverId
            ? {
                ...row,
                vehicleClass: response.vehicleClass ?? input.vehicleClass ?? row.vehicleClass,
                longDistanceEnabled: response.longDistanceEnabled ?? input.longDistanceEnabled ?? row.longDistanceEnabled,
              }
            : row,
        ),
      );
      void queryClient.invalidateQueries({ queryKey: adminDriversKeys.pending() });
    },
  });
}
