import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { SupportTicketCreateRequest } from '@towing/api-contracts';
import { supportDataSource } from './supportDataSource';

/**
 * The support surface's cache keys.
 *
 * `list` and `ticket` are separate roots so a reply can invalidate the thread
 * without refetching the inbox, and the inbox without refetching every thread —
 * the two are read at different cadences.
 */
export const supportKeys = {
  all: ['support'] as const,
  list: () => ['support', 'list'] as const,
  ticket: (id: string) => ['support', 'ticket', id] as const,
};

/**
 * The driver's own requests, newest first.
 *
 * No poll: the inbox is a place a driver visits, not a place they wait. The
 * thread screen is where a reply has to arrive without leaving, and that one
 * polls.
 */
export function useSupportTickets() {
  return useQuery({
    queryKey: supportKeys.list(),
    queryFn: () => supportDataSource.list(),
  });
}

/**
 * One thread.
 *
 * THE POLL IS THE POINT. A driver who has just written to support sits on this
 * screen waiting for an answer; making them pull to refresh to see it would be
 * the one interaction the whole feature exists to avoid. Ten seconds is the
 * same order as the job poll and is what turns "check back later" into "the
 * reply appears".
 */
const TICKET_POLL_MS = 10_000;

export function useSupportTicket(id: string | undefined) {
  return useQuery({
    queryKey: supportKeys.ticket(id ?? ''),
    queryFn: () => supportDataSource.get(id!),
    enabled: !!id,
    refetchInterval: TICKET_POLL_MS,
    refetchOnWindowFocus: true,
  });
}

/**
 * Opens a ticket.
 *
 * INVALIDATES THE LIST, not the thread — the thread does not exist yet, and the
 * caller navigates to it by the id this returns. The list has to be refetched
 * because the new ticket belongs at the top of it.
 */
export function useCreateTicket() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: SupportTicketCreateRequest) => supportDataSource.create(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: supportKeys.list() });
    },
  });
}

/**
 * Adds a message to a thread.
 *
 * INVALIDATES BOTH. The thread because the reply is now part of it; the list
 * because the ticket's `updatedAt` moved and its status may have — a ticket
 * that was `pending_requester` becomes `in_progress` the moment the driver
 * answers, and the inbox row has to say so.
 */
export function useReplyToTicket(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: string) => supportDataSource.reply(id, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: supportKeys.ticket(id) });
      void queryClient.invalidateQueries({ queryKey: supportKeys.list() });
    },
  });
}
