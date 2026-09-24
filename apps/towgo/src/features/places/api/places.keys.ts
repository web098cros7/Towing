import type { LatLng } from '@/types/geo';

/**
 * Query keys for §9.1.5's address search.
 *
 * The autocomplete key includes a COARSE bias cell rather than the exact
 * coordinate, matching the server's cache key for the same reason: keying on a
 * position that changes by metres would give every query a fresh key and defeat
 * both caches, while a ~1 km cell is finer than the bias radius anyway.
 */
export const placesKeys = {
  all: ['places'] as const,
  autocomplete: (query: string, near?: LatLng) =>
    [
      'places',
      'autocomplete',
      query.trim().toLowerCase(),
      near ? `${near.latitude.toFixed(2)},${near.longitude.toFixed(2)}` : 'none',
    ] as const,
  route: (from: LatLng, to: LatLng) =>
    [
      'places',
      'route',
      `${from.latitude.toFixed(5)},${from.longitude.toFixed(5)}`,
      `${to.latitude.toFixed(5)},${to.longitude.toFixed(5)}`,
    ] as const,
  reverse: (lat: number, lng: number) =>
    ['places', 'reverse', lat.toFixed(5), lng.toFixed(5)] as const,
};
