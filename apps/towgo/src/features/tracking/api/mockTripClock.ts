/**
 * MOCK TRIP CLOCK — the one timeline a mock trip follows after a driver accepts.
 *
 * Test mode has no driver, so something has to move a matched booking through
 * the statuses the redesign draws a screen for:
 *   · `assigned`    for `MOCK_ASSIGNED_MS`     → 18 Driver En Route
 *   · `en_route`    for `MOCK_EN_ROUTE_MS`     → 19 Driver Arriving (the truck walks)
 *   · `arrived`     until the tester moves on  → 23 Driver Arrived, then 24 Collection Code
 *   · `in_progress` for `MOCK_LOADING_MS` + `MOCK_IN_TRANSIT_MS`
 *                                              → 25 Trip in Progress (loading, then the tow)
 *   · `completed`   and held there             → 27 Payment
 *   · `paid`        once a mock payment is captured
 *
 * ONE CLOCK, TWO READERS. `bookingsMockSource` (the booking's `status`, which
 * Booking Details and the active-trip card read) and `trackingMockSource` (the
 * tracking payload's `status` and instants, which the Tracking screen reads
 * first) both ask this module, so the two can never tell the customer different
 * stories — the mock version of the contract's "the poll and the socket agree"
 * rule.
 *
 * `arrived` is held until 24's code has been on screen (`recordMockCodeShown`):
 * in reality the driver starts the tow by typing the code the customer shows on
 * 24, so the mock driver "types it" `MOCK_CODE_ENTRY_MS` later. Without that
 * call 23 and 24 stay up for as long as somebody wants to inspect them, and a
 * code that disappeared mid-read would be a worse test than no code at all.
 *
 * `completed` is held for the same reason: 27 Payment is where the tester is,
 * and only a captured mock payment (`recordMockPaid`, called by
 * `paymentsMockSource.capture`) moves the trip on to `paid`.
 */

/** 18 is on screen for this long after the match. */
export const MOCK_ASSIGNED_MS = 15_000;
/** Then 19 for this long, while the truck walks the approach path. */
export const MOCK_EN_ROUTE_MS = 45_000;
/** From 24 first showing its code to the mock driver starting the tow (`arrived → in_progress`). */
export const MOCK_CODE_ENTRY_MS = 12_000;
/** 25 with the truck still on the pickup, loading the vehicle; "In transit" has no time yet. */
export const MOCK_LOADING_MS = 10_000;
/** Then 25 for this long, while the truck walks the drop leg; then `completed`. */
export const MOCK_IN_TRANSIT_MS = 60_000;

export type MockTripStatus =
  'assigned' | 'en_route' | 'arrived' | 'in_progress' | 'completed' | 'paid';

export interface MockTripPhase {
  status: MockTripStatus;
  /** Epoch ms of the match (the driver accepting). */
  matchedAt: number;
  /** Epoch ms the driver set off (`assigned → en_route`); null while still assigned. */
  enRouteAt: number | null;
  /** Epoch ms the driver reached the pickup; null before that. */
  arrivedAt: number | null;
  /** Epoch ms the tow started (`arrived → in_progress`, 25's "Picked up"); null before that. */
  startedAt: number | null;
  /** Epoch ms the loaded truck left the pickup (25's "In transit"); null before that. */
  inTransitAt: number | null;
  /** Epoch ms the truck reached the drop (`in_progress → completed`); null before that. */
  completedAt: number | null;
  /** Epoch ms the mock payment was captured (`completed → paid`); null before that. */
  paidAt: number | null;
  /** 0 → 1 along the approach while en route; 0 before, 1 after. */
  progress: number;
  /** 0 → 1 along the drop leg while in transit; 0 before, 1 after. */
  dropProgress: number;
}

/** Booking id → epoch ms at which the mock driver accepted. Session memory, like the mock bookings. */
const matchedAtById = new Map<string, number>();

/** Called by `bookingsMockSource` at the moment a mock search reads back as matched. */
export function recordMockMatch(bookingId: string, at: number = Date.now()): void {
  matchedAtById.set(bookingId, at);
}

/** Booking id → epoch ms at which 24 Collection Code was first on screen. */
const codeShownAtById = new Map<string, number>();
/** Booking id → epoch ms at which a mock payment for it was captured. */
const paidAtById = new Map<string, number>();

/**
 * Called by the Tracking screen, in test mode only, the first time 24's code
 * is on screen: the mock driver "types the code" `MOCK_CODE_ENTRY_MS` later and
 * the tow starts. Only the first call counts.
 */
export function recordMockCodeShown(bookingId: string, at: number = Date.now()): void {
  if (!codeShownAtById.has(bookingId)) codeShownAtById.set(bookingId, at);
}

/** Called by `paymentsMockSource.capture` when a mock payment for the booking is captured. */
export function recordMockPaid(bookingId: string, at: number = Date.now()): void {
  paidAtById.set(bookingId, at);
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
  const before = {
    matchedAt,
    startedAt: null,
    inTransitAt: null,
    completedAt: null,
    paidAt: null,
    dropProgress: 0,
  };

  if (now < enRouteAt) {
    return { ...before, status: 'assigned', enRouteAt: null, arrivedAt: null, progress: 0 };
  }
  if (now < arrivedAt) {
    return {
      ...before,
      status: 'en_route',
      enRouteAt,
      arrivedAt: null,
      progress: (now - enRouteAt) / MOCK_EN_ROUTE_MS,
    };
  }

  // Held at `arrived` until 24 has shown the code, and for the code entry after that.
  const codeShownAt = codeShownAtById.get(bookingId);
  const startedAt =
    codeShownAt === undefined ? null : Math.max(arrivedAt, codeShownAt + MOCK_CODE_ENTRY_MS);
  if (startedAt === null || now < startedAt) {
    return { ...before, status: 'arrived', enRouteAt, arrivedAt, progress: 1 };
  }

  const inTransitAt = startedAt + MOCK_LOADING_MS;
  const completedAt = inTransitAt + MOCK_IN_TRANSIT_MS;
  const started = { matchedAt, enRouteAt, arrivedAt, startedAt, progress: 1 };

  if (now < inTransitAt) {
    return {
      ...started,
      status: 'in_progress',
      inTransitAt: null,
      completedAt: null,
      paidAt: null,
      dropProgress: 0,
    };
  }
  if (now < completedAt) {
    return {
      ...started,
      status: 'in_progress',
      inTransitAt,
      completedAt: null,
      paidAt: null,
      dropProgress: (now - inTransitAt) / MOCK_IN_TRANSIT_MS,
    };
  }

  // Held at `completed` until a mock payment is captured.
  const paidAt = paidAtById.get(bookingId) ?? null;
  return {
    ...started,
    status: paidAt === null ? 'completed' : 'paid',
    inTransitAt,
    completedAt,
    paidAt,
    dropProgress: 1,
  };
}
