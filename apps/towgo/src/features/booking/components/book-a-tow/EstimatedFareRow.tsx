import React from 'react';
import { View } from 'react-native';
import { useTheme } from '@towing/theme';
import { usePressablePrimitive } from '@towing/ui';
import { MiColorIcon, MiText } from '@/design';
import { formatPaise } from '@/utils/format';
import type { FareEstimate } from '../../types';

/**
 * "₹1,200 – ₹1,500": two rupee amounts joined by space, U+2013 EN DASH, space.
 *
 * The range ends come from the app-local `totalMinPaise` / `totalMaxPaise`.
 * The contract response carries only `totalPaise`, so without them the label
 * is that one amount.
 */
export function fareRangeLabel(estimate: FareEstimate): string {
  const total = estimate.breakdown.totalPaise;
  const low = estimate.totalMinPaise ?? total;
  const high = estimate.totalMaxPaise ?? total;
  // One number when the server quotes one: "₹1,200 – ₹1,200" read as a bug
  // (owner, 25 Sep 2026).
  if (low === high) return formatPaise(total);
  return `${formatPaise(low)} – ${formatPaise(high)}`;
}

/**
 * Figma 14 Fare row `370:18914`: 28 tall, space-between, items centred.
 * "Estimated Fare" (Body S 14, secondary) on the left; the amount (Amount 22)
 * and icon/color/info 20 with a gap of 8 on the right.
 *
 * The whole row is the tap target and is never disabled: the screen opens 15
 * Fare Breakdown, or asks for the quote again when none has landed. The
 * amount is the quote on screen (`useFareEstimate` seeds it in mock mode and
 * holds the previous quote through a re-quote), so it is only empty while the
 * live API has not answered for the first time.
 *
 * Its accessibility label is load-bearing: `maestro/customer-booking.yaml`
 * taps it by id.
 */
export function EstimatedFareRow({
  estimate,
  onPress,
}: {
  estimate: FareEstimate | undefined;
  onPress: () => void;
}) {
  const theme = useTheme();
  const Pressable = usePressablePrimitive();

  return (
    <Pressable
      onPress={onPress}
      pressScale={theme.motion.pressScale.row}
      haptic="light"
      hitSlop={{ top: 8, bottom: 8 }}
      accessibilityRole="button"
      accessibilityLabel="View fare breakdown"
      style={{
        height: 28,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        overflow: 'hidden',
      }}
    >
      {/* The label yields first, so an unusually long range never pushes the ⓘ out of the clipped row. */}
      <MiText variant="bodyS14" color="secondary" numberOfLines={1} style={{ flexShrink: 1 }}>
        Estimated Fare
      </MiText>

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <MiText variant="amount22" numberOfLines={1}>
          {estimate ? fareRangeLabel(estimate) : ''}
        </MiText>
        <MiColorIcon name="info" size={20} />
      </View>
    </Pressable>
  );
}
