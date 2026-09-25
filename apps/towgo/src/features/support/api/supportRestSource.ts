import type {
  SupportTicketCreateResponse,
  SupportTicketDetail,
  SupportTicketsResponse,
} from '@towing/api-contracts';
import { apiFetch } from '@/lib/api/client';
import type { SupportDataSource } from './supportDataSource';

export const supportRestSource: SupportDataSource = {
  list() {
    return apiFetch<SupportTicketsResponse>('support/tickets?page=1&limit=25');
  },

  detail(ticketId) {
    return apiFetch<SupportTicketDetail>(`support/tickets/${ticketId}`);
  },

  create(input) {
    return apiFetch<SupportTicketCreateResponse>('support/tickets', {
      method: 'POST',
      body: JSON.stringify(input),
      // A retried POST without this could file the same story twice.
      idempotent: true,
    });
  },

  reply(ticketId, body) {
    return apiFetch<SupportTicketDetail>(`support/tickets/${ticketId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ body }),
      idempotent: true,
    });
  },

  resolve(ticketId) {
    return apiFetch<SupportTicketDetail>(`support/tickets/${ticketId}/resolve`, {
      method: 'POST',
      idempotent: true,
    });
  },

  presignAttachment() {
    return apiFetch<{ uploadUrl: string; key: string; expiresAt: string }>(
      'support/tickets/attachments/presign',
      { method: 'POST' },
    );
  },
};
