import React from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useTheme } from '@towing/theme';
import { usePressablePrimitive } from '@towing/ui';
import { mitowColors, mitowRadii, MiColorIcon, MiText } from '@/design';
import type { TowType } from '../types';

/**
 * Figma 14 card height: SUV `259:1553` / Bike `259:1559` are fixed at 131, and
 * the selected Car `259:1544` hugs to 8 + 52 + 8 + 55 + 8 = 131. A minimum (the
 * row stretches all three to the tallest) keeps a two-line sub line from being
 * clipped where the device type scale runs above 1.
 */
const CARD_MIN_HEIGHT = 131;

/**
 * One vehicle tile in Figma 14's "Select Vehicle" row.
 *
 * Selected (Car `259:1544`): brand/yellow-soft fill, 1.5 brand/yellow stroke and
 * the 20×20 selected indicator (yellow disc, 8×8 text/primary dot) 8 in from
 * the card's outer top and right edges. Unselected (SUV `259:1553`, Bike
 * `259:1559`): surface/page, 1.2 border/subtle stroke. Both: radius 14, padding
 * 8 / 6, gap 8, 52 colour icon, name Strong 15.5 and sub Label 13 centred with
 * a 2 gap.
 *
 * Figma strokes take no layout space, so the stroke is an overlay here too:
 * every card is 131 tall in either state, the content column is 98.3 wide, and
 * nothing moves when the selection changes the stroke from 1.2 to 1.5.
 */
export function TowTypeCard({
  towType,
  selected,
  onPress,
  style,
}: {
  towType: TowType;
  selected: boolean;
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();
  const Pressable = usePressablePrimitive();

  return (
    <Pressable
      onPress={onPress}
      pressScale={theme.motion.pressScale.card}
      haptic="selection"
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={`${towType.name}, ${towType.categories}`}
      style={[
        {
          minHeight: CARD_MIN_HEIGHT,
          borderRadius: mitowRadii.cardSm,
          paddingHorizontal: 6,
          paddingVertical: 8,
          alignItems: 'center',
          gap: 8,
          backgroundColor: selected ? mitowColors.brandYellowSoft : mitowColors.surfacePage,
        },
        style,
      ]}
    >
      <MiColorIcon name={towType.icon} size={52} />

      <View style={{ alignSelf: 'stretch', alignItems: 'center', gap: 2, overflow: 'hidden' }}>
        <MiText variant="strong155" align="center">
          {towType.name}
        </MiText>
        <MiText variant="label13" color="secondary" align="center">
          {towType.categories}
        </MiText>
      </View>

      <View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFill,
          {
            borderRadius: mitowRadii.cardSm,
            borderWidth: selected ? 1.5 : 1.2,
            borderColor: selected ? mitowColors.brandYellow : mitowColors.borderSubtle,
          },
        ]}
      />

      {selected ? (
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            // Figma's 6.5 / 6.5 inside the 1.5 stroke = 8 from the outer edges.
            top: 8,
            right: 8,
            width: 20,
            height: 20,
            borderRadius: 10,
            backgroundColor: mitowColors.brandYellow,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <View
            style={{
              width: 8,
              height: 8,
              borderRadius: 4,
              backgroundColor: mitowColors.textPrimary,
            }}
          />
        </View>
      ) : null}
    </Pressable>
  );
}
