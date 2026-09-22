import type {
  SupportTicketDetail,
  SupportTicketSummary,
  SupportTicketMessage,
} from '@towing/api-contracts';
import { env } from '@/lib/env';
import type { SupportDataSource } from './supportDataSource';

/**
 * The mock support inbox — mutable, so the flow the screens implement (raise →
 * see it listed → answer → watch the status move) is the flow a demo walks.
 *
 * A created ticket lands `open` with a canned reference, exactly as the
 * backend's `TKT-XXXXXXXX` does.
 */

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const at = (minutesAgo: number): string => new Date(Date.now() - minutesAgo * 60_000).toISOString();

let tickets: SupportTicketDetail[] = [
  {
    id: 'mock-ticket-1',
    reference: 'TKT-4A7C21F0',
    category: 'booking',
    subject: 'Driver never arrived',
    status: 'in_progress',
    priority: 'high',
    bookingId: null,
    firstResponseAt: at(280),
    resolvedAt: null,
    closedAt: null,
    createdAt: at(300),
    updatedAt: at(60),
    requesterType: 'user',
    messages: [
      {
        id: 'mock-message-1',
        authorType: 'requester',
        authorName: null,
        body: 'I waited forty minutes and nobody came.',
        attachments: [],
        createdAt: at(300),
      },
      {
        id: 'mock-message-2',
        authorType: 'admin',
        authorName: 'Priya (Support)',
        body: 'We are sorry about that — the driver had a breakdown and we failed to tell you. We are refunding the booking fee.',
        attachments: [],
        createdAt: at(280),
      },
    ],
  },
];

let counter = 0;

export const supportMockSource: SupportDataSource = {
  async list() {
    await delay(400);
    if (env.mockSupportState === 'error') throw new Error('Failed to load your tickets');
    if (env.mockSupportState === 'empty') {
      return { items: [], page: 1, limit: 25, total: 0 };
    }
    const items: SupportTicketSummary[] = tickets
      .map(({ messages: _messages, requesterType: _requesterType, ...summary }) => summary)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return { items, page: 1, limit: 25, total: items.length };
  },

  async detail(ticketId) {
    await delay(400);
    const ticket = tickets.find((row) => row.id === ticketId);
    if (!ticket) throw new Error('Ticket not found');
    return ticket;
  },

  async create(input) {
    await delay(600);
    counter += 1;
    const now = new Date().toISOString();
    const reference = `TKT-${counter.toString(16).toUpperCase().padStart(8, '0')}`;
    const ticket: SupportTicketDetail = {
      id: `mock-ticket-${100 + counter}`,
      reference,
      category: input.category,
      subject: input.subject,
      status: 'open',
      priority: 'normal',
      bookingId: input.bookingId ?? null,
      firstResponseAt: null,
      resolvedAt: null,
      closedAt: null,
      createdAt: now,
      updatedAt: now,
      requesterType: 'user',
      messages: [
        {
          id: `mock-message-${100 + counter}`,
          authorType: 'requester',
          authorName: null,
          body: input.body,
          attachments: [],
          createdAt: now,
        },
      ],
    };
    tickets = [ticket, ...tickets];
    return { ticketId: ticket.id, reference, status: 'open', createdAt: now };
  },

  async reply(ticketId, body) {
    await delay(500);
    const ticket = tickets.find((row) => row.id === ticketId);
    if (!ticket) throw new Error('Ticket not found');
    if (ticket.status === 'resolved' || ticket.status === 'closed') {
      throw new Error('This ticket is closed — raise a new one if you still need help.');
    }

    const now = new Date().toISOString();
    const message: SupportTicketMessage = {
      id: `mock-message-${Date.now()}`,
      authorType: 'requester',
      authorName: null,
      body,
      attachments: [],
      createdAt: now,
    };
    const next: SupportTicketDetail = {
      ...ticket,
      // Answering an ops question is exactly what `pending_requester` waits for.
      status: ticket.status === 'pending_requester' ? 'in_progress' : ticket.status,
      updatedAt: now,
      messages: [...ticket.messages, message],
    };
    tickets = tickets.map((row) => (row.id === ticketId ? next : row));
    return next;
  },

  async presignAttachment() {
    await delay(200);
    return {
      uploadUrl: 'mock://uploads/support/att.jpg',
      key: `mock-att-${Date.now()}`,
      expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
    };
  },
};
