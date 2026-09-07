import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { track } from '@/lib/analytics/analytics';
import { earningsDataSource } from './earningsDataSource';
import { earningsKeys } from './earnings.keys';
import type { EarningsPeriod } from '../types';

/** Earnings summary, trend and transactions for a period (Figma "Earnings"). */
export function useEarnings(period: EarningsPeriod) {
  return useQuery({
    queryKey: earningsKeys.byPeriod(period),
    queryFn: () => earningsDataSource.getEarnings(period),
    // MONEY IS NEVER SERVED STALE. The query cache is MMKV-persisted, so
    // without this a driver reopening the app sees yesterday's balance painted
    // instantly and confidently — which is a worse experience than a spinner,
    // because it looks like an answer.
    staleTime: 0,
    gcTime: 0,
  });
}

/** §9.2.4's per-trip gross → commission → net. */
export function useEarningsTrips() {
  return useQuery({
    queryKey: earningsKeys.trips(),
    queryFn: () => earningsDataSource.getTrips(),
    staleTime: 0,
    gcTime: 0,
  });
}

export function useWeeklyEarnings() {
  return useQuery({
    queryKey: earningsKeys.weekly(),
    queryFn: () => earningsDataSource.getWeekly(),
    staleTime: 0,
    gcTime: 0,
  });
}

export function usePayouts() {
  return useQuery({
    queryKey: earningsKeys.payouts(),
    queryFn: () => earningsDataSource.listPayouts(),
    staleTime: 0,
    gcTime: 0,
  });
}

export function usePayoutAccount() {
  return useQuery({
    queryKey: earningsKeys.payoutAccount(),
    queryFn: () => earningsDataSource.getPayoutAccount(),
  });
}

/**
 * §14.4's payout request.
 *
 * `retry: false`, and it is not optional. A retried POST with the same
 * idempotency key is safe, but react-query's automatic retry fires on a
 * TIMEOUT too — and a timeout is precisely the case where the server may well
 * have accepted the payout and only the response was lost. The driver retries
 * by tapping again, from a screen showing them the current truth.
 */
export function useRequestPayout() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ amountPaise, idempotencyKey }: { amountPaise: number; idempotencyKey: string }) =>
      earningsDataSource.requestPayout(amountPaise, idempotencyKey),
    retry: false,
    onSuccess: () => {
      // §22.1, emitted on the CONFIRMED OUTCOME rather than the tap — Phase
      // 18's rule. A driver who opened the sheet and changed their mind did not
      // request a payout.
      track('payout_requested');
      void queryClient.invalidateQueries({ queryKey: earningsKeys.all });
    },
  });
}

export function useLinkPayoutAccount() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { beneficiaryName: string; accountNumber: string; ifsc: string }) =>
      earningsDataSource.linkPayoutAccount(input),
    retry: false,
    onSuccess: (account) => {
      // The server just returned the authoritative row; seeding it saves a
      // round trip and stops the screen flashing its old state.
      queryClient.setQueryData(earningsKeys.payoutAccount(), account);
      void queryClient.invalidateQueries({ queryKey: earningsKeys.all });
    },
  });
}
