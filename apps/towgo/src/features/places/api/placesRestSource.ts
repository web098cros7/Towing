import type {
  PlaceAutocompleteResponse,
  PlaceDetail,
  PlaceRouteResponse,
} from '@towing/api-contracts';
import { apiFetch } from '@/lib/api/client';
import type { PlacesDataSource } from './placesDataSource';

export const placesRestSource: PlacesDataSource = {
  autocomplete(query, near) {
    const params = new URLSearchParams({ q: query });
    // A bias, not a filter — the server treats it the same way.
    if (near) {
      params.set('lat', String(near.latitude));
      params.set('lng', String(near.longitude));
    }
    return apiFetch<PlaceAutocompleteResponse>(`places/autocomplete?${params.toString()}`);
  },

  details(placeId) {
    return apiFetch<PlaceDetail>(`places/details?placeId=${encodeURIComponent(placeId)}`);
  },

  route(from, to) {
    const params = new URLSearchParams({
      fromLat: String(from.latitude),
      fromLng: String(from.longitude),
      toLat: String(to.latitude),
      toLng: String(to.longitude),
    });
    return apiFetch<PlaceRouteResponse>(`places/route?${params.toString()}`);
  },

  reverse(point) {
    return apiFetch<PlaceDetail>(`places/reverse?lat=${point.latitude}&lng=${point.longitude}`);
  },
};
