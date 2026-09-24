import { create } from 'zustand';
import * as Location from 'expo-location';
import { placesDataSource } from '@/features/places/api/placesDataSource';
import type { LocationStatus, PickupLocation } from './types';

const DEFAULT_PICKUP: PickupLocation = {
  label: 'MG Road, Bengaluru',
  coords: { latitude: 12.9752, longitude: 77.605 },
};

type LocationState = {
  status: LocationStatus;
  pickup: PickupLocation;
  setPickup: (pickup: PickupLocation) => void;
  /**
   * Resolve the device GPS as pickup, subject to the OS permission prompt.
   *
   * NOT named `useCurrentLocation`. It is a store action, not a hook, and the
   * `use` prefix made both React's lint rule and a reader believe otherwise —
   * calling it inside a `useCallback` read as a hook in a callback, which is
   * the one thing hooks may never do.
   */
  resolveCurrentLocation: () => Promise<void>;
};

export const useLocationStore = create<LocationState>((set, get) => ({
  status: 'ready',
  pickup: DEFAULT_PICKUP,
  setPickup: (pickup) => set({ pickup }),
  resolveCurrentLocation: async () => {
    set({ status: 'locating' });

    const permission = await Location.requestForegroundPermissionsAsync();
    if (!permission.granted) {
      set({ status: 'denied' });
      return;
    }

    let coords: { latitude: number; longitude: number };
    try {
      const position = await Location.getCurrentPositionAsync();
      coords = { latitude: position.coords.latitude, longitude: position.coords.longitude };
    } catch {
      set({ status: 'denied' });
      return;
    }
    // The fix first, labelled "Current Location", so the map moves at once;
    // then the street address from the reverse lookup when it answers.
    set({ status: 'ready', pickup: { label: 'Current Location', coords } });
    try {
      const place = await placesDataSource.reverse(coords);
      const current = get().pickup.coords;
      // Only if the pickup is still this fix (nothing picked meanwhile).
      if (current?.latitude === coords.latitude && current.longitude === coords.longitude) {
        set({ pickup: { label: place.label, coords } });
      }
    } catch {
      // Offline or no match: "Current Location" stays.
    }
  },
}));
