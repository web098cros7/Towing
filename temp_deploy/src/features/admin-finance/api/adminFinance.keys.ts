import type { AdminPayoutsQuery } from '@towing/api-contracts';

export const adminFinanceKeys = {
  all: ['admin-finance'] as const,
  /**
   * Keyed on the FILTER, not just on "payouts": the page can show the pending
   * queue or the whole history, and a decision has to invalidate both — which
   * is why every mutation invalidates `all` rather than one list.
   */
  payouts: (query: Pick<AdminPayoutsQuery, 'state' | 'ownerType' | 'page'>) =>
    [...adminFinanceKeys.all, 'payouts', query.state, query.ownerType ?? 'any', query.page] as const,
  config: () => [...adminFinanceKeys.all, 'config'] as const,
};
