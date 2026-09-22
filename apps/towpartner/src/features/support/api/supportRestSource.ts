import type {
  SupportTicketCreateRequest,
  SupportTicketDetail,
  SupportTicketsResponse,
} from '@towing/api-contracts';
import { apiFetch } from '@/lib/api/client';
import type { SupportDataSource } from './supportDataSource';

/**
 * The REST half. Paths are relative to `/v1` and carry no leading slash — the
 * client owns the prefix, so a route change is one edit rather than a grep.
 */
export const supportRestSource: SupportDataSource = {
  async list() {
    const res = await apiFetch<SupportTicketsResponse>('support/tickets?page=1&limit=50');
    return res.items;
  },

  get(id) {
    return apiFetch<SupportTicketDetail>(`support/tickets/${id}`);
  },

  async create(input: SupportTicketCreateRequest) {
    const res = await apiFetch<{ ticketId: string; reference: string }>('support/tickets', {
      method: 'POST',
      body: JSON.stringify(input),
      idempotent: true,
    });
    return { ticketId: res.ticketId, reference: res.reference };
  },

  async reply(id, body) {
    // The response is the updated detail or the message; the caller refetches
    // either way, so the shape is deliberately not asserted here.
    await apiFetch<unknown>(`support/tickets/${id}/messages`, {
      method: 'POST',
      body: JSON.stringify({ body }),
      idempotent: true,
    });
  },
};
