import type { NavigationProp } from '@react-navigation/native';
import type { RootStackParamList } from '@/navigation/types';

/** Anything that can navigate the root stack: a screen's `navigation` (typed with `RootStackParamList`). */
export type DriverChatNavigation = Pick<NavigationProp<RootStackParamList>, 'navigate'>;

/**
 * The ONE action behind every driver Message button (icon/message in a Driver Row):
 * 18 Driver En Route, 19 Driver Arriving, 20 Booking Details, 23 Driver Arrived and
 * 24 Collection Code. Figma draws each of them as opening 22 Chat with Driver.
 *
 * A real chat backend exists: `GET/POST bookings/:id/messages` plus the
 * `chat:message` push on the `/customer` socket. The screen subscribes to the
 * socket for instant delivery and falls back to a 5 s poll, so replies from the
 * driver arrive without leaving the screen.
 *
 * Usage (from a screen): `onMessage={() => void openDriverChat(navigation, bookingId)}`.
 */
export async function openDriverChat(
  navigation: DriverChatNavigation,
  bookingId: string,
): Promise<void> {
  navigation.navigate('ChatWithDriver', { bookingId });
}
