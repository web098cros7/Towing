'use client';

import { useQuery } from '@tanstack/react-query';
import { adminCommissionKeys } from './adminCommission.keys';
import { adminCommissionDataSource } from './adminCommissionDataSource';

/**
 * §3.3's bands + the live window (decision G2).
 *
 * `staleTime: 0` with a focus refetch: a super admin moving the guardrail in
 * another tab changes what THIS form will accept, and a stale window would make
 * a legitimate save look like a server bug.
 */
export function useAdminCommission() {
  return useQuery({
    queryKey: adminCommissionKeys.config(),
    queryFn: () => adminCommissionDataSource.config(),
    staleTime: 0,
    refetchOnWindowFocus: true,
  });
}

export function useAdminCommissionHistory() {
  return useQuery({
    queryKey: adminCommissionKeys.history(),
    queryFn: () => adminCommissionDataSource.history(),
    staleTime: 30_000,
  });
}

export function useAdminCommissionProposals() {
  return useQuery({
    queryKey: adminCommissionKeys.proposals(),
    queryFn: () => adminCommissionDataSource.proposals(),
    staleTime: 0,
    refetchOnWindowFocus: true,
  });
}

/**
 * The preview is FETCHED, never computed here: the arithmetic runs over actual
 * paid bookings on the server, and this hook only asks for a set of proposed
 * percentages. `enabled` keeps it from firing before the operator asks.
 */
export function useCommissionImpact(bands: string, days: number, enabled: boolean) {
  return useQuery({
    queryKey: adminCommissionKeys.impact(bands, days),
    queryFn: () => adminCommissionDataSource.impact(bands, days),
    enabled,
    staleTime: 30_000,
  });
}
