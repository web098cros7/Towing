import type { PricingEstimateResponse } from '@towing/api-contracts';
import { apiFetch } from '@/lib/api/client';
import type { PricingDataSource } from './pricingDataSource';

export const pricingRestSource: PricingDataSource = {
  estimate: (input) =>
    apiFetch<PricingEstimateResponse>('pricing/estimate', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
};
