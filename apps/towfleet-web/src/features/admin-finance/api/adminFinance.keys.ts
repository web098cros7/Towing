import type {
  AdminLedgerQuery,
  AdminPayoutsQuery,
  AdminRefundsQuery,
  AdminTransactionsQuery,
} from '@towing/api-contracts';

export const adminFinanceKeys = {
  all: ['admin-finance'] as const,
  /**
   * Keyed on the FILTER, not just on "payouts": the page can show the pending
   * queue or the whole history, and a decision has to invalidate both — which
   * is why every mutation invalidates `all` rather than one list.
   */
  payouts: (query: Pick<AdminPayoutsQuery, 'state' | 'ownerType' | 'page' | 'q' | 'from' | 'to'>) =>
    [
      ...adminFinanceKeys.all,
      'payouts',
      query.state,
      query.ownerType ?? 'any',
      query.q ?? '',
      query.from ?? '',
      query.to ?? '',
      query.page,
    ] as const,
  config: () => [...adminFinanceKeys.all, 'config'] as const,
  // ── W9's reads ──
  transactions: (query: Partial<AdminTransactionsQuery>) =>
    [...adminFinanceKeys.all, 'transactions', query] as const,
  ledger: (query: Partial<AdminLedgerQuery>) => [...adminFinanceKeys.all, 'ledger', query] as const,
  refunds: (query: Partial<AdminRefundsQuery>) =>
    [...adminFinanceKeys.all, 'refunds', query] as const,
  invariants: () => [...adminFinanceKeys.all, 'invariants'] as const,
  /** §14.4's decision latency — a window, not a page, so it is keyed by days. */
  payoutSla: (windowDays: number) => [...adminFinanceKeys.all, 'payout-sla', windowDays] as const,
};
