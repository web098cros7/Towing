import { Linking } from 'react-native';
import type { NavigationProp } from '@react-navigation/native';
import { trackingDataSource } from '@/features/tracking/api/trackingDataSource';
import { env } from '@/lib/env';
import type { RootStackParamList } from '@/navigation/types';

/** Anything that can navigate the root stack: a screen's `navigation` (typed with `RootStackParamList`). */
export type DriverChatNavigation = Pick<NavigationProp<RootStackParamList>, 'navigate'>;

/**
 * The ONE action behind every driver Message button (icon/message in a Driver Row):
 * 18 Driver En Route, 19 Driver Arriving, 20 Booking Details, 23 Driver Arrived and
 * 24 Collection Code. Figma draws each of them as opening 22 Chat with Driver.
 *
 * Why it forks on `env.useMocks`: there is NO chat backend. There is no messages
 * table, endpoint, contract or socket event, and the driver app has no chat either
 * (22 spec, Data gap 1). So:
 * - mock mode (`EXPO_PUBLIC_USE_MOCKS`, on by default): open 22 (`ChatWithDriver`),
 *   which runs on an app-local mock conversation;
 * - live API: keep 18's behaviour until a chat API exists: fetch the driver's number
 *   through `contact()` and hand it to the phone's messages app (`sms:`), which shows
 *   it before anything is sent. The design draws no dialog, warning or error, so a
 *   failed lookup or a missing number does nothing, and the button can be pressed again.
 *   Opening 22 live would show an empty list and a Send that fails with no design
 *   (22 spec Decision 1).
 *
 * Usage (from a screen): `onMessage={() => void openDriverChat(navigation, bookingId)}`.
 */
export async function openDriverChat(
  navigation: DriverChatNavigation,
  bookingId: string,
): Promise<void> {
  if (env.useMocks) {
    navigation.navigate('ChatWithDriver', { bookingId });
    return;
  }

  try {
    const contact = await trackingDataSource.contact(bookingId);
    if (!contact.dialNumber) return;
    await Linking.openURL(`sms:${contact.dialNumber}`);
  } catch {
    // Nothing drawn for a failure; the button stays available to try again.
  }
}
