import React, { useEffect, useRef } from 'react';
import { View } from 'react-native';
import { useTheme } from '@towing/theme';
import { Skeleton, Text } from '@towing/ui';
import { Lock } from '@/icons';
import { useBookingOtp } from '@/features/bookings/api/bookings.queries';
import { haptics } from '@/motion';

/**
 * §9.1.7's "Booking OTP prominently (hand to driver on arrival)".
 *
 * THE HOOK IT USES HAS EXISTED SINCE PHASE 15 AND HAD NO CALLER.
 * `useBookingOtp(bookingId, available)` was built, wired to a real endpoint,
 * given a mock source — and never rendered, because there was no screen honest
 * enough to show it. This is that screen's card.
 *
 * IT IS GATED ON `otpAvailable`, NOT ON THE STATUS. §9.1.7 says "OTP never
 * visible before assignment", and the server enforces it with a 409 — but the
 * flag exists precisely so the app can hide the card rather than probe a route
 * that would fail. Deriving the gate from the status here would be a second copy
 * of a rule the server already owns.
 *
 * THE CODE IS FETCHED, NOT PUSHED, and that is the whole design of
 * `BookingOtpService`: the digest lives in Postgres, the readable code lives in
 * Redis for its 30-minute window, and the first read is what starts the clock.
 * Re-reading inside the window returns the SAME code — which matters at the one
 * moment that counts, when the customer is reading it aloud and the screen
 * refetches in the background.
 */

export function BookingOtpCard({
  bookingId,
  available,
  /** §9.1.7's "arrived (OTP highlighted + haptic)". */
  highlighted,
}: {
  bookingId: string;
  available: boolean;
  highlighted: boolean;
}) {
  const theme = useTheme();
  const { data, isLoading } = useBookingOtp(bookingId, available);

  /**
   * One haptic, on the transition INTO arrival — not on every render while
   * arrived. A phone that buzzes each time a poll lands is a phone somebody
   * turns face down.
   */
  const buzzed = useRef(false);
  useEffect(() => {
    if (!highlighted || buzzed.current) return;
    buzzed.current = true;
    haptics.success();
  }, [highlighted]);

  if (!available) return null;

  return (
    <View
      accessibilityLabel={
        data ? `Your collection code is ${data.code.split('').join(' ')}` : 'Collection code'
      }
      style={{
        backgroundColor: highlighted ? theme.colors.infoSoftBg : theme.colors.card,
        borderRadius: 18,
        borderWidth: highlighted ? 2 : 1,
        borderColor: highlighted ? theme.colors.brand : theme.colors.border,
        padding: 16,
        gap: 10,
        ...theme.shadows.card,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Lock size={14} color={theme.colors.textSecondary} />
        <Text weight="semibold" style={{ fontSize: 13, lineHeight: 18 }}>
          {highlighted ? 'Share this code with your driver' : 'Your collection code'}
        </Text>
      </View>

      {isLoading || !data ? (
        <Skeleton width={180} height={40} radius={10} />
      ) : (
        <Text
          weight="bold"
          tabular
          style={{
            fontSize: 34,
            lineHeight: 40,
            // Wide tracking so six digits read as six digits when somebody is
            // saying them out loud through a car window.
            letterSpacing: 8,
            color: theme.colors.textPrimary,
          }}
        >
          {data.code}
        </Text>
      )}

      <Text color="secondary" style={{ fontSize: 12, lineHeight: 17 }}>
        The driver cannot start your tow without it. Never share it before they arrive.
      </Text>
    </View>
  );
}
