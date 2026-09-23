import type {
  BookingCancelResponse,
  BookingCreate,
  BookingOtpResponse,
} from '@towing/api-contracts';
import { env } from '@/lib/env';
import {
  hasMockMatch,
  mockTripPhase,
  recordMockMatch,
  type MockTripPhase,
} from '@/features/tracking/api/mockTripClock';
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

/**
 * MOCK SEARCH TIMELINE (Figma 16 Searching for Tow, 17 No Drivers Found, 18
 * Driver En Route).
 *
 * Mock mode has no dispatch engine, but screen 16 draws a banner reading
 * "Searching within N km · N drivers contacted", screen 17 is the state a
 * search ends in when nobody accepts, and 18 follows when a driver does. So
 * every drawn state is reachable with EXPO_PUBLIC_USE_MOCKS=true:
 *   · a booking created here reports its first wave straight away, and the
 *     search then widens wave by wave (`MOCK_WAVES`), so the banner's radius
 *     and count are live values that move rather than a fixed string. The first
 *     wave is Figma 16's drawn example (5 km, 3 drivers contacted);
 *   · once `MOCK_SEARCH_SECONDS` pass with nobody accepting, it reads back as
 *     `no_drivers_found` (17);
 *   · Try Again restarts the search (16) from the first wave, and that retried
 *     search is accepted after `MOCK_MATCH_SECONDS`, reading back as `assigned`
 *     with a fixture driver, which hands off to 18;
 *   · from the match on, the shared mock trip clock (`mockTripClock.ts`) moves
 *     it `assigned` → `en_route` → `arrived` → `in_progress` → `completed`
 *     (18 → 19 → 23/24 → 25 → 27), and on to `paid` once a mock payment is
 *     captured: the same clock the tracking mock reads, so Booking Details and
 *     Tracking agree.
 */
const MOCK_SEARCH_SECONDS = 30;
const MOCK_MATCH_SECONDS = 12;

/**
 * The mock dispatch ladder: when each wave starts (seconds into the search),
 * how far it reaches, and how many drivers have been contacted so far
 * (cumulative, as the real engine reports it). Waves land between the screen's
 * 10 s polls, so each poll shows the next one.
 */
const MOCK_WAVES = [
  { startsAfterSeconds: 0, radiusKm: 5, driversContacted: 3 },
  { startsAfterSeconds: 10, radiusKm: 7, driversContacted: 6 },
  { startsAfterSeconds: 20, radiusKm: 10, driversContacted: 9 },
] as const;

/** Booking id -> epoch ms at which the mock driver accepts (retried searches only). */
const mockMatchAt = new Map<string, number>();

/** The server's code window (`BookingOtpService`): 30 minutes from the first read. */
const MOCK_OTP_WINDOW_MS = 30 * 60 * 1000;
/** Booking id -> epoch ms at which its current mock collection code lapses. */
const mockOtpExpiresAt = new Map<string, number>();

/**
 * The statuses the mock trip clock drives; anything else (cancelled, searching)
 * is left alone. `paid` is not in it: the clock hands a `completed` booking on
 * to `paid`, and a paid booking is finished, so nothing may move it back.
 */
const MOCK_TRIP_STATUSES: ReadonlySet<BookingDetail['status']> = new Set<BookingDetail['status']>([
  'assigned',
  'en_route',
  'arrived',
  'in_progress',
  'completed',
]);

/**
 * The service a created mock booking reports. `BookingStore` holds progress
 * phases only (quote, vehicle class), not a `services.slug`, so a booking made
 * through the flow would otherwise reach `serviceTitle` with a null slug and
 * keep the placeholder — correct, but it would make 33's own flow untestable
 * end to end. The flow's entry point is Home's "Book a Tow", so the booking is
 * a tow. A real backend sends the slug on create; this does not touch a row
 * that already carries one.
 */
const MOCK_CREATED_SERVICE_SLUG = 'car_tow';

/** The wave a mock search is on, `elapsedSeconds` after it started. */
function mockWaveAt(
  elapsedSeconds: number,
): Omit<NonNullable<BookingDetail['search']>, 'deadlineAt'> {
  let index = 0;
  MOCK_WAVES.forEach((wave, i) => {
    if (elapsedSeconds >= wave.startsAfterSeconds) index = i;
  });
  const wave = MOCK_WAVES[index] ?? MOCK_WAVES[0];
  return {
    wave: index + 1,
    radiusKm: wave.radiusKm,
    driversContacted: wave.driversContacted,
  };
}

function freshMockSearch(): NonNullable<BookingDetail['search']> {
  return {
    ...mockWaveAt(0),
    deadlineAt: new Date(Date.now() + MOCK_SEARCH_SECONDS * 1000).toISOString(),
  };
}

