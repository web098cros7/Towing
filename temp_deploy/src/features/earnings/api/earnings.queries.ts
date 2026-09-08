import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { alertsKeys } from '@/features/alerts/api/alerts.keys';
import { dashboardKeys } from '@/features/dashboard/api/dashboard.keys';
import { earningsKeys } from './earnings.keys';
import { earningsDataSource } from './earningsDataSource';
import type { DateRange, SplitsFilter } from '../types';

export function useEarningsSummary(range: DateRange = {}) {
  return useQuery({
    queryKey: earningsKeys.summary(range),
    queryFn: () => earningsDataSource.getSummary(range),
  });
}

export function useEarningsSplits(filter: SplitsFilter = {}) {
  return useQuery({
    queryKey: earningsKeys.splits(filter),
    queryFn: () => earningsDataSource.listSplits(filter),
  });
}

export function usePayouts() {
  return useQuery({
    queryKey: earningsKeys.payouts(),
    queryFn: () => earningsDataSource.listPayouts(),
    // §9.3.7 asks for "statuses real-time". A payout changes state a few times
    // a day per fleet, so a short staleTime plus refetch-on-focus covers it
    // without a socket event — the seam is named in `FleetEvent.payout_status`
    // and deliberately left for later.
    staleTime: 10_000,
    refetchOnWindowFocus: true,
  });
}

export function useRequestPayout() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ amountPaise, idempotencyKey }: { amountPaise: number; idempotencyKey: string }) =>
      earningsDataSource.requestPayout({ amountPaise }, idempotencyKey),
    /**
     * ⚠ NO RETRIES. React Query's default retry would re-send the mutation, and
     * if the key were regenerated per attempt that is a real double payment.
     * The key is minted once when the dialog opens (see `RequestPayoutDialog`),
     * so a retry would in fact be safe — but turning retries off means the
     * safety does not depend on remembering that, and the server's 409
     * `payout_already_pending` is not a thing to retry into anyway.
     */
    retry: false,
    onSuccess: () => {
      // The wallet balance moved, the payout list changed, and a failure would
      // have opened a dashboard alert.
      void queryClient.invalidateQueries({ queryKey: earningsKeys.all });
      void queryClient.invalidateQueries({ queryKey: dashboardKeys.all });
      void queryClient.invalidateQueries({ queryKey: alertsKeys.all });
    },
  });
}
