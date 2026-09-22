import type {
  AdminSosAlert,
  AdminSosContact,
  AdminSosDetail,
  AdminSosEvent,
  AdminSosQuery,
  AdminSosBroadcastBody,
  AdminSosContactResponse,
  AdminSosResponse,
} from '@towing/api-contracts';

/**
 * W14's mocks-on SOS fixtures (M5).
 *
 * Unlike most features' fixtures, SOS mutations are LIVE IN THE MOCK: the
 * acknowledge → contact → resolve flow and the persistent banner are this
 * screen's whole point, and a spec that cannot cross the flow cannot prove the
 * banner clears. Everything stays in module state — no request, no socket — so
 * the mock console remains hermetic; the REAL backend behaviour is proven in
 * `e2e-live` and the backend suite.
 */

const MINUTE = 60_000;
const at = (minutesAgo: number): string => new Date(Date.now() - minutesAgo * MINUTE).toISOString();

const OPEN_ID = '11111111-1111-4111-8111-111111111111';
const RESOLVED_ID = '33333333-3333-4333-8333-333333333333';
const CANCELLED_ID = '44444444-4444-4444-8444-444444444444';

const MOCK_ADMIN_ID = '00000000-0000-4000-8000-000000000001';
const MOCK_ADMIN_NAME = 'Mock Admin';

/**
 * Declared BEFORE the maps below on purpose: `event()` is called at module
 * init to build them, and a `let` used before its declaration is a TDZ crash
 * ("Cannot access 'q' before initialization") that only shows up when the
 * page is PRERENDERED - i.e. in `next build`, not in `next dev`.
 */
let eventSeq = 100;

/** Two channels, both blocked exactly as the real catalog blocks them today. */
const blockedChannels = [
  { channel: 'sms' as const, ok: false, code: 'dlt_template_missing' },
  { channel: 'whatsapp' as const, ok: false, code: 'wa_template_missing' },
];

let alerts: AdminSosAlert[] = [
  {
    id: OPEN_ID,
    subjectType: 'user',
    subjectId: '00000000-0000-4000-8000-0000000000c1',
    subjectName: 'Meera Nair',
    subjectMobile: '+919845011121',
    bookingId: null,
    bookingCode: null,
    lat: 12.9716,
    lng: 77.5946,
    accuracyM: 8,
    source: 'app',
    status: 'triggered',
    acknowledgedBy: null,
    acknowledgedByName: null,
    acknowledgedAt: null,
    resolvedBy: null,
    resolvedAt: null,
    resolution: null,
    ackSeconds: null,
    createdAt: at(4),
    updatedAt: at(4),
  },
  {
    id: RESOLVED_ID,
    subjectType: 'user',
    subjectId: '00000000-0000-4000-8000-0000000000c2',
    subjectName: 'Arun Prasad',
    subjectMobile: '+919845011122',
    bookingId: '00000000-0000-4000-8000-0000000000b1',
    bookingCode: 'TW-3F9A21B4',
    lat: 12.9352,
    lng: 77.6245,
    accuracyM: null,
    source: 'ops',
    status: 'resolved',
    acknowledgedBy: MOCK_ADMIN_ID,
    acknowledgedByName: MOCK_ADMIN_NAME,
    acknowledgedAt: at(1_460),
    resolvedBy: MOCK_ADMIN_ID,
    resolvedAt: at(1_440),
    resolution: 'Reached via spouse; customer safe. No police needed.',
    ackSeconds: 42,
    createdAt: at(1_461),
    updatedAt: at(1_440),
  },
  {
    id: CANCELLED_ID,
    subjectType: 'driver',
    subjectId: '00000000-0000-4000-8000-0000000000d1',
    subjectName: 'Kiran B',
    subjectMobile: '+919845011123',
    bookingId: null,
    bookingCode: null,
    lat: 12.9611,
    lng: 77.6387,
    accuracyM: 14,
    source: 'app',
    status: 'cancelled',
    acknowledgedBy: null,
    acknowledgedByName: null,
    acknowledgedAt: null,
    resolvedBy: null,
    resolvedAt: null,
    resolution: null,
    ackSeconds: null,
    createdAt: at(2_880),
    updatedAt: at(2_879),
  },
];

const contactsByAlert = new Map<string, AdminSosContact[]>([
  [
    OPEN_ID,
    [
      {
        id: 'c0000000-0000-4000-8000-000000000001',
        name: 'Arun (spouse)',
        phone: '+919845010001',
        relation: 'spouse',
        notifiedChannels: blockedChannels,
      },
      {
        id: 'c0000000-0000-4000-8000-000000000002',
        name: 'Divya (sister)',
        phone: '+919845010002',
        relation: 'sister',
        notifiedChannels: blockedChannels,
      },
    ],
  ],
]);

