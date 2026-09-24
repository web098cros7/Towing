import { create } from 'zustand';
import * as Location from 'expo-location';
import { placesDataSource } from '@/features/places/api/placesDataSource';
import type { LocationStatus, PickupLocation } from './types';
import { fullPlaceText } from '@/utils/address';

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

/** How long a fresh GPS fix may take before the last known one (or none) stands. */
const FIX_TIMEOUT_MS = 10_000;
/** A last known fix this recent is good enough to show at once. */
const LAST_KNOWN_MAX_AGE_MS = 2 * 60_000;

let inFlight: Promise<void> | null = null;

type Set = (partial: Partial<LocationState>) => void;
type Get = () => LocationState;

/** Resolves with null instead of waiting past `ms`. */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(null);
      },
    );
  });
}

async function locate(set: Set, get: Get): Promise<void> {
  set({ status: 'locating' });

  const permission = await Location.requestForegroundPermissionsAsync();
  if (!permission.granted) {
    set({ status: 'denied' });
    return;
  }

  const show = (coords: { latitude: number; longitude: number }) => {
    // The fix first, labelled "Current Location", so the map moves at once;
    // then the street address from the reverse lookup when it answers.
    set({ status: 'ready', pickup: { label: 'Current Location', coords } });
    void placesDataSource
      .reverse(coords)
      .then((place) => {
        const current = get().pickup.coords;
        // Only if the pickup is still this fix (nothing picked meanwhile).
        if (current?.latitude === coords.latitude && current.longitude === coords.longitude) {
          set({ pickup: { label: fullPlaceText(place.label, place.address), coords } });
        }
      })
      .catch(() => {
        // Offline or no match: "Current Location" stays.
      });
  };

  // The phone's last known fix, if recent, answers instantly.
  const lastKnown = await Location.getLastKnownPositionAsync({
    maxAge: LAST_KNOWN_MAX_AGE_MS,
  }).catch(() => null);
  if (lastKnown)
    show({ latitude: lastKnown.coords.latitude, longitude: lastKnown.coords.longitude });

  // Then a fresh fix, but never waiting forever for one.
  const fresh = await withTimeout(
    Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
    FIX_TIMEOUT_MS,
  );
  if (fresh) {
    const moved =
      !lastKnown ||
      lastKnown.coords.latitude !== fresh.coords.latitude ||
      lastKnown.coords.longitude !== fresh.coords.longitude;
    if (moved) show({ latitude: fresh.coords.latitude, longitude: fresh.coords.longitude });
    return;
  }
  // No fresh fix in time: the last known one stands, or there is none.
  if (!lastKnown) set({ status: 'denied' });
}

export const useLocationStore = create<LocationState>((set, get) => ({
  status: 'ready',
  pickup: DEFAULT_PICKUP,
  setPickup: (pickup) => set({ pickup }),
  resolveCurrentLocation: () => {
    // One GPS request at a time: Home asks as it opens Enter Location, and a
    // second request alongside the first could hang on Android and leave the
    // Pickup field on "Finding your location…" (owner, 24 Sep 2026).
    inFlight ??= locate(set, get).finally(() => {
      inFlight = null;
    });
    return inFlight;
  },
}));
