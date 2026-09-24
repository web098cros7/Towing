import type { NearbyDriversResponse } from '@towing/api-contracts';
import { apiFetch } from '@/lib/api/client';
import type { LatLng } from '@/types/geo';
import type { NearbySupply } from '../types';
import type { HomeDataSource } from './homeDataSource';

export const homeRestSource: HomeDataSource = {
  async getNearbyDrivers(near: LatLng, radiusKm = 5): Promise<NearbySupply> {
    const params = new URLSearchParams({
      lat: String(near.latitude),
      lng: String(near.longitude),
      radiusKm: String(radiusKm),
    });
    const response = await apiFetch<NearbyDriversResponse>(`drivers/nearby?${params.toString()}`);

    return {
      count: response.count,
      // The wire uses `{ lat, lng }` (the shared `geoPointSchema`); the app uses
      // `{ latitude, longitude }` everywhere, because that is what
      // `react-native-maps` takes. Converting here rather than at each marker
      // keeps the mismatch in one place.
      points: response.points.map((point) => ({ latitude: point.lat, longitude: point.lng })),
      vehicles: response.vehicles.map((v) => ({
        coordinate: { latitude: v.lat, longitude: v.lng },
        headingDeg: v.headingDeg,
        vehicleClass: v.vehicleClass,
      })),
      coarsenedToMeters: response.coarsenedToMeters,
      degraded: response.degraded,
    };
  },
};
