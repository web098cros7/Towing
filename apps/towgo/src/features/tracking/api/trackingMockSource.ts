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
import { mockTripPhase, type MockTripPhase } from './mockTripClock';
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
 *   · `assigned`    — the truck waits at the start of the approach (18);
 *   · `en_route`    — it walks the approach to the pickup, placed by the clock
 *     rather than by the read count, so the walk takes the same time whatever
 *     the poll cadence (19);
 *   · `arrived`     — it stands on the pickup until 24 has shown the code
 *     (23 and 24);
 *   · `in_progress` — it stands on the pickup while the vehicle is loaded, then
 *     walks the drop leg to the drop (25);
 *   · `completed`, `paid` — it stands on the drop (27 onwards).
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
 * The drop leg, from the pickup south-east to the drop: Figma 25 draws its
 * callout up and to the left, so the camera puts the truck up and to the left
 * of the drop pin, as 18 does with the pickup's.
 */
const DROP_PATH = [
  PICKUP,
  { lat: 12.969, lng: 77.599 },
  { lat: 12.9655, lng: 77.604 },
  { lat: 12.961, lng: 77.6085 },
  { lat: 12.954, lng: 77.614 },
  { lat: 12.946, lng: 77.62 },
  { lat: 12.9395, lng: 77.624 },
  DROP,
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

/** Figma 18's "Arriving in 5 mins", and 19's "10:12 AM" → "Est. 10:17 AM": five clock minutes out. */
const DRAWN_ETA_SECONDS = 5 * 60;

/** Figma 25's "10:35 AM" → "Estimated arrival in 15 mins" → "Est. 10:50 AM": fifteen clock minutes out. */
const DRAWN_DROP_ETA_SECONDS = 15 * 60;

/**
 * How far past the drawn minute the drop-leg arrival is anchored. The minute
 * count (`useEtaMinutes`) ROUNDS the seconds left, so an arrival on the whole
 * minute (10:50:00) already reads "14 mins" in the second half of 10:35, beside
 * "Est. 10:50 AM". At 10:50:29 the count stays "15 mins" through all of 10:35,
 * and "Est." (rounded to the nearest minute) still names 10:50 AM.
 */
const DROP_ARRIVAL_SLACK_SECONDS = 29;

/**
 * A road-shaped route from the truck to the end of `path` (the pickup on the
 * approach, the drop on the drop leg). Each leg turns a corner (north-south,
 * then east-west) the way a street grid does, so the design's solid route line
 * has something to draw in mock mode. `from` is the truck, which may be
 * part-way along the leg to `path[nextIndex]`.
 */
function mockRoute(
  path: readonly { lat: number; lng: number }[],
  from: { lat: number; lng: number },
  nextIndex: number,
): string {
  const points = [from, ...path.slice(nextIndex)];
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
 * Where the truck is `progress` (0 → 1) of the way along `path` (the approach,
 * or the drop leg): the point itself, the path index it is heading for, and its
 * bearing. Every leg takes the same time.
 */
function alongPath(
  path: readonly { lat: number; lng: number }[],
  progress: number,
): {
  here: { lat: number; lng: number };
  nextIndex: number;
  headingDeg: number;
} {
  const legs = path.length - 1;
  const scaled = Math.min(Math.max(progress, 0), 1) * legs;
  const leg = Math.min(legs - 1, Math.floor(scaled));
  const t = scaled - leg;
  const from = path[leg]!;
  const to = path[leg + 1]!;
  return {
    here: { lat: from.lat + (to.lat - from.lat) * t, lng: from.lng + (to.lng - from.lng) * t },
    nextIndex: leg + 1,
    headingDeg: bearing(from, to),
  };
}

/** An epoch-ms instant as the contract's ISO string; `null` stays `null`. */
function iso(ms: number | null): string | null {
  return ms === null ? null : new Date(ms).toISOString();
}

/**
 * A fixed arrival instant `drawnSeconds` after the WHOLE MINUTE a leg began in,
 * as seconds from `now` (at least one minute). The designs draw both the start
 * and the estimate as clock minutes: set off at 10:12:40, a plain +5 minutes is
 * 10:17:40, which rounds to "Est. 10:18 AM" beside "10:12 AM".
 */
function secondsToDrawnArrival(legStartedAt: number, drawnSeconds: number, now: number): number {
  const arrivalAt = Math.floor(legStartedAt / 60_000) * 60_000 + drawnSeconds * 1000;
  return Math.max(60, Math.round((arrivalAt - now) / 1000));
}

/**
 * The ETA of the active leg, as the server's `etaSeconds` describes it:
 * - assigned: the drawn five minutes;
 * - en route: to a fixed arrival five minutes after the driver set off, so 19's
 *   "Est." clock holds still the way a real estimate does while the truck keeps
 *   to it;
 * - arrived: none left;
 * - in progress: the drop leg. The drawn fifteen minutes while the vehicle is
 *   loaded, then to a fixed arrival fifteen minutes (and 29 s,
 *   `DROP_ARRIVAL_SLACK_SECONDS`) after the whole minute the truck left the
 *   pickup in, so 25 reads "10:35 AM", "15 mins", "Est. 10:50 AM" for all of
 *   that minute;
 * - completed, paid: none left.
 */
function mockEtaSeconds(phase: MockTripPhase, now: number): number {
  switch (phase.status) {
    case 'assigned':
      return DRAWN_ETA_SECONDS;
    case 'en_route':
      return secondsToDrawnArrival(phase.enRouteAt ?? now, DRAWN_ETA_SECONDS, now);
    case 'in_progress':
      return phase.inTransitAt === null
        ? DRAWN_DROP_ETA_SECONDS
        : secondsToDrawnArrival(
            phase.inTransitAt,
            DRAWN_DROP_ETA_SECONDS + DROP_ARRIVAL_SLACK_SECONDS,
            now,
          );
    default:
      return 0;
  }
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
    const towing = phase.status === 'in_progress';
    // Moving: walking the approach (19), or the drop leg once the vehicle is loaded (25).
    const moving = phase.status === 'en_route' || (towing && phase.inTransitAt !== null);
    // The approach until the tow starts; the drop leg from then on (loading, towing, at the drop).
    const { here, nextIndex, headingDeg } =
      phase.startedAt === null
        ? alongPath(APPROACH, phase.progress)
        : alongPath(DROP_PATH, phase.dropProgress);

    const tracking: BookingTrackingDisplay = {
      bookingId,
      status: phase.status,
      driver: MOCK_DRIVER,
      position: {
        lat: here.lat,
        lng: here.lng,
        headingDeg,
        speedKph: moving ? 28 : 0,
        lowAccuracy: false,
        at: new Date(now - fixAge()).toISOString(),
      },
      etaSeconds: mockEtaSeconds(phase, now),
      // The mock route follows a street grid (see `mockRoute`), so it is labelled
      // as a routed source and drawn as the design's solid line.
      etaSource: 'google_directions',
      routePolyline:
        phase.status === 'assigned' || phase.status === 'en_route'
          ? mockRoute(APPROACH, here, nextIndex)
          : null,
      // The server plans the drop leg; the mock draws it from the truck while towing.
      routeDropPolyline: towing ? mockRoute(DROP_PATH, here, nextIndex) : null,
      pickup: PICKUP,
      drop: DROP,
      assignedAt: iso(phase.matchedAt),
      arrivedAt: iso(phase.arrivedAt),
      startedAt: iso(phase.startedAt),
      completedAt: iso(phase.completedAt),
      shared: shared !== null,
      at: new Date(now).toISOString(),
      // App-local: the contract has no en-route instant yet (19's "Driver on the way" time).
      enRouteAt: iso(phase.enRouteAt),
      // App-local: nor an in-transit one (25's "In transit" time); null while loading.
      inTransitAt: iso(phase.inTransitAt),
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
