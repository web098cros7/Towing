import { trucksMock } from '@/features/trucks/mocks/trucks.mock';
import type { FleetPosition, FleetZone, PositionsSnapshot } from '../types';

/**
 * Deterministic Bengaluru drive loops for the mock trucks.
 *
 * Mock mode opens NO socket and makes NO network request — the map animates from
 * this replayer alone. That is what keeps the Playwright smoke hermetic (its
 * whole hermeticity comes from `NEXT_PUBLIC_USE_MOCKS`, with no route
 * interception anywhere), and it is the same "pinned to mock" trick
 * `earningsDataSource` uses.
 *
 * Seeded, not random: a demo that looks different on every reload is impossible
 * to screenshot or assert against.
 */

/** §2 persona city. */
const ORIGIN = { lat: 12.9716, lng: 77.5946 };

/** Mulberry32 — same generator family the backend simulator uses. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Loop {
  truckId: string;
  centerLat: number;
  centerLng: number;
  radiusDeg: number;
  /** Radians per tick. */
  speed: number;
  phase: number;
}

const loops: Loop[] = trucksMock.map((truck, index) => {
  const rng = mulberry32(1337 + index * 7919);
  return {
    truckId: truck.id,
    centerLat: ORIGIN.lat + (rng() - 0.5) * 0.09,
    centerLng: ORIGIN.lng + (rng() - 0.5) * 0.09,
    radiusDeg: 0.006 + rng() * 0.014,
    speed: 0.05 + rng() * 0.06,
    phase: rng() * Math.PI * 2,
  };
});

/** A single ring around the city so the vendorless map has visible geography. */
export const zonesMock: FleetZone[] = [
  {
    id: 'zone-bengaluru-central',
    name: 'Bengaluru Central',
    geometry: {
      type: 'Polygon',
      coordinates: [ring(ORIGIN.lng, ORIGIN.lat, 0.075, 48)],
    },
  },
];

function ring(lng: number, lat: number, radius: number, points: number): number[][] {
  const coords: number[][] = [];
  for (let i = 0; i <= points; i += 1) {
    const angle = (i / points) * Math.PI * 2;
    // cos(lat) keeps the ring circular on screen rather than an ellipse.
    coords.push([
      lng + radius * Math.cos(angle) * (1 / Math.cos((lat * Math.PI) / 180)),
      lat + radius * Math.sin(angle),
    ]);
  }
  return coords;
}

/**
 * Positions at tick `t`. Trucks that are `inactive` sit still, so the presence
 * and status legends have something honest to show.
 */
export function mockPositionsAt(tick: number): FleetPosition[] {
  return trucksMock.map((truck, index) => {
    const loop = loops[index];
    const moving = truck.status !== 'inactive';
    const angle = loop ? loop.phase + (moving ? tick * loop.speed : 0) : 0;
    const lat = loop ? loop.centerLat + loop.radiusDeg * Math.sin(angle) : ORIGIN.lat;
    const lng = loop ? loop.centerLng + loop.radiusDeg * Math.cos(angle) : ORIGIN.lng;
    const onJob = moving && index % 3 === 0;

    return {
      truckId: truck.id,
      plate: truck.plate,
      status: truck.status,
      driverName: truck.assignedDriverName,
      lat,
      lng,
      // Tangent to the circle, converted to a compass bearing (0 = north).
      heading: ((((-angle * 180) / Math.PI + 90) % 360) + 360) % 360,
      speedKph: moving ? 28 + ((index * 7) % 22) : 0,
      // `inactive` trucks are deliberately stale so the map shows a ghost marker
      // and the §11.6 states are visible in a demo.
      at: new Date(Date.now() - (moving ? 0 : 90_000)).toISOString(),
      activeBookingId: onJob ? `mock-booking-${index}` : null,
      // Fixed points, not orbiting ones: a pickup that moves with the truck
      // would make the leg meaningless in a demo.
      activeJobLeg: onJob
        ? {
            pickup: { lat: ORIGIN.lat + 0.018 - index * 0.004, lng: ORIGIN.lng - 0.02 + index * 0.005 },
            // Every third on-job truck is a no-destination service (jumpstart,
            // fuel, tyre) so the drop-less leg renders in the demo too.
            drop:
              index % 2 === 0
                ? { lat: ORIGIN.lat - 0.03 + index * 0.003, lng: ORIGIN.lng + 0.035 - index * 0.004 }
                : null,
          }
        : null,
      fromFallback: false,
    };
  });
}

export function mockSnapshot(tick = 0): PositionsSnapshot {
  return {
    positions: mockPositionsAt(tick),
    zones: zonesMock,
    at: new Date().toISOString(),
    degraded: false,
  };
}
