import { useEffect } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PricingEstimateRequest } from '@towing/api-contracts';
import type { FareEstimate } from '../types';
import { pricingDataSource } from './pricingDataSource';
import { pricingKeys } from './pricing.keys';

/**
 * §7.6: "fare locks when you confirm; may change with demand until then." A
 * stale quote shown as current is the thing that sentence promises not to do,
 * so this is short.
 */
const ESTIMATE_STALE_MS = 60 * 1000;
/** While a quote has failed and nothing is on screen, keep asking. */
const ERROR_RETRY_MS = 10 * 1000;

/**
 * The §9.1.5 step-3 fare estimate.
 *
 * A QUERY, NOT A MUTATION, despite riding a POST. It is idempotent, it is
 * re-run whenever the pin or the service changes, and §9.1.5 wants it cached
 * across a back-and-forward through the flow — all of which are query
 * behaviours. The verb is a POST only because two coordinate pairs do not
 * belong in a query string.
 *
 * `enabled` is what implements "no drop needed": a roadside service quotes with
 * a pickup alone, a tow waits for its destination rather than firing a request
 * that would 422.
 *
 * Figma 14 always draws the fare, so a quote on screen is never dropped:
 * - a source that can price on the device (the mock) seeds the query, and the
 *   request still runs in the background (`initialDataUpdatedAt: 0`);
 * - a re-quote (another vehicle, a moved pin) keeps the previous quote on
 *   screen until the new one lands (`isPlaceholderData`);
 * - a failed quote retries, and keeps retrying while nothing is on screen.
 */
export function useFareEstimate(input: PricingEstimateRequest | undefined, requiresDrop: boolean) {
  const enabled = Boolean(input) && (!requiresDrop || Boolean(input?.drop));
  const quoteNow = pricingDataSource.quoteNow;

  return useQuery<FareEstimate>({
    queryKey: pricingKeys.estimate(input),
    queryFn: () => pricingDataSource.estimate(input!),
    enabled,
    initialData: enabled && input && quoteNow ? () => quoteNow(input) : undefined,
    initialDataUpdatedAt: 0,
    placeholderData: keepPreviousData,
    staleTime: ESTIMATE_STALE_MS,
    retry: 2,
    refetchInterval: (query) =>
      query.state.status === 'error' && query.state.data === undefined ? ERROR_RETRY_MS : false,
  });
}

/**
 * Warms the quotes for the vehicle tiles the customer has not picked yet, so
 * switching tiles on 14 swaps the fare at once instead of holding the previous
 * vehicle's quote while a request runs. Skipped for a source that already
 * prices on the device.
 */
export function usePrefetchFareEstimates(inputs: PricingEstimateRequest[], enabled: boolean) {
  const queryClient = useQueryClient();
  const signature = JSON.stringify(inputs.map((input) => pricingKeys.estimate(input)));

  useEffect(() => {
    if (!enabled || pricingDataSource.quoteNow) return;
    for (const input of inputs) {
      void queryClient.prefetchQuery({
        queryKey: pricingKeys.estimate(input),
        queryFn: () => pricingDataSource.estimate(input),
        staleTime: ESTIMATE_STALE_MS,
      });
    }
    // `signature` stands in for `inputs`, whose identity changes every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, enabled, queryClient]);
}