const events = new Map<string, AdminSosEvent[]>([
  [
    OPEN_ID,
    [
      event('triggered', 'subject', null, null, at(4), { duplicate: false }),
      event('contacts_notified', 'system', null, null, at(4), { contacts: 2 }),
      event('ops_alerted', 'system', null, null, at(4), { mailbox: 'ops@towing.local' }),
    ],
  ],
  [
    RESOLVED_ID,
    [
      event('triggered', 'admin', MOCK_ADMIN_ID, null, at(1_461), { source: 'ops' }),
      event('contacts_notified', 'system', null, null, at(1_461), { contacts: 2 }),
      event('ops_alerted', 'system', null, null, at(1_461), { mailbox: 'ops@towing.local' }),
      event('acknowledged', 'admin', MOCK_ADMIN_ID, null, at(1_460), null),
      event('contacted', 'admin', MOCK_ADMIN_ID, null, at(1_452), { masked: false }),
      event('note', 'admin', MOCK_ADMIN_ID, 'Spouse confirmed she is with her.', at(1_448), null),
      event('resolved', 'admin', MOCK_ADMIN_ID, 'Customer safe.', at(1_440), null),
    ],
  ],
  [
    CANCELLED_ID,
    [
      event('triggered', 'subject', null, null, at(2_880), { duplicate: false }),
      event('ops_alerted', 'system', null, null, at(2_880), { mailbox: 'ops@towing.local' }),
      event('cancelled', 'subject', null, null, at(2_879), { ageSeconds: 22 }),
    ],
  ],
]);

function event(
  kind: AdminSosEvent['kind'],
  actorType: AdminSosEvent['actorType'],
  actorId: string | null,
  note: string | null,
  createdAt: string,
  data: Record<string, unknown> | null,
): AdminSosEvent {
  eventSeq += 1;
  return {
    id: `e0000000-0000-4000-8000-${String(eventSeq).padStart(12, '0')}`,
    kind,
    actorType,
    actorId,
    actorName: actorType === 'admin' ? MOCK_ADMIN_NAME : null,
    note,
    data,
    createdAt,
  };
}

function withLatency(alert: AdminSosAlert): AdminSosAlert {
  if (!alert.acknowledgedAt) return { ...alert, ackSeconds: null };
  const seconds = Math.max(
    0,
    Math.round((Date.parse(alert.acknowledgedAt) - Date.parse(alert.createdAt)) / 1_000),
  );
  return { ...alert, ackSeconds: seconds };
}

export function mockSosList(query: AdminSosQuery): AdminSosResponse {
  const filtered = alerts
    .filter((row) => {
      if (query.open) return row.status === 'triggered' || row.status === 'acknowledged';
      if (query.status) return row.status === query.status;
      return true;
    })
    .filter((row) => (query.subjectType ? row.subjectType === query.subjectType : true))
    .map(withLatency)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const start = (query.page - 1) * query.limit;
  return {
    items: filtered.slice(start, start + query.limit),
    page: query.page,
    limit: query.limit,
    total: filtered.length,
  };
}

export function mockSosDetail(alertId: string): AdminSosDetail {
  const alert = alerts.find((row) => row.id === alertId) ?? alerts[0]!;
  return {
    ...withLatency(alert),
    contacts: contactsByAlert.get(alert.id) ?? [],
    events: events.get(alert.id) ?? [],
  };
}

export function mockSosAcknowledge(alertId: string): void {
  alerts = alerts.map((row) =>
    row.id === alertId && row.status === 'triggered'
      ? {
          ...row,
          status: 'acknowledged',
          acknowledgedBy: MOCK_ADMIN_ID,
          acknowledgedByName: MOCK_ADMIN_NAME,
          acknowledgedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }
      : row,
  );
  append(alertId, 'acknowledged', MOCK_ADMIN_ID, null, null);
}

export function mockSosNote(alertId: string, note: string): void {
  append(alertId, 'note', MOCK_ADMIN_ID, note, null);
}

export function mockSosContact(alertId: string, contactId?: string): AdminSosContactResponse {
  const contacts = contactsByAlert.get(alertId) ?? [];
  const selected = contactId ? contacts.find((row) => row.id === contactId) : contacts[0];
  append(alertId, 'contacted', MOCK_ADMIN_ID, null, { contactId: selected?.id ?? null });
  // No Exotel account exists in the mock either — the direct-dial answer.
  return {
    alertId,
    dialNumber: selected?.phone ?? null,
    masked: false,
    reference: null,
  };
}

export function mockSosResolve(alertId: string, resolution: string): void {
  alerts = alerts.map((row) =>
    row.id === alertId && (row.status === 'triggered' || row.status === 'acknowledged')
      ? {
          ...row,
          status: 'resolved',
          resolvedBy: MOCK_ADMIN_ID,
          resolvedAt: new Date().toISOString(),
          resolution,
          updatedAt: new Date().toISOString(),
        }
      : row,
  );
  append(alertId, 'resolved', MOCK_ADMIN_ID, resolution, null);
}

export function mockSosBroadcast(alertId: string, body: AdminSosBroadcastBody): number {
  const radiusKm = body.radiusKm ?? 3;
  const notified = 4;
  append(alertId, 'broadcast', MOCK_ADMIN_ID, null, { drivers: notified, radiusKm });
  return notified;
}

function append(
  alertId: string,
  kind: AdminSosEvent['kind'],
  actorId: string | null,
  note: string | null,
  data: Record<string, unknown> | null,
): void {
  const list = events.get(alertId) ?? [];
  list.push(
    event(kind, actorId ? 'admin' : 'system', actorId, note, new Date().toISOString(), data),
  );
  events.set(alertId, list);
}

/** Count of incidents still open — what the banner and the badge both show. */
export function mockSosOpenCount(): number {
  return alerts.filter((row) => row.status === 'triggered' || row.status === 'acknowledged').length;
}