/** A slug-less booking is read as a tow, so 33 can name and draw it (see above). */
function withMockedService<T extends { serviceSlug: string }>(booking: T): T {
  if (!booking.serviceSlug) booking.serviceSlug = MOCK_CREATED_SERVICE_SLUG;
  return booking;
}

/** An epoch-ms instant as an ISO string; `null` stays `null`. */
function iso(ms: number | null): string | null {
  return ms === null ? null : new Date(ms).toISOString();
}

/**
 * The six trip instants for a live mock booking, taken from the shared mock
 * trip clock's phase times. Anything the clock has not reached yet is null.
 */
function instantsFromPhase(
  phase: MockTripPhase,
): Pick<
  BookingDetail,
  'assignedAt' | 'enRouteAt' | 'arrivedAt' | 'startedAt' | 'completedAt' | 'paidAt'
> {
  return {
    assignedAt: iso(phase.matchedAt),
    enRouteAt: iso(phase.enRouteAt),
    arrivedAt: iso(phase.arrivedAt),
    startedAt: iso(phase.startedAt),
    completedAt: iso(phase.completedAt),
    paidAt: iso(phase.paidAt),
  };
}

/**
 * Moves a mock search on: accepted once its match time passes, ended as
 * `no_drivers_found` once its deadline passes, otherwise advanced to the wave
 * its elapsed time has reached. A scheduled trip waits for its slot.
 *
 * `search` is always REPLACED, never edited in place: `getBooking` hands out a
 * shallow copy, so the nested object is shared with React Query's cache.
 */
function settleMockSearch(booking: BookingDetail): BookingDetail {
  // A matched trip follows the mock trip clock. Only forward from the clock's
  // own statuses, so a cancel (or a retried search) is never overwritten.
  if (hasMockMatch(booking.id) && MOCK_TRIP_STATUSES.has(booking.status)) {
    const phase = mockTripPhase(booking.id);
    booking.status = phase.status;
    Object.assign(booking, instantsFromPhase(phase));
    return booking;
  }

  if (booking.status !== 'searching' || !booking.search?.deadlineAt) return booking;
  if (booking.scheduledAt && new Date(booking.scheduledAt).getTime() > Date.now()) return booking;

  const matchAt = mockMatchAt.get(booking.id);
  if (matchAt !== undefined && matchAt <= Date.now()) {
    mockMatchAt.delete(booking.id);
    // The clock starts when the match is first read back, so 18 gets its full turn.
    recordMockMatch(booking.id);
    const driver = bookingDetailsMock[0];
    booking.status = 'assigned';
    // The server's `isOtpAvailable`: readable from `assigned` on, so 24 can fetch it.
    booking.otpAvailable = true;
    booking.search = null;
    booking.vehiclePlate = driver?.vehiclePlate ?? null;
    booking.driverName = driver?.driverName ?? null;
    booking.driverRating = driver?.driverRating ?? null;
    booking.driverTrips = driver?.driverTrips ?? null;
    Object.assign(booking, instantsFromPhase(mockTripPhase(booking.id)));
    return booking;
  }

  const deadline = new Date(booking.search.deadlineAt).getTime();
  if (deadline > Date.now()) {
    const elapsedSeconds = (Date.now() - (deadline - MOCK_SEARCH_SECONDS * 1000)) / 1000;
    const next = mockWaveAt(elapsedSeconds);
    if (next.wave !== booking.search.wave) {
      booking.search = { ...next, deadlineAt: booking.search.deadlineAt };
    }
    return booking;
  }
  booking.status = 'no_drivers_found';
  booking.search = null;
  return booking;
}

/** Ids of the bookings this session owns, so a fixture it took over is not listed twice. */
function ownIds(): Set<string> {
  return new Set(created.map((b) => b.id));
}

