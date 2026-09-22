import type {
  SupportTicketCreateRequest,
  SupportTicketDetail,
  SupportTicketMessage,
  SupportTicketSummary,
} from '@towing/api-contracts';
import type { SupportDataSource } from './supportDataSource';

/**
 * In-memory stand-in for the shared support API.
 *
 * One seeded ticket with an admin reply, so the thread screen has something to
 * render on a fresh install — an empty inbox teaches nothing about what a reply
 * looks like. `create` and `reply` append to the same list, so a driver can walk
 * the whole loop offline.
 */
const DELAY_MS = 300;

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

let seq = 1;
const nextId = (prefix: string) => `${prefix}_${seq++}`;

const now = Date.now();

const tickets: SupportTicketDetail[] = [
  {
    id: 'tkt_seed_1',
    reference: 'TW-2024-0001',
    category: 'payment',
    subject: 'Payment not received for TW-2024-0001',
    status: 'pending_requester',
    priority: 'normal',
    bookingId: 'TW-2024-0001',
    createdAt: new Date(now - 1000 * 60 * 60 * 26).toISOString(),
    updatedAt: new Date(now - 1000 * 60 * 60 * 2).toISOString(),
    firstResponseAt: new Date(now - 1000 * 60 * 60 * 2).toISOString(),
    resolvedAt: null,
    closedAt: null,
    requesterType: 'driver',
    messages: [
      {
        id: 'msg_seed_1',
        authorType: 'requester',
        authorName: 'You',
        body: 'Hi, the customer paid in cash but the trip still shows as unpaid in my earnings. Can you check?',
        attachments: [],
        createdAt: new Date(now - 1000 * 60 * 60 * 26).toISOString(),
      },
      {
        id: 'msg_seed_2',
        authorType: 'admin',
        authorName: 'Priya',
        body: "Thanks for flagging this. I can see the cash confirmation on our side — I've pushed the settlement through. It should reflect in your earnings within the hour.",
        attachments: [],
        createdAt: new Date(now - 1000 * 60 * 60 * 2).toISOString(),
      },
    ],
  },
];

function toSummary(t: SupportTicketDetail): SupportTicketSummary {
  const { messages: _messages, requesterType: _requesterType, ...summary } = t;
  return summary;
}

export const supportMockSource: SupportDataSource = {
  async list() {
    await delay(DELAY_MS);
    return tickets
      .slice()
      .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
      .map(toSummary);
  },

  async get(id) {
    await delay(DELAY_MS);
    const found = tickets.find((t) => t.id === id);
    if (!found) throw new Error(`Support ticket ${id} not found`);
    return found;
  },

  async create(input: SupportTicketCreateRequest) {
    await delay(DELAY_MS);
    const id = nextId('tkt');
    const reference = `TW-${new Date().getFullYear()}-${String(seq).padStart(4, '0')}`;
    const createdAt = new Date().toISOString();
    const message: SupportTicketMessage = {
      id: nextId('msg'),
      authorType: 'requester',
      authorName: 'You',
      body: input.body,
      attachments: [],
      createdAt,
    };
    const detail: SupportTicketDetail = {
      id,
      reference,
      category: input.category,
      subject: input.subject,
      status: 'open',
      priority: 'normal',
      bookingId: input.bookingId ?? null,
      createdAt,
      updatedAt: createdAt,
      firstResponseAt: null,
      resolvedAt: null,
      closedAt: null,
      requesterType: 'driver',
      messages: [message],
    };
    tickets.unshift(detail);
    return { ticketId: id, reference };
  },

  async reply(id, body) {
    await delay(DELAY_MS);
    const found = tickets.find((t) => t.id === id);
    if (!found) throw new Error(`Support ticket ${id} not found`);
    const createdAt = new Date().toISOString();
    found.messages.push({
      id: nextId('msg'),
      authorType: 'requester',
      authorName: 'You',
      body,
      attachments: [],
      createdAt,
    });
    found.updatedAt = createdAt;
    if (found.status === 'pending_requester') found.status = 'in_progress';
  },
};
