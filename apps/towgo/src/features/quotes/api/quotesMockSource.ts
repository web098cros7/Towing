import type { Quote, QuoteAcceptResponse, QuoteRequest, QuotesResponse } from '@towing/api-contracts';
import { env } from '@/lib/env';
import type { QuotesDataSource } from './quotesDataSource';

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * The in-app mock for §7.3's manual quotes.
 *
 * It starts with ONE quoted row, because the screen's whole point is the
 * ACCEPT — an empty list would let every layout bug through on a state nobody
 * can reach in development. Filing a request prepends a `requested` row (so
 * the >600 km flow lands on something it just created), and accepting flips
 * that row and hands back a booking id the screen navigates with.
 *
 * The booking in the accept response is built by hand rather than borrowed
 * from the bookings feature's fixtures: the screen reads `booking.id` and
 * nothing else, and importing another feature's view-shaped mock to satisfy a
 * contract-shaped type would couple two fixtures that have no reason to move
 * together.
 */

const MOCK_BOOKING_ID = '00000000-0000-4000-8000-0000000000f1';

const rows: Quote[] = [
  {
    id: '00000000-0000-4000-8000-0000000000d1',
    status: 'quoted',
    serviceSlug: 'car_tow',
    vehicleClass: 'flatbed',
    pickup: { lat: 12.9716, lng: 77.5946 },
    pickupAddress: 'MG Road, Bengaluru',
    drop: { lat: 19.076, lng: 72.8777 },
    dropAddress: 'Bandra, Mumbai',
    distanceKm: 842.1,
    notes: 'Sedan, non-runner',
    totalPaise: 8_500_000,
    quoteNote: 'Includes the return leg',
    validUntil: new Date(Date.now() + 36 * 3_600_000).toISOString(),
    quotedAt: new Date(Date.now() - 12 * 3_600_000).toISOString(),
    decidedAt: null,
    bookingId: null,
    requestedAt: new Date(Date.now() - 14 * 3_600_000).toISOString(),
  },
];

let sequence = 1;

export const quotesMockSource: QuotesDataSource = {
  async list(): Promise<QuotesResponse> {
    await delay(300);
    if (env.mockQuotesState === 'error') throw new Error('Mock quotes error');
    if (env.mockQuotesState === 'empty') return { items: [] };
    return { items: [...rows] };
  },

  async request(body: QuoteRequest): Promise<Quote> {
    await delay(500);
    const quote: Quote = {
      id: `00000000-0000-4000-8000-0000000000e${sequence++}`,
      status: 'requested',
      serviceSlug: body.serviceSlug,
      vehicleClass: body.vehicleClass ?? 'flatbed',
      pickup: body.pickup,
      pickupAddress: body.pickupAddress ?? null,
      drop: body.drop,
      dropAddress: body.dropAddress ?? null,
      // The mock's own arithmetic, only so the row shows a plausible figure —
      // the real distance comes from the routing adapter at request time.
      distanceKm: 812.4,
      notes: body.notes ?? null,
      totalPaise: null,
      quoteNote: null,
      validUntil: null,
      quotedAt: null,
      decidedAt: null,
      bookingId: null,
      requestedAt: new Date().toISOString(),
    };
    rows.unshift(quote);
    return quote;
  },

  async accept(id: string): Promise<QuoteAcceptResponse> {
    await delay(600);
    const quote = rows.find((row) => row.id === id) ?? rows[0]!;
    const accepted: Quote = {
      ...quote,
      status: 'accepted',
      decidedAt: new Date().toISOString(),
      bookingId: MOCK_BOOKING_ID,
    };
    rows[rows.indexOf(quote)] = accepted;

    return {
      quote: accepted,
      booking: {
        id: MOCK_BOOKING_ID,
        reference: 'TW-MOCKQ001',
        status: 'searching',
        // The screen reads `booking.id`; the rest is shaped for the type, not
        // for rendering (the bookings feature's own fixtures are the detail
        // mocks).
      } as unknown as QuoteAcceptResponse['booking'],
    };
  },
};
