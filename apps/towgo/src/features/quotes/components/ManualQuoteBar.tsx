import React from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@towing/theme';
import { Button, Text } from '@towing/ui';

/**
 * W20 — the §7.3 >600 km offer, rendered where the confirm bar would be.
 *
 * It REPLACES `BookingBottomBar` on this state rather than sitting beside it,
 * because the alternative — a fare skeleton that never resolves next to a
 * disabled Confirm — is what the app did before this milestone: the estimate
 * 422'd and the screen looked like it was still thinking. A refusal that names
 * the next step is the whole point of the flow.
 */
export function ManualQuoteBar({
  distanceKm,
  submitting,
  errorMessage,
  onRequest,
}: {
  /** From the refusal's details — the customer should see the number that triggered it. */
  distanceKm: number | undefined;
  submitting: boolean;
  errorMessage: string | null;
  onRequest: () => void;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <View
      style={{
        borderTopWidth: 1,
        borderTopColor: theme.colors.border,
        backgroundColor: theme.colors.card,
        paddingHorizontal: 18,
        paddingTop: 12,
        paddingBottom: Math.max(insets.bottom, 12),
        gap: 10,
      }}
    >
      {errorMessage ? (
        <Text color="error" style={{ fontSize: 12, lineHeight: 18 }}>
          {errorMessage}
        </Text>
      ) : null}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
        <View style={{ flex: 1 }}>
          <Text weight="semibold" style={{ fontSize: 15, lineHeight: 20 }}>
            {distanceKm !== undefined ? `About ${Math.round(distanceKm)} km` : 'Long distance'}
          </Text>
          <Text color="secondary" style={{ fontSize: 12, lineHeight: 18 }}>
            Trips over 600 km are priced by our team
          </Text>
        </View>
        <View style={{ flex: 1 }}>
          <Button
            label={submitting ? 'Sending…' : 'Request a Manual Quote'}
            onPress={onRequest}
            disabled={submitting}
            fullWidth
            height={47}
          />
        </View>
      </View>
    </View>
  );
}