export const bookingsMockSource: BookingsDataSource = {
  async getBookings(cursor?: string): Promise<BookingsPage> {
    await delay(700);
    if (env.mockBookingsState === 'error') throw new Error('Failed to load bookings');
    if (env.mockBookingsState === 'empty') return { items: [], nextCursor: null };
    created.forEach(settleMockSearch);
    // One page: four fixtures plus anything booked this session. Cursor
    // pagination is exercised against the real API, not against a fixed array.
    const own = ownIds();
    return {
      items: cursor
        ? []
        : [...created, ...bookingsMock.filter((b) => !own.has(b.id))]
            // 33's card names the service, so a session booking without a slug gets one.
            .map(withMockedService),
      nextCursor: null,
    };
  },

  async getBooking(bookingId: string): Promise<BookingDetail | null> {
    // A drill-down should feel snappier than a cold list.
    await delay(450);
    if (env.mockBookingsState === 'error') throw new Error('Failed to load booking');
    if (env.mockBookingsState === 'empty') return null;
    const own = created.find((b) => b.id === bookingId);
    // A copy, so React Query sees a new object when the mock search moves on.
    if (own) return withMockedService({ ...settleMockSearch(own) });
    return bookingDetailsMock.find((b) => b.id === bookingId) ?? null;
  },

  async createBooking(input: BookingCreate): Promise<BookingDetail> {
    await delay(900);
    if (env.mockBookingsState === 'error') throw new Error('Failed to create booking');

    const id = `mock-${Date.now()}`;
    const booking: BookingDetail = {
      id,
      reference: `TW-${id.slice(-8).toUpperCase()}`,
      serviceSlug: input.serviceSlug,
      originLabel: input.pickupAddress,
      destinationLabel: input.dropAddress ?? '—',
      pickupPoint: input.pickup,
      dropPoint: input.drop ?? null,
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
       * The first wave, so screen 16's banner has a radius and a count in mock
       * mode. See `MOCK_SEARCH_SECONDS` for how the mock search ends.
       */
      search: freshMockSearch(),
      paymentMethod: null,
      driverPhoto: null,
      driverTrips: null,
      durationMinutes: null,
      paidAt: null,
      assignedAt: null,
      enRouteAt: null,
      arrivedAt: null,
      startedAt: null,
      completedAt: null,
    };

    created.unshift(booking);
    return { ...booking };
  },

  async cancelBooking(bookingId: string, reason?: string): Promise<BookingCancelResponse> {
    await delay(400);
    const booking = created.find((b) => b.id === bookingId);
    if (booking) {
      booking.status = 'cancelled';
      booking.search = null;
      // What the server stores as `cancellation_reason`: 21's chip label, verbatim.
      booking.cancellationReason = reason ?? null;
    }
    mockMatchAt.delete(bookingId);
    // The FREE tier, so no fee and nothing to compensate a driver with.
    return {
      id: bookingId,
      status: 'cancelled',
      tier: 'free',
      feePaise: 0,
      driverCompensationPaise: 0,
    };
  },

  /**
   * Figma 24's example code (4 8 2 7 1 9). Like the server, the first read opens
   * a 30-minute window and re-reads inside it return the same `expiresAt`; a
   * read after it opens the next window.
   */
  async getOtp(bookingId: string): Promise<BookingOtpResponse> {
    await delay(300);
    const now = Date.now();
    let expiresAt = mockOtpExpiresAt.get(bookingId);
    if (expiresAt === undefined || expiresAt <= now) {
      expiresAt = now + MOCK_OTP_WINDOW_MS;
      mockOtpExpiresAt.set(bookingId, expiresAt);
    }
    return { code: '482719', expiresAt: new Date(expiresAt).toISOString(), locked: false };
  },

  /** L17's renewal: a fresh window on a different code, never locked. */
  async renewOtp(bookingId: string): Promise<BookingOtpResponse> {
    await delay(300);
    const expiresAt = Date.now() + MOCK_OTP_WINDOW_MS;
    mockOtpExpiresAt.set(bookingId, expiresAt);
    return { code: '615203', expiresAt: new Date(expiresAt).toISOString(), locked: false };
  },

  /**
   * §9.1.6's retry. Puts the mock booking back into `searching` and restarts the
   * mock search timeline (first wave now), mirroring what the server does. The
   * retried search is accepted after `MOCK_MATCH_SECONDS`, so 18 is reachable.
   *
   * A fixture booking is taken over by this session first (copied into
   * `created`, without the driver it had), so the retry it answers is the state
   * every later read returns, not a one-off response that snaps back.
   */
  async retrySearch(bookingId: string): Promise<BookingDetail> {
    await delay(400);
    if (env.mockBookingsState === 'error') throw new Error('Failed to retry search');

    let own = created.find((b) => b.id === bookingId);
    if (!own) {
      const fixture =
        env.mockBookingsState === 'empty'
          ? undefined
          : bookingDetailsMock.find((b) => b.id === bookingId);
      if (!fixture) throw new Error('Booking not found');
      own = {
        ...fixture,
        vehiclePlate: null,
        driverName: null,
        driverRating: null,
        driverTrips: null,
        driverPhoto: null,
        durationMinutes: null,
        otpAvailable: false,
        paidAt: null,
        assignedAt: null,
        enRouteAt: null,
        arrivedAt: null,
        startedAt: null,
        completedAt: null,
      };
      created.unshift(own);
    }

    own.status = 'searching';
    own.search = freshMockSearch();
    mockMatchAt.set(own.id, Date.now() + MOCK_MATCH_SECONDS * 1000);
    return { ...own };
  },
};
