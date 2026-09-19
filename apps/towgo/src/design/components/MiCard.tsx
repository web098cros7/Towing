import React from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { mitowColors } from '../tokens/colors';
import { mitowRadii, mitowShadows } from '../tokens/layout';

export type MiCardProps = {
  children: React.ReactNode;
  /** Default 16 (mitowRadii.card: Locations card 10, trip card 16/17, Vehicle Card 18). Service Card / Menu Card master use 14. */
  radius?: number;
  /** Uniform padding. Use the per-side props below when the spec gives different values. */
  padding?: number;
  paddingTop?: number;
  paddingBottom?: number;
  paddingLeft?: number;
  paddingRight?: number;
  paddingHorizontal?: number;
  paddingVertical?: number;
  /** Gap between children. */
  gap?: number;
  /** Default 1.2 border/subtle. Pass 0 for a borderless white card. */
  borderWidth?: number;
  /** Which MiTow/Elevation effect. Default 'card'. */
  elevation?: 'card' | 'floating' | 'sheet' | 'none';
  style?: StyleProp<ViewStyle>;
};

/**
 * The white bordered surface used across the redesign: surface/page fill,
 * 1.2 border/subtle border (inside, counted in layout — same as RN), radius 16,
 * MiTow/Elevation/Card.
 */
export function MiCard({
  children,
  radius = mitowRadii.card,
  padding,
  paddingTop,
  paddingBottom,
  paddingLeft,
  paddingRight,
  paddingHorizontal,
  paddingVertical,
  gap,
  borderWidth = 1.2,
  elevation = 'card',
  style,
}: MiCardProps) {
  return (
    <View
      style={[
        {
          backgroundColor: mitowColors.surfacePage,
          borderRadius: radius,
          borderWidth,
          borderColor: mitowColors.borderSubtle,
          padding,
          paddingTop,
          paddingBottom,
          paddingLeft,
          paddingRight,
          paddingHorizontal,
          paddingVertical,
          gap,
          ...(elevation === 'none' ? null : mitowShadows[elevation]),
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}
