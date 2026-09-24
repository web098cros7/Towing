import {
  encodePolyline,
  type PlaceAutocompleteResponse,
  type PlaceDetail,
  type PlaceRouteResponse,
} from '@towing/api-contracts';
import { env } from '@/lib/env';
import type { LatLng } from '@/types/geo';
import { recentLocations } from '@/features/booking/data/recentLocations.data';
import type { PlacesDataSource } from './placesDataSource';

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Mock address search.
 *
 * IT SEARCHES `recentLocations`, NOT A SECOND INVENTED LIST. That array is the
 * seven presets the booking screen offered before typing worked, and every entry
 * carries a real coordinate that the seeded `service_zones` agree with — so a
 * fare quoted in mock mode lands in the same zone it would against the real
 * backend. A separate mock gazetteer would drift from both.
 *
 * The mock is deliberately WORSE than the server's local gazetteer (seven
 * entries against twenty-one). Mock mode exists to demo the app with no backend
 * at all; it is not a second implementation of address search, and making it
 * comprehensive would invite it to be treated as one.
 */
export const placesMockSource: PlacesDataSource = {
  async autocomplete(query: string): Promise<PlaceAutocompleteResponse> {
    // Enough latency for the debounce and the spinner to be visible; short
    // enough that typing does not feel broken.
    await delay(250);
    if (env.mockPlacesState === 'error') throw new Error('Failed to search addresses');
    if (env.mockPlacesState === 'empty') return { predictions: [], source: 'local' };

    const needle = query.trim().toLowerCase();
    return {
      predictions: recentLocations
        .filter(
          (location) =>
            location.name.toLowerCase().includes(needle) ||
            location.address.toLowerCase().includes(needle),
        )
        .map((location) => ({
          placeId: `local:${location.id}`,
          primary: location.name,
          secondary: location.address,
        })),
      source: 'local',
    };
  },

  async details(placeId: string): Promise<PlaceDetail> {
    await delay(150);
    const id = placeId.replace(/^local:/, '');
    const location = recentLocations.find((entry) => entry.id === id);
    if (!location) throw new Error('We could not resolve that place');

    return {
      placeId,
      label: location.name,
      address: `${location.name}, ${location.address}`,
      point: { lat: location.coords.latitude, lng: location.coords.longitude },
      // The airport entry sits outside the seeded Bengaluru polygon on purpose —
      // it is the one fixture that reaches §9.1.5's "outside our service area"
      // warning without a backend.
      zoneId: location.id === 'r3' ? null : '00000000-0000-4000-8000-000000000001',
      zoneName: location.id === 'r3' ? null : 'Bengaluru Metro',
      source: 'local',
    };
  },

  /** No Directions in mock mode: the straight line, labelled as one. */
  async route(from: LatLng, to: LatLng): Promise<PlaceRouteResponse> {
    await delay(150);
    const meters = roughMeters(from, to);
    return {
      polyline: encodePolyline([
        { lat: from.latitude, lng: from.longitude },
        { lat: to.latitude, lng: to.longitude },
      ]),
      distanceMeters: meters,
      durationSeconds: Math.round(meters / 8),
      source: 'haversine',
    };
  },

  async reverse(point: LatLng): Promise<PlaceDetail> {
    await delay(150);
    // Nearest preset within ~3 km, mirroring the server adapter's cut-off — past
    // it the coordinate itself is the honest label rather than a locality the
    // customer is nowhere near.
    let nearest: { name: string; address: string; meters: number } | null = null;
    for (const location of recentLocations) {
      const meters = roughMeters(point, location.coords);
      if (nearest === null || meters < nearest.meters) {
        nearest = { name: location.name, address: location.address, meters };
      }
    }

    const coordinate = `${point.latitude.toFixed(5)}, ${point.longitude.toFixed(5)}`;
    const inRange = nearest !== null && nearest.meters <= 3_000;

    return {
      placeId: `latlng:${point.latitude},${point.longitude}`,
      label: inRange ? nearest!.name : coordinate,
      address: inRange ? `${nearest!.name}, ${nearest!.address}` : coordinate,
      // The PIN's coordinate, never the preset's — the customer dragged to a
      // specific point and the fare is measured from it.
      point: { lat: point.latitude, lng: point.longitude },
      zoneId: inRange ? '00000000-0000-4000-8000-000000000001' : null,
      zoneName: inRange ? 'Bengaluru Metro' : null,
      source: 'local',
    };
  },
};

/** Equirectangular metres — over a few km the error against haversine is centimetres. */
function roughMeters(a: LatLng, b: LatLng): number {
  const metersPerDegLat = 111_320;
  const dLat = (b.latitude - a.latitude) * metersPerDegLat;
  const dLng =
    (b.longitude - a.longitude) *
    metersPerDegLat *
    Math.cos(((a.latitude + b.latitude) / 2) * (Math.PI / 180));
  return Math.hypot(dLat, dLng);
}
