import type { PricingEstimateRequest } from '@towing/api-contracts';
import { env } from '@/lib/env';
import type { FareEstimate } from '../types';
import { pricingMockSource } from './pricingMockSource';
import { pricingRestSource } from './pricingRestSource';

/**
 * `POST /v1/pricing/estimate` (§7.6) — breakdown + band + ETA in ≤ 2 s.
 *
 * Resolves to the app-local `FareEstimate`: the contract response plus the
 * optional fields Figma 14/15 draw (fare range, distance charge, coupon code).
 * The REST source returns the plain contract shape, which satisfies it because
 * every extra is optional.
 */
export interface PricingDataSource {
  estimate(input: PricingEstimateRequest): Promise<FareEstimate>;
  /**
   * The same quote, synchronously, for a source that can price on the device.
   * Only the mock can, and it uses this to seed the query so 14's fare row and
   * route callout are populated from the first frame (the design draws no
   * loading state). The REST source leaves it out: a price is never invented
   * on the client. `undefined` means "no quote now" (e.g. the mock's error state).
   */
  quoteNow?(input: PricingEstimateRequest): FareEstimate | undefined;
}

export const pricingDataSource: PricingDataSource = env.useMocks
  ? pricingMockSource
  : pricingRestSource;
