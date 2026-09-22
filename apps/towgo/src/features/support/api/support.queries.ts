import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { SupportTicketCreateRequest } from '@towing/api-contracts';
import { supportDataSource } from './supportDataSource';
import { supportKeys } from './support.keys';

/**
 * W15's requester rail (§9.4.12).
 *
 * A successful reply refetches the LIST too: answering an ops question is what
 * flips `pending_requester` back to `in_progress`, and a list still showing
 * "Waiting on you" after you answered would teach the wrong thing.
 */
export function useSupportTickets(enabled = true) {
  return useQuery({
    queryKey: supportKeys.list(),
    queryFn: () => supportDataSource.list(),
    enabled,
  });
}

export function useSupportTicket(ticketId: string | null, refetchInterval?: number) {
  return useQuery({
    queryKey: supportKeys.detail(ticketId ?? ''),
    queryFn: () => supportDataSource.detail(ticketId as string),
    enabled: Boolean(ticketId),
    refetchInterval,
  });
}

export function useCreateSupportTicket() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: SupportTicketCreateRequest) => supportDataSource.create(input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: supportKeys.list() }),
  });
}

export function useReplySupportTicket(ticketId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: string) => supportDataSource.reply(ticketId, body),
    onSuccess: (detail) => {
      queryClient.setQueryData(supportKeys.detail(ticketId), detail);
      void queryClient.invalidateQueries({ queryKey: supportKeys.list() });
    },
  });
}
