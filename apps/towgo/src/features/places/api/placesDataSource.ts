import type {
  PlaceAutocompleteResponse,
  PlaceDetail,
  PlaceRouteResponse,
} from '@towing/api-contracts';
import { env } from '@/lib/env';
import type { LatLng } from '@/types/geo';
import { placesMockSource } from './placesMockSource';
import { placesRestSource } from './placesRestSource';

/**
 * §9.1.5's address search — the feature that finally lets a customer type an
 * address instead of picking from seven presets.
 *
 * Same `env.useMocks` seam every other feature has had since Phase 12.
 */
export interface PlacesDataSource {
  autocomplete(query: string, near?: LatLng): Promise<PlaceAutocompleteResponse>;
  /** The road route between two points, for the booking map's line. */
  route(from: LatLng, to: LatLng): Promise<PlaceRouteResponse>;
  /** Resolves a picked suggestion to a coordinate. */
  details(placeId: string): Promise<PlaceDetail>;
  /** The draggable pin's label. */
  reverse(point: LatLng): Promise<PlaceDetail>;
}

export const placesDataSource: PlacesDataSource = env.useMocks
  ? placesMockSource
  : placesRestSource;
