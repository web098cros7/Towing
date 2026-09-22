'use client';

import { useQuery } from '@tanstack/react-query';
import type {
  AdminLedgerQuery,
  AdminPayoutsQuery,
  AdminRefundsQuery,
  AdminTransactionsQuery,
} from '@towing/api-contracts';
import { adminFinanceKeys } from './adminFinance.keys';
import { adminFinanceDataSource } from './adminFinanceDataSource';

/**
 * §9.4.10's queue.
 *
 * `staleTime: 0` and a window-focus refetch, deliberately: two Finance
 * operators can be working the same queue, and a row somebody else has already
 * approved must not still be sitting there with a live button. The 409 from
 * `decideApproval` is the real guard, but showing a stale queue makes that
 * error look like a bug.
 */
export function useAdminPayouts(query: AdminPayoutsQuery) {
  return useQuery({
    queryKey: adminFinanceKeys.payouts(query),
    queryFn: () => adminFinanceDataSource.payouts(query),
    staleTime: 0,
    refetchOnWindowFocus: true,
  });
}

export function useAdminFinanceConfig() {
  return useQuery({
    queryKey: adminFinanceKeys.config(),
    queryFn: () => adminFinanceDataSource.config(),
  });
}

// ── W9's reads ──────────────────────────────────────────────────────────────

/** The transactions table — the same two-operators reasoning as the queue. */
export function useAdminTransactions(query: AdminTransactionsQuery) {
  return useQuery({
    queryKey: adminFinanceKeys.transactions(query),
    queryFn: () => adminFinanceDataSource.transactions(query),
    staleTime: 0,
    refetchOnWindowFocus: true,
  });
}

/**
 * The ledger feed is CURSOR-paginated: `cursor` is part of the key, so walking
 * backwards is a fresh cache entry per page — which is what makes "back" work
 * without keeping every page mounted.
 */
export function useAdminLedger(query: AdminLedgerQuery) {
  return useQuery({
    queryKey: adminFinanceKeys.ledger(query),
    queryFn: () => adminFinanceDataSource.ledger(query),
    staleTime: 30_000,
  });
}

export function useAdminRefunds(query: AdminRefundsQuery) {
  return useQuery({
    queryKey: adminFinanceKeys.refunds(query),
    queryFn: () => adminFinanceDataSource.refunds(query),
    staleTime: 0,
    refetchOnWindowFocus: true,
  });
}

/**
 * §14.1's five invariants, live. `staleTime: 0` on purpose: an operator opens
 * this panel to learn the ledger's state NOW, and a cached "all zero" from ten
 * minutes ago is precisely the answer that must not be trusted.
 */
export function useAdminInvariants() {
  return useQuery({
    queryKey: adminFinanceKeys.invariants(),
    queryFn: () => adminFinanceDataSource.invariants(),
    staleTime: 0,
  });
}

export function useAdminPayoutSla(windowDays = 30) {
  return useQuery({
    queryKey: adminFinanceKeys.payoutSla(windowDays),
    queryFn: () => adminFinanceDataSource.payoutSla(windowDays),
    staleTime: 60_000,
  });
}
