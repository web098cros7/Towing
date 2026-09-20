'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import type {
  AdminSupportAssignBody,
  AdminSupportLinkBookingBody,
  AdminSupportNoteBody,
  AdminSupportReplyBody,
  AdminSupportStatusBody,
} from '@towing/api-contracts';
import { adminSupportKeys } from './adminSupport.keys';
import { adminSupportDataSource } from './adminSupportDataSource';

/**
 * W15's support workflow writes. The actions return the fresh detail, so each
 * mutation seeds the detail cache from its own response AND invalidates the
 * list — the queue's "awaiting first response" chip and the thread can never
 * disagree about the same ticket.
 *
 * `retry: false` for the same reason as SOS: these are audited operator actions
 * and a blind retry after a timeout would double-post a message a customer can
 * see.
 */
function useTicketInvalidation(ticketId: string) {
  const queryClient = useQueryClient();

  return () => {
    void queryClient.invalidateQueries({ queryKey: adminSupportKeys.detail(ticketId) });
    void queryClient.invalidateQueries({ queryKey: [...adminSupportKeys.all, 'list'] });
  };
}

export function useAssignTicket(ticketId: string) {
  const invalidate = useTicketInvalidation(ticketId);
  return useMutation({
    mutationFn: (body: AdminSupportAssignBody) => adminSupportDataSource.assign(ticketId, body),
    retry: false,
    onSuccess: invalidate,
  });
}

export function useSetTicketStatus(ticketId: string) {
  const invalidate = useTicketInvalidation(ticketId);
  return useMutation({
    mutationFn: (body: AdminSupportStatusBody) => adminSupportDataSource.status(ticketId, body),
    retry: false,
    onSuccess: invalidate,
  });
}

export function useReplyTicket(ticketId: string) {
  const invalidate = useTicketInvalidation(ticketId);
  return useMutation({
    mutationFn: (body: AdminSupportReplyBody) => adminSupportDataSource.reply(ticketId, body),
    retry: false,
    onSuccess: invalidate,
  });
}

export function useNoteTicket(ticketId: string) {
  const invalidate = useTicketInvalidation(ticketId);
  return useMutation({
    mutationFn: (body: AdminSupportNoteBody) => adminSupportDataSource.note(ticketId, body),
    retry: false,
    onSuccess: invalidate,
  });
}

export function useLinkTicketBooking(ticketId: string) {
  const invalidate = useTicketInvalidation(ticketId);
  return useMutation({
    mutationFn: (body: AdminSupportLinkBookingBody) =>
      adminSupportDataSource.linkBooking(ticketId, body),
    retry: false,
    onSuccess: invalidate,
  });
}
