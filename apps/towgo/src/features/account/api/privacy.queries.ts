import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { ConsentPolicyType } from '@towing/api-contracts';
import { notificationPrefKeys } from '@/features/notifications/api/notificationPrefs.keys';
import { privacyDataSource } from './privacyDataSource';
import { privacyKeys } from './privacy.keys';

/** Legal → "Delete my account" (spec §20.4). Files a request; a later worker executes it. */
export function useDeleteAccount() {
  return useMutation({
    mutationFn: (reason?: string) => privacyDataSource.deleteAccount(reason),
  });
}

/** Legal → "Download my data". On-demand, so a mutation rather than a cached query. */
export function useExportData() {
  return useMutation({
    mutationKey: privacyKeys.export(),
    mutationFn: () => privacyDataSource.exportData(),
  });
}

/** First-run consent capture — `privacy_policy` and `terms_of_service`, one call each. */
export function useRecordConsent() {
  return useMutation({
    mutationFn: ({ policyType, policyVersion }: { policyType: ConsentPolicyType; policyVersion: string }) =>
      privacyDataSource.recordConsent(policyType, policyVersion),
  });
}

/**
 * Legal → "Withdraw consent". The overlay every customer signs promises this
 * ("You can withdraw consent anytime from Settings") and until now nothing
 * could do it.
 *
 * It stops marketing and leaves the account working, so the marketing
 * preference is invalidated afterwards — the Notifications screen shows that
 * switch and must not keep claiming it is on.
 */
export function useWithdrawConsent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (policyType: ConsentPolicyType) => privacyDataSource.withdrawConsent(policyType),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: notificationPrefKeys.detail() });
    },
  });
}
