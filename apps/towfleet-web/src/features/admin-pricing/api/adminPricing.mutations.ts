'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import type {
  AdminPricingRuleCreate,
  AdminPricingRuleDeactivate,
  AdminPricingUpdate,
} from '@towing/api-contracts';
import { adminPricingKeys } from './adminPricing.keys';
import { adminPricingDataSource } from './adminPricingDataSource';

/**
 * `retry: false` on every write here. Not for the refund reason (no money moves
 * from this page) but for its sibling: an edit that timed out may well have
 * committed, and a blind retry would write the SAME numbers twice — harmless —
 * while the operator believes the first attempt failed. The refreshed table is
 * the better answer.
 *
 * Each success seeds the returned config into the cache AND invalidates the
 * history: a write's whole before/after is a new history row, and a stale
 * version list is the one thing this page is supposed to make auditable.
 */
export function useUpdatePricing() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (patch: AdminPricingUpdate) => adminPricingDataSource.update(patch),
    retry: false,
    onSuccess: (config) => {
      queryClient.setQueryData(adminPricingKeys.config(), config);
      void queryClient.invalidateQueries({ queryKey: adminPricingKeys.history() });
    },
  });
}

export function useCreatePricingRule() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (rule: AdminPricingRuleCreate) => adminPricingDataSource.createRule(rule),
    retry: false,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: adminPricingKeys.all });
    },
  });
}

export function useDeactivatePricingRule() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { ruleId: string; body: AdminPricingRuleDeactivate }) =>
      adminPricingDataSource.deactivateRule(input.ruleId, input.body),
    retry: false,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: adminPricingKeys.all });
    },
  });
}
