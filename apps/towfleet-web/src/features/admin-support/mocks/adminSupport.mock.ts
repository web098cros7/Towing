import type {
  AdminSupportMessage,
  AdminSupportTicket,
  AdminSupportTicketDetail,
  AdminSupportTicketsQuery,
  AdminSupportTicketsResponse,
  AdminSupportTicketEvent,
} from '@towing/api-contracts';

/**
 * W15's mocks-on support fixtures (M5).
 *
 * Mutations are LIVE in module state, like the SOS console's: the public says
 * something, the console answers, the status moves — and a spec that cannot
 * cross that flow cannot prove the thread works. Nothing leaves the browser:
 * the console still opens no socket and sends no request in mocks mode.
 */

const MINUTE = 60_000;
const at = (minutesAgo: number): string => new Date(Date.now() - minutesAgo * MINUTE).toISOString();

const OPEN_ID = '51000000-0000-4000-8000-000000000001';
const PENDING_ID = '51000000-0000-4000-8000-000000000002';
const RESOLVED_ID = '51000000-0000-4000-8000-000000000003';

const MOCK_ADMIN_ID = '00000000-0000-4000-8000-000000000001';
const MOCK_ADMIN_NAME = 'Mock Admin';

let tickets: AdminSupportTicket[] = [
  {
    id: OPEN_ID,
    reference: 'TKT-4A7C21F0',
    requesterType: 'user',
    requesterId: '00000000-0000-4000-8000-0000000000c1',
    requesterName: 'Meera Nair',
    requesterMobile: '+919845011121',
    bookingId: '00000000-0000-4000-8000-0000000000b1',
    bookingCode: 'TW-3F9A21B4',
    category: 'booking',
    subject: 'Driver never arrived',
    status: 'open',
    priority: 'high',
    assignedAdminId: null,
    assignedAdminName: null,
    firstResponseAt: null,
    resolvedAt: null,
    closedAt: null,
    // Five hours old with a 4 h target — deliberately overdue, so the SLA chip
    // has something real to render.
    createdAt: at(300),
    updatedAt: at(300),
  },
  {
    id: PENDING_ID,
    reference: 'TKT-9B2E44D1',
    requesterType: 'driver',
    requesterId: '00000000-0000-4000-8000-0000000000d1',
    requesterName: 'Kiran B',
    requesterMobile: '+919845011123',
    bookingId: null,
    bookingCode: null,
    category: 'payment',
    subject: 'Payout short by ₹120',
    status: 'pending_requester',
    priority: 'normal',
    assignedAdminId: MOCK_ADMIN_ID,
    assignedAdminName: MOCK_ADMIN_NAME,
    firstResponseAt: at(1_380),
    resolvedAt: null,
    closedAt: null,
    createdAt: at(1_440),
    updatedAt: at(1_200),
  },
  {
    id: RESOLVED_ID,
    reference: 'TKT-6C3188AA',
    requesterType: 'fleet',
    requesterId: '00000000-0000-4000-8000-0000000000f1',
    requesterName: 'Lakshmi Logistics',
    requesterMobile: null,
    bookingId: null,
    bookingCode: null,
    category: 'other',
    subject: 'Add a second bank account',
    status: 'resolved',
    priority: 'low',
    assignedAdminId: MOCK_ADMIN_ID,
    assignedAdminName: MOCK_ADMIN_NAME,
    firstResponseAt: at(2_800),
    resolvedAt: at(2_700),
    closedAt: null,
    createdAt: at(2_880),
    updatedAt: at(2_700),
  },
];

let messages: Record<string, AdminSupportMessage[]> = {
  [OPEN_ID]: [
    message(
      'requester',
      'Meera Nair',
      'I waited forty minutes and nobody came.',
      'public',
      at(300),
    ),
    message(
      'admin',
      MOCK_ADMIN_NAME,
      'Internal: driver claims he could not find the address — checking the pin.',
      'internal',
      at(290),
    ),
  ],
  [PENDING_ID]: [
    message('requester', 'Kiran B', 'My payout is ₹120 short this week.', 'public', at(1_440)),
    message('admin', MOCK_ADMIN_NAME, 'Looking into the settlement now.', 'public', at(1_380)),
    message(
      'admin',
      MOCK_ADMIN_NAME,
      'Internal: split run shows a cancelled job.',
      'internal',
      at(1_300),
    ),
    message('requester', 'Kiran B', 'Any update?', 'public', at(1_220)),
  ],
  [RESOLVED_ID]: [
    message(
      'requester',
      'Lakshmi Logistics',
      'How do we add another bank account?',
      'public',
      at(2_880),
    ),
    message(
      'admin',
      MOCK_ADMIN_NAME,
      'Added — approve the mandate from the console.',
      'public',
      at(2_800),
    ),
  ],
};

