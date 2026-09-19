import { env } from '@/lib/env';
import type { LatLng } from '@/types/geo';
import type { NearbySupply, NearestPartner } from '../types';
import type { HomeDataSource } from './homeDataSource';

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Deterministic offsets, so the demo map does not reshuffle on every poll.
 * Anonymous supply around the customer; Home draws only the partner below.
 */
const OFFSETS = [
  { lat: -0.0027, lng: 0.0018 },
  { lat: 0.0015, lng: -0.0036 },
  { lat: -0.0041, lng: -0.0012 },
  { lat: 0.0008, lng: 0.0052 },
];

/** Figma 07's example callout line two, "4 mins away" (`287:2045`). */
const MOCK_ETA_MINUTES = 4;

/**
 * Where the mock partner sits: along Figma 07's dot-to-truck vector (167.7 pt
 * east, 85.8 pt north), 1.2 km out, so Home frames it exactly as 07 draws it.
 * Kept equal to `FRAMING_DISTANCE_KM` / `FRAMING_VECTOR` in `home.queries.ts`,
 * whose stand-in partner shows for the 500 ms before this answers.
 */
const PARTNER_DISTANCE_KM = 1.2;
const PARTNER_VECTOR = { east: 167.7, north: 85.8 };

function mockPartner(near: LatLng): NearestPartner {
  const length = Math.hypot(PARTNER_VECTOR.east, PARTNER_VECTOR.north);
  const eastKm = (PARTNER_DISTANCE_KM * PARTNER_VECTOR.east) / length;
  const northKm = (PARTNER_DISTANCE_KM * PARTNER_VECTOR.north) / length;
  return {
    coordinate: {
      latitude: near.latitude + northKm / 111.32,
      longitude: near.longitude + eastKm / (111.32 * Math.cos((near.latitude * Math.PI) / 180)),
    },
    etaMinutes: MOCK_ETA_MINUTES,
    // No `route`: like a real source without directions, the design's route
    // shape is drawn between the two points by `useNearestPartner`.
  };
}

/**
 * Mock supply, in the §11.9 shape. It scatters anonymous points around whatever
 * the caller asked about rather than returning fixed coordinates, so panning the
 * demo map keeps showing drivers instead of leaving them behind in Bengaluru.
 *
 * `nearestPartner` is the app-local extension Home's map needs (see the type);
 * the real endpoint has no such field.
 */
export const homeMockSource: HomeDataSource = {
  async getNearbyDrivers(near: LatLng): Promise<NearbySupply> {
    await delay(500);
    if (env.mockNearbyState === 'error') throw new Error('Failed to load nearby drivers');
    if (env.mockNearbyState === 'empty') {
      return { count: 0, points: [], coarsenedToMeters: 100, degraded: false };
    }

    const partner = mockPartner(near);
    return {
      count: OFFSETS.length + 1,
      points: [
        partner.coordinate,
        ...OFFSETS.map((offset) => ({
          latitude: near.latitude + offset.lat,
          longitude: near.longitude + offset.lng,
        })),
      ],
      coarsenedToMeters: 100,
      degraded: false,
      nearestPartner: partner,
    };
  },
};
