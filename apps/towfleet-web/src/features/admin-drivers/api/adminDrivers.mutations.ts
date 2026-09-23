import { useMutation, useQueryClient } from '@tanstack/react-query';
import { adminDriversKeys } from './adminDrivers.keys';
import { adminDriversDataSource, type CapabilitiesUpdateInput } from './adminDriversDataSource';
import type { AdminPendingDriversPage, KycBulkDecision, KycDecision } from '../types';

/** Approve / reject / request-info / suspend / reactivate — the driver-level §3.1 decision. */
export function useDecideKyc() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      driverId,
      decision,
      reason,
      mode,
      licenceName,
    }: {
      driverId: string;
      decision: KycDecision;
      reason?: string;
      /** A14, `suspend` only: shelf until the live job ends (default) or apply now. */
      mode?: 'after_current_job' | 'immediate';
      /** `approve` only: the name as printed on the licence the admin just read. */
      licenceName?: string;
    }) => adminDriversDataSource.decideKyc(driverId, decision, reason, mode, licenceName),
    onSuccess: () => {
      // Every decision changes whether the driver still belongs in the queue —
      // and the queue is paged now, so the whole family is invalidated.
      void queryClient.invalidateQueries({ queryKey: adminDriversKeys.pendingRoot() });
    },
  });
}

/**
 * W7's bulk approve/reject. Deliberately NOT optimistic and never
 * all-or-nothing: the response carries one result per driver, and the caller
 * renders every failure beside the driver it belongs to.
 */
export function useBulkDecideKyc() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      decision,
      driverIds,
      reason,
    }: {
      decision: KycBulkDecision;
      driverIds: string[];
      reason?: string;
    }) => adminDriversDataSource.bulkDecide(decision, driverIds, reason),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: adminDriversKeys.pendingRoot() });
    },
  });
}

/** Per-document approve/reject — Phase 11; W7 added the history it writes to. */
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
    onSuccess: (_result, { driverId }) => {
      void queryClient.invalidateQueries({ queryKey: adminDriversKeys.pendingRoot() });
      // The review completes a version row — the history panel is now stale.
      void queryClient.invalidateQueries({ queryKey: adminDriversKeys.versions(driverId) });
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
      // A19: merge the toggle into the cached page for instant feedback, then
      // invalidate so server truth settles right after. The drawer derives its
      // row from this cache, so it updates without a reload either way.
      queryClient.setQueriesData<AdminPendingDriversPage>(
        { queryKey: adminDriversKeys.pendingRoot() },
        (previous) =>
          previous
            ? {
                ...previous,
                items: previous.items.map((row) =>
                  row.id === driverId
                    ? {
                        ...row,
                        vehicleClass:
                          response.vehicleClass ?? input.vehicleClass ?? row.vehicleClass,
                        longDistanceEnabled:
                          response.longDistanceEnabled ??
                          input.longDistanceEnabled ??
                          row.longDistanceEnabled,
                        services: response.services ?? input.services ?? row.services,
                      }
                    : row,
                ),
              }
            : previous,
      );
      void queryClient.invalidateQueries({ queryKey: adminDriversKeys.pendingRoot() });
    },
  });
}
