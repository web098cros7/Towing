/**
 * MOCK TRIP CLOCK — the one timeline a mock trip follows after a driver accepts.
 *
 * Test mode has no driver, so something has to move a matched booking through
 * the statuses the redesign draws a screen for:
 *   · `assigned`  for `MOCK_ASSIGNED_MS`   → 18 Driver En Route
 *   · `en_route`  for `MOCK_EN_ROUTE_MS`   → 19 Driver Arriving (the truck walks)
 *   · `arrived`   and held there            → 23 Driver Arrived, then 24 Collection Code
 *
 * ONE CLOCK, TWO READERS. `bookingsMockSource` (the booking's `status`, which
 * Booking Details and the active-trip card read) and `trackingMockSource` (the
 * tracking payload's `status`, which the Tracking screen reads first) both ask
 * this module, so the two can never tell the customer different stories — the
 * mock version of the contract's "the poll and the socket agree" rule.
 *
 * `arrived` is held rather than looped: 23 and 24 are the screens somebody
 * opens test mode to inspect, and a code that disappears mid-read would be a
 * worse test than no code at all. `in_progress` and later are not driven here;
 * they keep their existing flows until screens 25+ are rebuilt.
 */

/** 18 is on screen for this long after the match. */
export const MOCK_ASSIGNED_MS = 15_000;
/** Then 19 for this long, while the truck walks the approach path. */
export const MOCK_EN_ROUTE_MS = 45_000;

export type MockTripStatus = 'assigned' | 'en_route' | 'arrived';

export interface MockTripPhase {
  status: MockTripStatus;
  /** Epoch ms of the match (the driver accepting). */
  matchedAt: number;
  /** Epoch ms the driver set off (`assigned → en_route`); null while still assigned. */
  enRouteAt: number | null;
  /** Epoch ms the driver reached the pickup; null before that. */
  arrivedAt: number | null;
  /** 0 → 1 along the approach while en route; 0 before, 1 after. */
  progress: number;
}

/** Booking id → epoch ms at which the mock driver accepted. Session memory, like the mock bookings. */
const matchedAtById = new Map<string, number>();

/** Called by `bookingsMockSource` at the moment a mock search reads back as matched. */
export function recordMockMatch(bookingId: string, at: number = Date.now()): void {
  matchedAtById.set(bookingId, at);
}

/** Whether this session matched the booking (so its status is the clock's to drive). */
export function hasMockMatch(bookingId: string): boolean {
  return matchedAtById.has(bookingId);
}

/**
 * Where the trip is on the clock. A booking the clock has never seen (Tracking
 * opened on a booking this session did not match, e.g. after a reload) starts
 * its clock on this first read, so every screen is still reachable in order.
 */
export function mockTripPhase(bookingId: string, now: number = Date.now()): MockTripPhase {
  let matchedAt = matchedAtById.get(bookingId);
  if (matchedAt === undefined) {
    matchedAt = now;
    matchedAtById.set(bookingId, matchedAt);
  }

  const enRouteAt = matchedAt + MOCK_ASSIGNED_MS;
  const arrivedAt = enRouteAt + MOCK_EN_ROUTE_MS;

  if (now < enRouteAt) {
    return { status: 'assigned', matchedAt, enRouteAt: null, arrivedAt: null, progress: 0 };
  }
  if (now < arrivedAt) {
    return {
      status: 'en_route',
      matchedAt,
      enRouteAt,
      arrivedAt: null,
      progress: (now - enRouteAt) / MOCK_EN_ROUTE_MS,
    };
  }
  return { status: 'arrived', matchedAt, enRouteAt, arrivedAt, progress: 1 };
}
