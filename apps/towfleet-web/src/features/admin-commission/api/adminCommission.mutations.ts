'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import type {
  AdminCommissionGuardrailUpdate,
  AdminCommissionProposalCreate,
  AdminCommissionProposalDecision,
  AdminCommissionUpdate,
} from '@towing/api-contracts';
import { adminCommissionKeys } from './adminCommission.keys';
import { adminCommissionDataSource } from './adminCommissionDataSource';

/**
 * `retry: false` throughout, as everywhere else a config write can time out
 * after committing: the operator re-reads the refreshed numbers rather than
 * having the same decision applied twice.
 */
export function useUpdateCommissionBands() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: AdminCommissionUpdate) => adminCommissionDataSource.updateBands(body),
    retry: false,
    onSuccess: (config) => {
      queryClient.setQueryData(adminCommissionKeys.config(), config);
      void queryClient.invalidateQueries({ queryKey: adminCommissionKeys.all });
    },
  });
}

export function useUpdateCommissionGuardrail() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: AdminCommissionGuardrailUpdate) =>
      adminCommissionDataSource.updateGuardrail(body),
    retry: false,
    onSuccess: (config) => {
      queryClient.setQueryData(adminCommissionKeys.config(), config);
      void queryClient.invalidateQueries({ queryKey: adminCommissionKeys.all });
    },
  });
}

export function useCreateCommissionProposal() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: AdminCommissionProposalCreate) =>
      adminCommissionDataSource.createProposal(body),
    retry: false,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: adminCommissionKeys.proposals() });
    },
  });
}

/** Apply runs the ORDINARY band write on the server, so the guardrail still decides. */
export function useApplyCommissionProposal() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { id: string; body: AdminCommissionProposalDecision }) =>
      adminCommissionDataSource.applyProposal(input.id, input.body),
    retry: false,
    onSuccess: (config) => {
      queryClient.setQueryData(adminCommissionKeys.config(), config);
      void queryClient.invalidateQueries({ queryKey: adminCommissionKeys.all });
    },
  });
}

export function useDeclineCommissionProposal() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { id: string; body: AdminCommissionProposalDecision }) =>
      adminCommissionDataSource.declineProposal(input.id, input.body),
    retry: false,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: adminCommissionKeys.proposals() });
    },
  });
}
