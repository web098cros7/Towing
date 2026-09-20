import type {
  AdminSupportAssignBody,
  AdminSupportLinkBookingBody,
  AdminSupportNoteBody,
  AdminSupportReplyBody,
  AdminSupportStatusBody,
  AdminSupportTicketDetail,
  AdminSupportTicketsQuery,
  AdminSupportTicketsResponse,
} from '@towing/api-contracts';
import { adminApiFetch } from '@/lib/adminApiClient';
import { env } from '@/lib/env';
import { mockDelay, resolveMock } from '@/lib/mockUtils';
import {
  mockSupportAssign,
  mockSupportDetail,
  mockSupportLinkBooking,
  mockSupportList,
  mockSupportNote,
  mockSupportReply,
  mockSupportStatus,
} from '../mocks/adminSupport.mock';

/**
 * W15's support console APIs (§9.4.12).
 *
 * The mock's mutations are LIVE (see the mock module): replying, noting and
 * moving status all mutate module state and come back as a fresh detail, which
 * is exactly what the REST routes return. That is what lets the thread spec
 * prove "public reply is visible to the requester / internal note is not"
 * without a backend — the distinction the whole console turns on.
 */
export interface AdminSupportDataSource {
  list(query: AdminSupportTicketsQuery): Promise<AdminSupportTicketsResponse>;
  detail(ticketId: string): Promise<AdminSupportTicketDetail>;
  assign(ticketId: string, body: AdminSupportAssignBody): Promise<AdminSupportTicketDetail>;
  status(ticketId: string, body: AdminSupportStatusBody): Promise<AdminSupportTicketDetail>;
  reply(ticketId: string, body: AdminSupportReplyBody): Promise<AdminSupportTicketDetail>;
  note(ticketId: string, body: AdminSupportNoteBody): Promise<AdminSupportTicketDetail>;
  linkBooking(
    ticketId: string,
    body: AdminSupportLinkBookingBody,
  ): Promise<AdminSupportTicketDetail>;
}

const mockSource: AdminSupportDataSource = {
  list: async (query) => {
    const empty = { items: [], page: query.page, limit: query.limit, total: 0 };
    return resolveMock(env.mockAdminSupportState, mockSupportList(query), empty);
  },

  detail: async (ticketId) => {
    await mockDelay(200);
    return resolveMock(
      env.mockAdminSupportState,
      mockSupportDetail(ticketId),
      mockSupportDetail(ticketId),
    );
  },

  assign: async (ticketId, body) => {
    await mockDelay(300);
    // The mock has exactly one operator, so both "assign to me" and an explicit
    // id land on the same person — which is what the console shows in mocks mode.
    void body;
    mockSupportAssign(ticketId);
    return mockSupportDetail(ticketId);
  },

  status: async (ticketId, body) => {
    await mockDelay(300);
    mockSupportStatus(ticketId, body.status, body.priority);
    return mockSupportDetail(ticketId);
  },

  reply: async (ticketId, body) => {
    await mockDelay(300);
    mockSupportReply(ticketId, body.body);
    return mockSupportDetail(ticketId);
  },

  note: async (ticketId, body) => {
    await mockDelay(300);
    mockSupportNote(ticketId, body.body);
    return mockSupportDetail(ticketId);
  },

  linkBooking: async (ticketId, body) => {
    await mockDelay(300);
    mockSupportLinkBooking(ticketId, body.bookingId);
    return mockSupportDetail(ticketId);
  },
};

const restSource: AdminSupportDataSource = {
  list: (query) => {
    const params = new URLSearchParams({ page: String(query.page), limit: String(query.limit) });
    if (query.open) params.set('open', 'true');
    if (query.status) params.set('status', query.status);
    if (query.priority) params.set('priority', query.priority);
    if (query.category) params.set('category', query.category);
    if (query.assignedAdminId) params.set('assignedAdminId', query.assignedAdminId);
    if (query.requesterType) params.set('requesterType', query.requesterType);
    if (query.from) params.set('from', query.from);
    if (query.to) params.set('to', query.to);
    return adminApiFetch<AdminSupportTicketsResponse>(`support/tickets?${params.toString()}`);
  },

  detail: (ticketId) => adminApiFetch<AdminSupportTicketDetail>(`support/tickets/${ticketId}`),

  assign: (ticketId, body) =>
    adminApiFetch<AdminSupportTicketDetail>(`support/tickets/${ticketId}/assign`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  status: (ticketId, body) =>
    adminApiFetch<AdminSupportTicketDetail>(`support/tickets/${ticketId}/status`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  reply: (ticketId, body) =>
    adminApiFetch<AdminSupportTicketDetail>(`support/tickets/${ticketId}/message`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  note: (ticketId, body) =>
    adminApiFetch<AdminSupportTicketDetail>(`support/tickets/${ticketId}/note`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  linkBooking: (ticketId, body) =>
    adminApiFetch<AdminSupportTicketDetail>(`support/tickets/${ticketId}/link-booking`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
};

export const adminSupportDataSource: AdminSupportDataSource = env.useMocks
  ? mockSource
  : restSource;
