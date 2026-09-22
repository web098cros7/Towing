import * as Location from 'expo-location';
import type { LatLng } from '@/types/geo';

/**
 * The device position for screen 13's Locate me, or null when permission is
 * refused or no fix is available (the design draws no state for either).
 *
 * Read here rather than through `useLocationStore.resolveCurrentLocation`, which
 * also rewrites the store's pickup ("Current Location") and status that other
 * screens read. Locate me only moves this screen's camera.
 */
export async function readDeviceFix(): Promise<LatLng | null> {
  try {
    const permission = await Location.requestForegroundPermissionsAsync();
    if (!permission.granted) return null;
    const position = await Location.getCurrentPositionAsync();
    return { latitude: position.coords.latitude, longitude: position.coords.longitude };
  } catch {
    return null;
  }
}
