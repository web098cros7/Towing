'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import type {
  AdminDisputeAssignBody,
  AdminDisputeEvidenceConfirmBody,
  AdminDisputeNoteBody,
  AdminDisputeOpenBody,
  AdminDisputeResolveBody,
} from '@towing/api-contracts';
import { adminBookingsKeys } from '@/features/admin-bookings/api/adminBookings.keys';
import { adminDisputesKeys } from './adminDisputes.keys';
import { adminDisputesDataSource } from './adminDisputesDataSource';

/**
 * W8's dispute writes. `retry: false` throughout, and for RESOLVE that is
 * sharper than usual: a timed-out resolution may already have refunded money
 * through the gateway. A replay of `resolve` would also find the dispute
 * resolved and 409 — but the operator re-reading a fresh detail is still the
 * better answer than a blind retry.
 */
function useDisputeInvalidation() {
  const queryClient = useQueryClient();

  return () => {
    // Both namespaces: a resolution moves the booking's status and, for the
    // money exits, its payments/refunds — the bookings console must not keep
    // showing pre-resolution numbers.
    void queryClient.invalidateQueries({ queryKey: adminDisputesKeys.all });
    void queryClient.invalidateQueries({ queryKey: adminBookingsKeys.all });
  };
}

export function useOpenDispute(bookingId: string) {
  const invalidate = useDisputeInvalidation();
  return useMutation({
    mutationFn: (body: AdminDisputeOpenBody) => adminDisputesDataSource.open(bookingId, body),
    retry: false,
    onSuccess: invalidate,
  });
}

export function useAssignDispute(disputeId: string) {
  const invalidate = useDisputeInvalidation();
  return useMutation({
    mutationFn: (body: AdminDisputeAssignBody) => adminDisputesDataSource.assign(disputeId, body),
    retry: false,
    onSuccess: invalidate,
  });
}

export function useAddDisputeNote(disputeId: string) {
  const invalidate = useDisputeInvalidation();
  return useMutation({
    mutationFn: (body: AdminDisputeNoteBody) => adminDisputesDataSource.note(disputeId, body),
    retry: false,
    onSuccess: invalidate,
  });
}

export function useResolveDispute(disputeId: string) {
  const invalidate = useDisputeInvalidation();
  return useMutation({
    mutationFn: (body: AdminDisputeResolveBody) =>
      adminDisputesDataSource.resolve(disputeId, body),
    retry: false,
    onSuccess: invalidate,
  });
}

export function useConfirmDisputeEvidence(disputeId: string) {
  const invalidate = useDisputeInvalidation();
  return useMutation({
    mutationFn: (body: AdminDisputeEvidenceConfirmBody) =>
      adminDisputesDataSource.evidenceConfirm(disputeId, body),
    retry: false,
    onSuccess: invalidate,
  });
}
