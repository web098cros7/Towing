import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { earningsKeys } from '@/features/earnings/api/earnings.keys';
import { settingsKeys } from './settings.keys';
import { settingsDataSource } from './settingsDataSource';
import type { FleetSettings, OnboardingStep, PayoutAccountLink, SettingsUpdate } from '../types';

export function useFleetSettings() {
  return useQuery({
    queryKey: settingsKeys.detail(),
    queryFn: () => settingsDataSource.get(),
  });
}

/** Every mutation returns the whole settings object, so the cache is set, not invalidated. */
function useSettingsMutation<TInput>(
  mutationFn: (input: TInput) => Promise<FleetSettings>,
  options: { touchesPayouts?: boolean } = {},
) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn,
    retry: false,
    onSuccess: (settings) => {
      queryClient.setQueryData(settingsKeys.detail(), settings);
      if (options.touchesPayouts) {
        // `payoutAccountLinked` is what enables the Request-payout button, and
        // it is served by GET /fleet/earnings as well.
        void queryClient.invalidateQueries({ queryKey: earningsKeys.all });
      }
    },
  });
}

export function useUpdateSettings() {
  return useSettingsMutation((patch: SettingsUpdate) => settingsDataSource.update(patch));
}

export function useLinkPayoutAccount() {
  return useSettingsMutation(
    ({ input, idempotencyKey }: { input: PayoutAccountLink; idempotencyKey: string }) =>
      settingsDataSource.linkPayoutAccount(input, idempotencyKey),
    { touchesPayouts: true },
  );
}

export function useUnlinkPayoutAccount() {
  return useSettingsMutation(() => settingsDataSource.unlinkPayoutAccount(), {
    touchesPayouts: true,
  });
}

export function useAdvanceOnboarding() {
  return useSettingsMutation((from: OnboardingStep) => settingsDataSource.advanceOnboarding(from));
}
