import { Image } from 'react-native';
import {
  encodePolyline,
  type BookingShareResponse,
  type BookingTracking,
  type CallContact,
  type CancellationQuote,
} from '@towing/api-contracts';
import { env } from '@/lib/env';
import type {
  BookingTrackingDisplay,
  TrackedDriverDisplay,
} from '@/screens/booking/tracking/trackingDisplay';
import { mockTripPhase } from './mockTripClock';
import type { TrackingDataSource } from './trackingDataSource';

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Mock-mode tracking.
 *
 * IT MOVES, and that is the whole reason this file is more than a fixture. The
 * screen it feeds is a live map: a driver marker that never changes position
 * cannot exercise §11.4's interpolation, §11.6's staleness thresholds, the
 * bearing rotation or the pan-pause. A static mock would make every one of those
 * unreachable without a device and a real driver.
 *
 * So the trip follows the shared mock trip clock (`mockTripClock.ts`, the same
 * one `bookingsMockSource` reads for the booking's status):
 *   · `assigned` — the truck waits at the start of the approach (18);
 *   · `en_route` — it walks the approach to the pickup, placed by the clock
 *     rather than by the read count, so the walk takes the same time whatever
 *     the poll cadence (19);
 *   · `arrived`  — it stands on the pickup, and stays there (23 and 24).
 *
 * `EXPO_PUBLIC_MOCK_TRACKING_STATE` forces the §11.6 honesty states, which are
 * otherwise unreachable in mock mode because a mock never goes stale:
 *   · `stale`   — a fix 20 s old: ghost marker + "reconnecting…"
 *   · `offline` — a fix 90 s old: the support banner
 *   · `error`   — the request itself fails
 */

const PICKUP = { lat: 12.9716, lng: 77.5946 };
const DROP = { lat: 12.9345, lng: 77.6266 };

/**
 * A short approach from the north-west, ending at the pickup: Figma 18 draws the
 * truck up and to the left of the destination pin.
 */
const APPROACH = [
  { lat: 12.98, lng: 77.5872 },
  { lat: 12.9788, lng: 77.5886 },
  { lat: 12.9776, lng: 77.5898 },
  { lat: 12.9765, lng: 77.5912 },
  { lat: 12.9748, lng: 77.5925 },
  { lat: 12.973, lng: 77.5938 },
  PICKUP,
];

/**
 * Figma 18's example driver ("Rakesh Kumar", "4.8 (500+ trips)", "KA 01 AB 1234",
 * "Tata 407 (Flatbed)", IMG-01 photo). `vehicleMake` / `vehicleModel` are the
 * app-local extension in `TrackedDriverDisplay` (the contract has no make or
 * model yet); "(Flatbed)" comes from the contract's own `vehicleClass`.
 * The photo is a bundled asset resolved to a URI, so it travels through the
 * contract's `photoUrl` exactly like a server URL would.
 */
const MOCK_DRIVER: TrackedDriverDisplay = {
  name: 'Rakesh Kumar',
  photoUrl: Image.resolveAssetSource(
    require('@/screens/booking/tracking/assets/mock-driver-photo.png'),
  ).uri,
  rating: 4.8,
  totalTrips: 512,
  vehiclePlate: 'KA 01 AB 1234',
  vehicleClass: 'flatbed',
  vehicleMake: 'Tata',
  vehicleModel: '407',
};

/** The approach's legs (7 points, 6 legs); the pickup is the last point. */
const LEGS = APPROACH.length - 1;

/** Figma 18's "Arriving in 5 mins", and 19's "10:12 AM" → "Est. 10:17 AM": five clock minutes out. */
const DRAWN_ETA_SECONDS = 5 * 60;

/**
 * A road-shaped route from the truck to the pickup. Each leg turns a corner
 * (north-south, then east-west) the way a street grid does, so the design's
 * solid route line has something to draw in mock mode. `from` is the truck,
 * which may be part-way along the leg to `APPROACH[nextIndex]`.
 */
function mockRoute(from: { lat: number; lng: number }, nextIndex: number): string {
  const points = [from, ...APPROACH.slice(nextIndex)];
  const out: { lat: number; lng: number }[] = [];
  points.forEach((point, i) => {
    const previous = points[i - 1];
    if (previous) out.push({ lat: point.lat, lng: previous.lng });
    out.push(point);
  });
  return encodePolyline(out);
}

let shared: BookingShareResponse | null = null;

/** Bearing from one point to the next, so the marker turns the way it is going. */
function bearing(from: { lat: number; lng: number }, to: { lat: number; lng: number }): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const y = Math.sin(toRad(to.lng - from.lng)) * Math.cos(toRad(to.lat));
  const x =
    Math.cos(toRad(from.lat)) * Math.sin(toRad(to.lat)) -
    Math.sin(toRad(from.lat)) * Math.cos(toRad(to.lat)) * Math.cos(toRad(to.lng - from.lng));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/**
 * Where the truck is `progress` (0 → 1) of the way along the approach: the
 * point itself, the approach index it is heading for, and its bearing.
 */
function alongApproach(progress: number): {
  here: { lat: number; lng: number };
  nextIndex: number;
  headingDeg: number;
} {
  const scaled = Math.min(Math.max(progress, 0), 1) * LEGS;
  const leg = Math.min(LEGS - 1, Math.floor(scaled));
  const t = scaled - leg;
  const from = APPROACH[leg]!;
  const to = APPROACH[leg + 1]!;
  return {
    here: { lat: from.lat + (to.lat - from.lat) * t, lng: from.lng + (to.lng - from.lng) * t },
    nextIndex: leg + 1,
    headingDeg: bearing(from, to),
  };
}

/** Ages the fix so the §11.6 states can be forced without waiting for one. */
function fixAge(): number {
  if (env.mockTrackingState === 'stale') return 20_000;
  if (env.mockTrackingState === 'offline') return 90_000;
  return 1_000;
}

export const trackingMockSource: TrackingDataSource = {
  async getTracking(bookingId: string): Promise<BookingTracking> {
    await delay(300);
    if (env.mockTrackingState === 'error') throw new Error('Failed to load tracking');

    const now = Date.now();
    const phase = mockTripPhase(bookingId, now);
    const arrived = phase.status === 'arrived';
    const { here, nextIndex, headingDeg } = alongApproach(phase.progress);

    /**
     * Assigned: the drawn five minutes. En route: a fixed arrival instant five
     * minutes after the driver set off, so 19's "Est." clock holds still the way
     * a real estimate does while the truck keeps to it. Arrived: none left.
     *
     * The arrival is five minutes after the WHOLE MINUTE the driver set off in,
     * because 19 draws both as clock minutes: set off at 10:12:40, a plain
     * +5 minutes is 10:17:40, which rounds to "Est. 10:18 AM" beside "10:12 AM".
     */
    const arrivalAt =
      phase.enRouteAt === null
        ? null
        : Math.floor(phase.enRouteAt / 60_000) * 60_000 + DRAWN_ETA_SECONDS * 1000;
    const etaSeconds = arrived
      ? 0
      : arrivalAt === null
        ? DRAWN_ETA_SECONDS
        : Math.max(60, Math.round((arrivalAt - now) / 1000));

    const tracking: BookingTrackingDisplay = {
      bookingId,
      status: phase.status,
      driver: MOCK_DRIVER,
      position: {
        lat: here.lat,
        lng: here.lng,
        headingDeg,
        speedKph: phase.status === 'en_route' ? 28 : 0,
        lowAccuracy: false,
        at: new Date(now - fixAge()).toISOString(),
      },
      etaSeconds,
      // The mock route follows a street grid (see `mockRoute`), so it is labelled
      // as a routed source and drawn as the design's solid line.
      etaSource: 'google_directions',
      routePolyline: arrived ? null : mockRoute(here, nextIndex),
      routeDropPolyline: null,
      pickup: PICKUP,
      drop: DROP,
      assignedAt: new Date(phase.matchedAt).toISOString(),
      arrivedAt: phase.arrivedAt === null ? null : new Date(phase.arrivedAt).toISOString(),
      startedAt: null,
      completedAt: null,
      shared: shared !== null,
      at: new Date(now).toISOString(),
      // App-local: the contract has no en-route instant yet (19's "Driver on the way" time).
      enRouteAt: phase.enRouteAt === null ? null : new Date(phase.enRouteAt).toISOString(),
    };
    return tracking;
  },

  async share(bookingId: string): Promise<BookingShareResponse> {
    await delay(400);
    // Idempotent, like the real route: a second tap must not kill the link the
    // first one produced.
    shared ??= {
      token: 'mockshare0000000000000',
      url: `https://towing.app/t/mockshare0000000000000?b=${bookingId.slice(0, 6)}`,
      expiresAt: null,
    };
    return shared;
  },

  async revokeShare(): Promise<void> {
    await delay(250);
    shared = null;
  },

  async cancellationQuote(): Promise<CancellationQuote> {
    await delay(250);
    // The FREE tier, the one 21 draws ("No fee"), and the same tier the mock
    // cancel itself answers with (`bookingsMockSource.cancelBooking`), so the
    // quote never names a fee the cancel then does not take. The app has no
    // fee payment step: a chargeable quote only changes the badge to the amount.
    return {
      tier: 'free',
      feePaise: 0,
      reason: 'Free within 2 minutes of booking',
      chargeable: true,
      driverCompensationPaise: 0,
    };
  },

  async contact(): Promise<CallContact> {
    await delay(200);
    return {
      // `masked: false` on purpose — it is the live behaviour until a
      // masked-calling provider exists (SETUP-CHECKLIST item 13), and it is the
      // branch that shows the privacy warning. Mocking the masked path would
      // hide the one thing worth seeing here.
      dialNumber: '+919876500000',
      masked: false,
      party: 'driver',
      displayName: MOCK_DRIVER.name,
      reference: null,
    };
  },
};
