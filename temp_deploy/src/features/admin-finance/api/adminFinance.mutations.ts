'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { AdminFinanceConfigDto } from '@towing/api-contracts';
import { adminFinanceKeys } from './adminFinance.keys';
import { adminFinanceDataSource } from './adminFinanceDataSource';

/**
 * §14.4's approval.
 *
 * `retry: false` on both decisions, and it is not a stylistic choice. React
 * Query retries on TIMEOUT as well as on a network error — and a timed-out
 * approve may well have been applied, with the vendor call already made. A
 * blind retry there is a second payout attempt against a real bank account.
 * The operator retries from a refreshed queue instead.
 */
export function useApprovePayout() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payoutId: string) => adminFinanceDataSource.approve(payoutId),
    retry: false,
    onSuccess: () => {
      // The whole namespace: a decision moves the row out of the pending list
      // AND into the history one, and invalidating only the list being viewed
      // leaves the other wrong.
      void queryClient.invalidateQueries({ queryKey: adminFinanceKeys.all });
    },
  });
}

export function useRejectPayout() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ payoutId, reason }: { payoutId: string; reason: string }) =>
      adminFinanceDataSource.reject(payoutId, reason),
    retry: false,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: adminFinanceKeys.all });
    },
  });
}

export function useUpdateFinanceConfig() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (patch: Partial<AdminFinanceConfigDto>) =>
      adminFinanceDataSource.updateConfig(patch),
    retry: false,
    onSuccess: (config) => {
      queryClient.setQueryData(adminFinanceKeys.config(), config);
      void queryClient.invalidateQueries({ queryKey: adminFinanceKeys.all });
    },
  });
}