let events: Record<string, AdminSupportTicketEvent[]> = {
  [OPEN_ID]: [event('created', 'requester', null, at(300), { category: 'booking' })],
  [PENDING_ID]: [
    event('created', 'requester', null, at(1_440), { category: 'payment' }),
    event('assigned', 'admin', MOCK_ADMIN_ID, at(1_390), { to: MOCK_ADMIN_ID }),
    event('message', 'admin', MOCK_ADMIN_ID, at(1_380), { visibility: 'public' }),
    event('status_changed', 'admin', MOCK_ADMIN_ID, at(1_350), { to: 'pending_requester' }),
  ],
  [RESOLVED_ID]: [
    event('created', 'requester', null, at(2_880), { category: 'other' }),
    event('status_changed', 'admin', MOCK_ADMIN_ID, at(2_700), { to: 'resolved' }),
  ],
};

function message(
  authorType: AdminSupportMessage['authorType'],
  authorName: string,
  body: string,
  visibility: AdminSupportMessage['visibility'],
  createdAt: string,
): AdminSupportMessage {
  return {
    id: crypto.randomUUID(),
    authorType,
    authorId: authorType === 'admin' ? MOCK_ADMIN_ID : null,
    authorName,
    body,
    visibility,
    attachments: [],
    createdAt,
  };
}

function event(
  kind: AdminSupportTicketEvent['kind'],
  actorType: AdminSupportTicketEvent['actorType'],
  actorId: string | null,
  createdAt: string,
  data: Record<string, unknown> | null,
): AdminSupportTicketEvent {
  return {
    id: crypto.randomUUID(),
    kind,
    actorType,
    actorId,
    actorName: actorId ? MOCK_ADMIN_NAME : null,
    data,
    createdAt,
  };
}

export function mockSupportList(query: AdminSupportTicketsQuery): AdminSupportTicketsResponse {
  const filtered = tickets
    .filter((row) => (query.open ? row.status !== 'resolved' && row.status !== 'closed' : true))
    .filter((row) => (query.status ? row.status === query.status : true))
    .filter((row) => (query.priority ? row.priority === query.priority : true))
    .filter((row) => (query.category ? row.category === query.category : true))
    .filter((row) => (query.assignedAdminId ? row.assignedAdminId === query.assignedAdminId : true))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const start = (query.page - 1) * query.limit;
  return {
    items: filtered.slice(start, start + query.limit),
    page: query.page,
    limit: query.limit,
    total: filtered.length,
  };
}

export function mockSupportDetail(ticketId: string): AdminSupportTicketDetail {
  const ticket = tickets.find((row) => row.id === ticketId) ?? tickets[0]!;
  return {
    ...ticket,
    messages: messages[ticket.id] ?? [],
    events: events[ticket.id] ?? [],
  };
}

export function mockSupportAssign(ticketId: string): void {
  update(ticketId, {
    assignedAdminId: MOCK_ADMIN_ID,
    assignedAdminName: MOCK_ADMIN_NAME,
  });
  appendEvent(ticketId, 'assigned', { to: MOCK_ADMIN_ID });
}

export function mockSupportStatus(
  ticketId: string,
  status: AdminSupportTicket['status'],
  priority?: AdminSupportTicket['priority'],
): void {
  const now = new Date().toISOString();
  const patch: Partial<AdminSupportTicket> = { status, updatedAt: now };
  if (priority) patch.priority = priority;
  patch.resolvedAt = status === 'resolved' ? now : null;
  patch.closedAt = status === 'closed' ? now : null;
  update(ticketId, patch);
  appendEvent(ticketId, 'status_changed', { to: status, priority: priority ?? null });
}

export function mockSupportReply(ticketId: string, body: string): void {
  const list = messages[ticketId] ?? [];
  list.push(message('admin', MOCK_ADMIN_NAME, body, 'public', new Date().toISOString()));
  messages = { ...messages, [ticketId]: list };
  const ticket = tickets.find((row) => row.id === ticketId);
  update(ticketId, {
    firstResponseAt: ticket?.firstResponseAt ?? new Date().toISOString(),
    status: ticket?.status === 'open' ? 'in_progress' : ticket?.status,
  });
  appendEvent(ticketId, 'message', { visibility: 'public' });
}

export function mockSupportNote(ticketId: string, body: string): void {
  const list = messages[ticketId] ?? [];
  list.push(message('admin', MOCK_ADMIN_NAME, body, 'internal', new Date().toISOString()));
  messages = { ...messages, [ticketId]: list };
  appendEvent(ticketId, 'note', { visibility: 'internal' });
}

export function mockSupportLinkBooking(ticketId: string, bookingId: string): void {
  update(ticketId, {
    bookingId,
    bookingCode: `TW-${bookingId.slice(0, 8).toUpperCase()}`,
  });
  appendEvent(ticketId, 'linked_booking', { bookingId });
}

function update(ticketId: string, patch: Partial<AdminSupportTicket>): void {
  tickets = tickets.map((row) =>
    row.id === ticketId
      ? { ...row, ...patch, updatedAt: patch.updatedAt ?? new Date().toISOString() }
      : row,
  );
}

function appendEvent(
  ticketId: string,
  kind: AdminSupportTicketEvent['kind'],
  data: Record<string, unknown>,
): void {
  const list = events[ticketId] ?? [];
  list.push(event(kind, 'admin', MOCK_ADMIN_ID, new Date().toISOString(), data));
  events = { ...events, [ticketId]: list };
}
