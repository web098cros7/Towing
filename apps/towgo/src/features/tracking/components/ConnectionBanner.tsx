import React from 'react';
import { View } from 'react-native';
import { useTheme } from '@towing/theme';
import { Text } from '@towing/ui';
import { TriangleAlert, WifiOff } from '@/icons';
import { Pressable } from '@/motion';

/**
 * §11.6's customer-side honesty states, rendered.
 *
 * "Last ping age > 15s → marker dims to 'ghost' + 'reconnecting…' label; > 60s →
 * banner 'We're having trouble reaching your driver' + support shortcut."
 *
 * THE TWO STATES SAY DIFFERENT THINGS BECAUSE THEY MEAN DIFFERENT THINGS, and
 * conflating them is the failure this component exists to avoid. Fifteen seconds
 * of silence is ordinary — a tunnel, a lift, a signal dip — and the honest
 * response is a quiet note that the position is a moment old. Sixty seconds is
 * not ordinary, and a customer standing beside a broken vehicle deserves to be
 * told plainly and given a way to reach a human, rather than left watching a
 * marker that has quietly stopped being true.
 *
 * WHAT IT NEVER DOES IS HIDE. The alternative design — keep showing the last
 * position with no indication of age — is what produces the "driver never moved"
 * complaint §6.1 already guards the dispatch side against. A stale marker with
 * no label is a lie that looks like a bug.
 */

export type TrackingPresence = 'live' | 'stale' | 'offline';

export function ConnectionBanner({
  presence,
  onGetHelp,
}: {
  presence: TrackingPresence;
  /** §11.6's "support shortcut". */
  onGetHelp: () => void;
}) {
  const theme = useTheme();

  if (presence === 'live') return null;

  const stale = presence === 'stale';

  return (
    <View
      accessibilityRole="alert"
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        backgroundColor: stale ? theme.colors.warningSoftBg : theme.colors.errorSoftBg,
        borderRadius: 14,
        paddingHorizontal: 14,
        paddingVertical: 12,
      }}
    >
      {stale ? (
        <WifiOff size={16} color={theme.colors.warningSoftFg} />
      ) : (
        <TriangleAlert size={16} color={theme.colors.errorSoftFg} />
      )}

      <View style={{ flex: 1 }}>
        <Text
          weight="medium"
          style={{
            fontSize: 13,
            lineHeight: 18,
            color: stale ? theme.colors.warningSoftFg : theme.colors.errorSoftFg,
          }}
        >
          {stale
            ? 'Reconnecting… showing your driver’s last known position'
            : 'We’re having trouble reaching your driver'}
        </Text>
      </View>

      {/*
        The support shortcut appears ONLY at the offline threshold. Offering it
        at fifteen seconds would train customers to contact support for a signal
        dip that resolves itself before anybody answers.
      */}
      {!stale ? (
        <Pressable
          onPress={onGetHelp}
          accessibilityRole="button"
          accessibilityLabel="Get help with this trip"
          hitSlop={8}
        >
          <Text
            weight="semibold"
            style={{ fontSize: 13, lineHeight: 18, color: theme.colors.errorSoftFg }}
          >
            Get help
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}
