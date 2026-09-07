import type { BookingCancelResponse, BookingCreate, BookingOtpResponse } from '@towing/api-contracts';
import { env } from '@/lib/env';
import type { BookingDetail } from '../types';
import { bookingDetailsMock, bookingsMock } from '../mocks/bookings.mock';
import type { BookingsDataSource, BookingsPage } from './bookingsDataSource';

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Mock bookings with realistic latency. `EXPO_PUBLIC_MOCK_BOOKINGS_STATE`
 * forces empty/error so the §10.9 states can be exercised without a backend.
 * For `getBooking`, 'empty' doubles as not-found (there is no separate key).
 *
 * Created bookings live in this module for the session, so the mocks-on flow
 * runs end to end: confirm → a real id → the searching screen polls it → the
 * active-trip card finds it. A mock that returned a booking it then could not
 * find would make every screen after confirm untestable.
 */
const created: BookingDetail[] = [];

export const bookingsMockSource: BookingsDataSource = {
  async getBookings(cursor?: string): Promise<BookingsPage> {
    await delay(700);
    if (env.mockBookingsState === 'error') throw new Error('Failed to load bookings');
    if (env.mockBookingsState === 'empty') return { items: [], nextCursor: null };
    // One page: four fixtures plus anything booked this session. Cursor
    // pagination is exercised against the real API, not against a fixed array.
    return { items: cursor ? [] : [...created, ...bookingsMock], nextCursor: null };
  },

  async getBooking(bookingId: string): Promise<BookingDetail | null> {
    // A drill-down should feel snappier than a cold list.
    await delay(450);
    if (env.mockBookingsState === 'error') throw new Error('Failed to load booking');
    if (env.mockBookingsState === 'empty') return null;
    return (
      created.find((b) => b.id === bookingId) ??
      bookingDetailsMock.find((b) => b.id === bookingId) ??
      null
    );
  },

  async createBooking(input: BookingCreate): Promise<BookingDetail> {
    await delay(900);
    if (env.mockBookingsState === 'error') throw new Error('Failed to create booking');

    const id = `mock-${Date.now()}`;
    const booking: BookingDetail = {
      id,
      reference: `TW-${id.slice(-8).toUpperCase()}`,
      originLabel: input.pickupAddress,
      destinationLabel: input.dropAddress ?? '—',
      createdAt: new Date().toISOString(),
      scheduledAt: input.scheduledAt ?? null,
      // The honest end state of Phase 15: nothing can move it onward until
      // dispatch exists.
      status: 'searching',
      farePaise: 125_000,
      routeTone: 'info',
      truckImage: null,
      vehiclePlate: null,
      driverName: null,
      driverRating: null,
      distanceKm: 8.6,
      breakdown: {
        basePaise: 125_000,
        nightPaise: 0,
        highwayPaise: 0,
        accidentPaise: 0,
        surgePaise: 0,
        discountPaise: 0,
        totalPaise: 125_000,
      },
      note: input.note ?? null,
      contactName: input.contact?.name ?? null,
      contactMobile: input.contact?.mobile ?? null,
      cancellationReason: null,
      cancellationFeePaise: 0,
      otpAvailable: false,
      /**
       * `null`, and it stays null in mock mode.
       *
       * A freshly-confirmed booking has not been through a wave yet, and mock
       * mode has no dispatch engine to run one — so the searching screen shows
       * the radar with no wave count, which is the honest picture of a system
       * whose matcher lives on the server. Inventing a wave here would be the
       * `useSearchSimulation` mistake all over again.
       */
      search: null,
      paymentMethod: null,
      driverPhoto: null,
      driverTrips: null,
      durationMinutes: null,
    };

    created.unshift(booking);
    return booking;
  },

  async cancelBooking(bookingId: string): Promise<BookingCancelResponse> {
    await delay(400);
    const booking = created.find((b) => b.id === bookingId);
    if (booking) booking.status = 'cancelled';
    // The FREE tier, so no fee and nothing to compensate a driver with.
    return { id: bookingId, status: 'cancelled', tier: 'free', feePaise: 0, driverCompensationPaise: 0 };
  },

  async getOtp(): Promise<BookingOtpResponse> {
    await delay(300);
    return {
      code: '482913',
      expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    };
  },

  /**
   * §9.1.6's retry. Puts the mock booking back into `searching` with wave state
   * cleared, mirroring what the server does.
   *
   * ⚠ NOTHING MATCHES IT AFTERWARDS. Mock mode has no dispatch engine, so the
   * retried booking searches forever — which is the honest mock of a system
   * whose matcher lives on the server, and is exactly what mock mode showed
   * before this phase too.
   */
  async retrySearch(bookingId: string): Promise<BookingDetail> {
    await delay(400);
    const detail = await this.getBooking(bookingId);
    if (!detail) throw new Error('Booking not found');
    return { ...detail, status: 'searching', search: null };
  },
};
