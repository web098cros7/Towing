import { Linking, Platform } from 'react-native';
import type { LatLng } from '@/types/geo';

/**
 * The public emergency numbers screen 26 draws. They are static copy AND what each
 * control dials, so the drawn text and the dialled number can never differ.
 *
 * Which numbers to keep is an owner decision (DATA-GAPS-26).
 */
export const EMERGENCY_NUMBERS = {
  /** Tile 3.1 "Call 112 · Emergency Helpline" (`254:1348`), India's single emergency number (ERSS). */
  unified: '112',
  /** Tile 3.2 "Call Police · 100" (`254:1355`). */
  police: '100',
  /** Tile 3.3 "Call Ambulance · 108" (`254:1362`). */
  ambulance: '108',
  /** Card 5.1 "Call Fire Brigade · 101" (`254:1393`). */
  fire: '101',
} as const;

/**
 * The MiTow Support card (5.2, `409:18846`) dials the same line it shows. The live
 * value comes from app-config (`useSupportContact`); this re-export keeps the
 * offline fallback available to other importers.
 */
export { SUPPORT_PHONE_DIAL } from '@/screens/support/supportContact';

/**
 * Hands the number to the phone's dialer (Android fills it in, the user presses Call;
 * iOS shows its own "Call …?" prompt). No failure state is drawn, so a device without
 * telephony does nothing (same pattern as ContactUsScreen).
 */
export function dial(number: string): void {
  Linking.openURL(`tel:${number}`).catch(() => {});
}

/**
 * A one-off Google Maps link to a point (6 decimals ≈ 0.1 m), used when there is no
 * trip to share.
 */
export function mapsLink({ latitude, longitude }: LatLng): string {
  return `https://maps.google.com/?q=${latitude.toFixed(6)},${longitude.toFixed(6)}`;
}

/**
 * The phone's own messages app, addressed and pre-filled; iOS and Android spell the
 * body parameter differently. The user still presses Send.
 */
export function smsUrl(phone: string, body: string): string {
  const separator = Platform.OS === 'ios' ? '&' : '?';
  return `sms:${phone}${separator}body=${encodeURIComponent(body)}`;
}
