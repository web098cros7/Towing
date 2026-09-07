import type { EarningsPeriod } from '../types';

/**
 * §9.2.4's query keys.
 *
 * `all` is the invalidation root, and every key below sits under it so a
 * payout — which moves the balance, the available amount AND the payout list —
 * can invalidate one thing rather than three and risk missing one.
 *
 * The namespace matches the server's push payloads: §12.2's `earnings.credited`
 * trigger sends `invalidate: 'driver.earnings'`, which the push handler splits
 * on `.` into a raw query key. Keeping these aligned is what makes a push
 * actually refresh the screen it is about.
 */
export const earningsKeys = {
  all: ['driver', 'earnings'] as const,
  byPeriod: (period: EarningsPeriod) => ['driver', 'earnings', 'period', period] as const,
  trips: () => ['driver', 'earnings', 'trips'] as const,
  weekly: () => ['driver', 'earnings', 'weekly'] as const,
  payouts: () => ['driver', 'earnings', 'payouts'] as const,
  payoutAccount: () => ['driver', 'earnings', 'payout-account'] as const,
};
