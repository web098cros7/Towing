'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AdminDeletionDecision,
  AdminDeletionHold,
  AdminDeletionRequestsQuery,
  AdminRetentionUpdate,
  AdminUserCorrection,
} from '@towing/api-contracts';
import { adminPrivacyKeys } from './adminPrivacy.keys';
import { adminPrivacyDataSource } from './adminPrivacyDataSource';

export function useDeletionRequests(query: AdminDeletionRequestsQuery) {
  return useQuery({
    queryKey: adminPrivacyKeys.requests(query),
    queryFn: () => adminPrivacyDataSource.requests(query),
    staleTime: 0,
    refetchOnWindowFocus: true,
  });
}

export function useDeletionRequest(id: string | null) {
  return useQuery({
    queryKey: adminPrivacyKeys.request(id ?? ''),
    queryFn: () => adminPrivacyDataSource.request(id!),
    enabled: id !== null,
  });
}

/** Invalidates the whole feature — a decision changes the queue row AND the detail. */
function usePrivacyMutation<TInput, TResult>(run: (input: TInput) => Promise<TResult>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: run,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: adminPrivacyKeys.all }),
  });
}

export function useDecideDeletionRequest() {
  return usePrivacyMutation(
    (input: { id: string; decision: 'approve' | 'reject'; body: AdminDeletionDecision }) =>
      adminPrivacyDataSource.decide(input.id, input.decision, input.body),
  );
}

export function useHoldDeletionRequest() {
  return usePrivacyMutation((input: { id: string; body: AdminDeletionHold }) =>
    adminPrivacyDataSource.hold(input.id, input.body),
  );
}

export function useExecuteDeletionRequest() {
  return usePrivacyMutation((id: string) => adminPrivacyDataSource.execute(id));
}

export function useRetentionPolicies() {
  return useQuery({
    queryKey: adminPrivacyKeys.retention(),
    queryFn: () => adminPrivacyDataSource.retention(),
    staleTime: 0,
  });
}

export function useUpdateRetention() {
  return usePrivacyMutation((body: AdminRetentionUpdate) =>
    adminPrivacyDataSource.updateRetention(body),
  );
}

export function useExportUser() {
  return usePrivacyMutation((userId: string) => adminPrivacyDataSource.exportUser(userId));
}

export function useCorrectUser() {
  return usePrivacyMutation((input: { userId: string; body: AdminUserCorrection }) =>
    adminPrivacyDataSource.correctUser(input.userId, input.body),
  );
}
