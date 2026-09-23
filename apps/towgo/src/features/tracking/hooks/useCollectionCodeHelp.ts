import { useEffect, useRef } from 'react';
import { Alert } from 'react-native';
import { ErrorCodes } from '@towing/api-contracts';
import { useBookingOtp, useRenewBookingOtp } from '@/features/bookings/api/bookings.queries';
import { ApiClientError } from '@/lib/api/errors';

/** L16: how long the code has to have been failing before the customer is told. */
const TELL_AFTER_MS = 30_000;

/**
 * The two moments on 24 where the six digits cannot help the customer, and
 * what they are told. Both are system prompts: 24 draws neither state, and
 * a native prompt is how this app already reports what Figma does not show.
 *
 * L17, THE CODE LOCKED. The driver typed a wrong code too many times, so
 * the code on screen no longer works although its window is open. Before this
 * the customer had no way to know, and no way out for up to thirty minutes.
 * Now they are asked, once per locked code, whether they want a new one.
 *
 * L16, THE CODE WILL NOT LOAD. 24 shows six empty cells while it keeps
 * retrying (a recorded design decision), which on its own reads as a bug. After
 * about thirty seconds of failures the customer is told, once, that it is the
 * connection and that the code will appear by itself.
 *
 * Reads the same cached query as `useCollectionCode`, so it adds no requests.
 */
export function useCollectionCodeHelp(bookingId: string, available: boolean): void {
  const { data, isError } = useBookingOtp(bookingId, available);
  const renew = useRenewBookingOtp(bookingId);

  const askedForCode = useRef<string | null>(null);
  useEffect(() => {
    if (!available || !data?.locked || askedForCode.current === data.code) return;
    askedForCode.current = data.code;
    Alert.alert(
      "Your driver couldn't enter the code",
      'They typed a wrong code too many times, so it no longer works. Get a new code and read it out to them.',
      [
        { text: 'Not now', style: 'cancel' },
        {
          text: 'Get new code',
          onPress: () =>
            renew.mutate(undefined, {
              onError: (error) =>
                Alert.alert(
                  'Could not get a new code',
                  error instanceof ApiClientError &&
                    error.code === ErrorCodes.OTP_RENEWALS_EXHAUSTED
                    ? error.message
                    : 'Please check your connection and try again.',
                ),
            }),
        },
      ],
    );
  }, [available, data?.code, data?.locked, renew]);

  // A query stays in error while `useCollectionCode` retries it, and leaves it
  // on the first success; a timer over that span is "failing for 30 s".
  const toldAboutLoading = useRef(false);
  useEffect(() => {
    if (!isError) {
      toldAboutLoading.current = false;
      return;
    }
    if (!available || toldAboutLoading.current) return;
    const timer = setTimeout(() => {
      toldAboutLoading.current = true;
      Alert.alert(
        "Couldn't load your collection code",
        "Check your connection. We'll keep trying, and the code will appear here as soon as it loads.",
      );
    }, TELL_AFTER_MS);
    return () => clearTimeout(timer);
  }, [available, isError]);
}
