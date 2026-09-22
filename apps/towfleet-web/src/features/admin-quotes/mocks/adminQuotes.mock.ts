import type {
  AdminQuote,
  AdminQuoteDecision,
  AdminQuotesQuery,
  AdminQuotesResponse,
} from '@towing/api-contracts';

/**
 * W20's mock. Deterministic, shaped exactly like the API.
 *
 * Three rows cover the three states the screen has to render: a fresh request
 * (distance + notes, no price), a live offer (amounts + validity), and an
 * accepted one (linked to a booking, so the drawer can show where it went).
 */

const QUOTES: AdminQuote[] = [
  {
    id: '00000000-0000-4000-8000-0000000000e1',
    status: 'requested',
    serviceSlug: 'car_tow',
    vehicleClass: 'flatbed',
    pickup: { lat: 12.9716, lng: 77.5946 },
    pickupAddress: 'MG Road, Bengaluru',
    drop: { lat: 19.076, lng: 72.8777 },
    dropAddress: 'Bandra, Mumbai',
    distanceKm: 842.1,
    notes: 'Sedan, non-runner, underground parking',
    totalPaise: null,
    quoteNote: null,
    validUntil: null,
    quotedAt: null,
    decidedAt: null,
    bookingId: null,
    requestedAt: '2026-08-19T05:10:00.000Z',
    userLabel: 'Ravi Kumar',
    quotedBy: null,
    rejectionReason: null,
  },
  {
    id: '00000000-0000-4000-8000-0000000000e2',
    status: 'quoted',
    serviceSlug: 'car_tow',
    vehicleClass: 'flatbed',
    pickup: { lat: 12.9716, lng: 77.5946 },
    pickupAddress: 'Koramangala, Bengaluru',
    drop: { lat: 15.2993, lng: 74.124 },
    dropAddress: 'Panaji, Goa',
    distanceKm: 612.4,
    notes: 'SUV, running, needs a flatbed',
    totalPaise: 7_450_000,
    quoteNote: 'Includes the ghat route tolls',
    validUntil: '2026-08-21T05:00:00.000Z',
    quotedAt: '2026-08-18T09:00:00.000Z',
    decidedAt: null,
    bookingId: null,
    requestedAt: '2026-08-18T07:30:00.000Z',
    userLabel: 'Meera Iyer',
    quotedBy: '00000000-0000-4000-8000-000000000001',
    rejectionReason: null,
  },
  {
    id: '00000000-0000-4000-8000-0000000000e3',
    status: 'accepted',
    serviceSlug: 'accident_recovery',
    vehicleClass: 'flatbed',
    pickup: { lat: 12.9716, lng: 77.5946 },
    pickupAddress: 'NH-44, Nelamangala',
    drop: { lat: 12.9141, lng: 74.856 },
    dropAddress: 'Mangaluru yard',
    distanceKm: 356.2,
    notes: 'Recovery after a collision, police report filed',
    totalPaise: 9_100_000,
    quoteNote: 'Recovery crane required',
    validUntil: '2026-08-16T10:00:00.000Z',
    quotedAt: '2026-08-15T10:00:00.000Z',
    decidedAt: '2026-08-15T12:10:00.000Z',
    bookingId: '00000000-0000-4000-8000-0000000000f9',
    requestedAt: '2026-08-15T06:00:00.000Z',
    userLabel: null,
    quotedBy: '00000000-0000-4000-8000-000000000001',
    rejectionReason: null,
  },
];

/** Session transitions (see W19's privacy mock for the same reasoning). */
const OVERRIDES = new Map<string, Partial<AdminQuote>>();

function withOverrides(quote: AdminQuote): AdminQuote {
  return { ...quote, ...(OVERRIDES.get(quote.id) ?? {}) };
}

export function mockAdminQuotes(query: Partial<AdminQuotesQuery>): AdminQuotesResponse {
  const filtered = QUOTES.map(withOverrides).filter(
    (row) => !query.status || row.status === query.status,
  );
  const page = query.page ?? 1;
  const limit = query.limit ?? 25;
  return {
    items: filtered.slice((page - 1) * limit, page * limit),
    page,
    limit,
    total: filtered.length,
  };
}

export function mockAdminQuote(id: string): AdminQuote {
  const base = QUOTES.find((row) => row.id === id) ?? QUOTES[0]!;
  return withOverrides(base);
}

export function rememberQuoteTransition(id: string, overrides: Partial<AdminQuote>): AdminQuote {
  OVERRIDES.set(id, { ...(OVERRIDES.get(id) ?? {}), ...overrides });
  return mockAdminQuote(id);
}

/**
 * Prices a request the way the backend does: the total is the operator's, and
 * the commission comes off the rate card (10 % in the mock's launch data).
 */
export function mockQuoteDecision(id: string, body: AdminQuoteDecision): AdminQuote {
  const now = new Date();
  const validHours = body.validHours ?? 48;
  return rememberQuoteTransition(id, {
    status: 'quoted',
    totalPaise: body.totalPaise,
    quoteNote: body.note ?? null,
    validUntil: new Date(now.getTime() + validHours * 3_600_000).toISOString(),
    quotedAt: now.toISOString(),
    quotedBy: '00000000-0000-4000-8000-000000000001',
    rejectionReason: null,
  });
}
