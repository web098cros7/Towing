import type {
  BookingShareResponse,
  BookingTracking,
  CallContact,
  CancellationQuote,
} from '@towing/api-contracts';
import { env } from '@/lib/env';
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
 * So the driver walks a fixed path from a start point toward the pickup, one
 * step per read, at the cadence the screen polls. The path is short and loops at
 * the end, which is enough to see the marker move, turn and arrive.
 *
 * `EXPO_PUBLIC_MOCK_TRACKING_STATE` forces the §11.6 honesty states, which are
 * otherwise unreachable in mock mode because a mock never goes stale:
 *   · `stale`   — a fix 20 s old: ghost marker + "reconnecting…"
 *   · `offline` — a fix 90 s old: the support banner
 *   · `error`   — the request itself fails
 */

const PICKUP = { lat: 12.9716, lng: 77.5946 };
const DROP = { lat: 12.9345, lng: 77.6266 };

/** A short approach from the north-east, ending at the pickup. */
const APPROACH = [
  { lat: 12.9812, lng: 77.6042 },
  { lat: 12.9793, lng: 77.6021 },
  { lat: 12.9771, lng: 77.6003 },
  { lat: 12.9754, lng: 77.5982 },
  { lat: 12.9738, lng: 77.5964 },
  { lat: 12.9724, lng: 77.5952 },
  PICKUP,
];

let step = 0;
let shared: BookingShareResponse | null = null;

/** Bearing from one point to the next, so the marker turns the way it is going. */
function bearing(from: { lat: number; lng: number }, to: { lat: number; lng: number }): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const y = Math.sin(toRad(to.lng - from.lng)) * Math.cos(toRad(to.lat));
  const x =
    Math.cos(toRad(from.lat)) * Math.sin(toRad(to.lat)) -
    Math.sin(toRad(from.lat)) * Math.cos(toRad(to.lat)) * Math.cos(toRad(to.lng - from.lng));
  return (((Math.atan2(y, x) * 180) / Math.PI) + 360) % 360;
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

    const index = Math.min(step, APPROACH.length - 1);
    const next = APPROACH[Math.min(step + 1, APPROACH.length - 1)]!;
    const here = APPROACH[index]!;
    // Loops rather than stopping, so the screen can be watched for as long as
    // somebody wants to look at it.
    step = (step + 1) % (APPROACH.length + 4);

    const arrived = index >= APPROACH.length - 1;

    return {
      bookingId,
      status: arrived ? 'arrived' : 'en_route',
      driver: {
        name: 'Anita Sharma',
        photoUrl: null,
        rating: 4.9,
        totalTrips: 214,
        vehiclePlate: 'KA 05 MJ 8842',
        vehicleClass: 'flatbed',
      },
      position: {
        lat: here.lat,
        lng: here.lng,
        headingDeg: bearing(here, next),
        speedKph: arrived ? 0 : 28,
        lowAccuracy: false,
        at: new Date(Date.now() - fixAge()).toISOString(),
      },
      etaSeconds: Math.max(60, (APPROACH.length - index) * 90),
      // Labelled `haversine` because it IS a straight line — the mock has no
      // Directions result, and claiming a routed source would make the app draw
      // a solid line through buildings and call it a road.
      etaSource: 'haversine',
      routePolyline: null,
      routeDropPolyline: null,
      pickup: PICKUP,
      drop: DROP,
      assignedAt: new Date(Date.now() - 6 * 60_000).toISOString(),
      arrivedAt: arrived ? new Date().toISOString() : null,
      startedAt: null,
      completedAt: null,
      shared: shared !== null,
      at: new Date().toISOString(),
    };
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
    // The chargeable branch, so the sheet's fee copy is reachable in mock mode.
    //
    // `chargeable` IS NOW TRUE — Phase 19 shipped collection, and the previous
    // version of this comment predicted exactly that. The sheet's "we cannot
    // take this fee yet" block disappears on its own, and the confirm button
    // now opens the fee payment sheet.
    return {
      tier: 'full',
      feePaise: 120_000,
      reason: 'Your driver is already on the way',
      chargeable: true,
      // §3.5 compensates the driver out of the fee — half, by default.
      driverCompensationPaise: 60_000,
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
      displayName: 'Anita Sharma',
      reference: null,
    };
  },
};
