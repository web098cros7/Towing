import { Alert, Linking } from 'react-native';
import { trackingDataSource } from '@/features/tracking/api/trackingDataSource';

export type CallOutcome = 'ok' | 'no-number' | 'failed';

/**
 * The one place this app dials a driver.
 *
 * The number comes from the server seam `contact(bookingId)`, never from the
 * booking payload: with a masked-calling provider that route is the only way to
 * get a proxy DID, and without one (SETUP-CHECKLIST item 13) it returns the
 * driver's real mobile with `masked: false`. That flag is the contract — when it
 * is false, the OTHER PERSON'S REAL NUMBER is about to be dialled and shown, and
 * both apps must warn before it happens. The driver app already warns; this is
 * the customer side of the same commitment.
 *
 * A failed lookup or a missing number returns silently: the design draws no
 * error state for this, and the button stays available to try again. Callers
 * that draw their own failure copy branch on the returned outcome; the default
 * for everyone else is to ignore it and stay silent.
 */
export async function callDriver(bookingId: string): Promise<CallOutcome> {
  let contact;
  try {
    contact = await trackingDataSource.contact(bookingId);
  } catch {
    return 'failed';
  }

  if (!contact.dialNumber) return 'no-number';

  // `.catch` rather than a throw: a tablet with no dialler is a bad experience,
  // not a crash.
  const dial = () => {
    void Linking.openURL(`tel:${contact.dialNumber}`).catch(() => {});
  };

  if (contact.masked) {
    dial();
    return 'ok';
  }

  Alert.alert(
    'Call your driver',
    `You are about to call ${contact.displayName ?? 'your driver'} on their personal number, and they will see yours. Private numbers are coming soon.`,
    [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Call', onPress: dial },
    ],
  );

  return 'ok';
}
