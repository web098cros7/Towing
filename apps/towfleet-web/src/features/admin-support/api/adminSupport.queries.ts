'use client';

import { useQuery } from '@tanstack/react-query';
import type { AdminSupportTicketsQuery } from '@towing/api-contracts';
import { adminSupportKeys } from './adminSupport.keys';
import { adminSupportDataSource } from './adminSupportDataSource';

/**
 * The support queue and one thread.
 *
 * The queue list has no `refetchInterval`, unlike the SOS queue: a ticket is
 * not a person in danger, and a queue that reshuffles under the cursor while
 * an operator reads it is worse than one that is 30 s behind. The open thread,
 * however, IS a live conversation — a customer's new message must appear
 * without a reload — so the single-ticket DETAIL query polls every 10 s.
 * `staleTime: 0` keeps a reopened thread honest after mutations.
 */
export function useAdminSupportTickets(query: AdminSupportTicketsQuery) {
  return useQuery({
    queryKey: adminSupportKeys.list(query),
    queryFn: () => adminSupportDataSource.list(query),
    staleTime: 0,
    refetchOnWindowFocus: true,
  });
}

export function useAdminSupportTicket(ticketId: string | null) {
  return useQuery({
    queryKey: adminSupportKeys.detail(ticketId ?? ''),
    queryFn: () => adminSupportDataSource.detail(ticketId as string),
    enabled: Boolean(ticketId),
    staleTime: 0,
    refetchOnWindowFocus: true,
    refetchInterval: 10_000,
  });
}
