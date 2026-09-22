import { Linking } from 'react-native';
import type { BookingDetail } from '@/features/bookings/types';

/**
 * 35's "View on Map" (`245:902`) opens the phone's own maps app with directions from the pickup
 * to the drop.
 *
 * DECISION (the design draws no destination for the chip): a receipt screen's "View on Map"
 * means "show me the route this trip took", not "drop a pin here", so it hands Google Maps a
 * DIRECTIONS URL with both ends. `mapsLink` in `screens/emergency/emergency.data.ts` is the
 * single-point form of the same idea and is what this copies: interpolation into Google's URL
 * API, opened with `Linking.openURL`.
 *
 * Six decimals ≈ 0.1 m, the same precision `mapsLink` uses.
 *
 * A booking with only one known point still opens that point (a `?q=` search), and one with
 * neither does nothing: there is nothing to show, and the chip is the screen's only affordance
 * for the map, so it must not open an empty search.
 */
export function openTripInMaps(booking: BookingDetail): void {
  const url = tripDirectionsUrl(booking);
  if (url) Linking.openURL(url).catch(() => {});
}

/** The URL `openTripInMaps` opens, or null when the booking has no point at all. */
export function tripDirectionsUrl(booking: BookingDetail): string | null {
  const pickup = booking.pickupPoint ?? null;
  const drop = booking.dropPoint ?? null;
  const point = (p: { lat: number; lng: number }) => `${p.lat.toFixed(6)},${p.lng.toFixed(6)}`;

  if (pickup && drop) {
    return `https://maps.google.com/maps?saddr=${point(pickup)}&daddr=${point(drop)}`;
  }
  if (pickup) return `https://maps.google.com/?q=${point(pickup)}`;
  if (drop) return `https://maps.google.com/?q=${point(drop)}`;
  return null;
}
