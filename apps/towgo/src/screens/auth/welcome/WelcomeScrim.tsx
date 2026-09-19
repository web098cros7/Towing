import React from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

export type WelcomeScrimProps = {
  /** Unique per instance: SVG gradient ids share a namespace. */
  id: string;
  color: string;
  /** Opacity of the stop at position 0 (top edge). */
  fromOpacity: number;
  /** Opacity of the stop at position 1 (bottom edge). */
  toOpacity: number;
  style?: StyleProp<ViewStyle>;
};

/**
 * The Welcome scrims exactly as Figma draws them (421:19850 Top scrim,
 * 421:19851 Bottom scrim): GRADIENT_LINEAR, top to bottom, EXACTLY two stops.
 *
 * Built locally because the shared `MiScrim` eases the ramp through five stops
 * (`Math.pow(t, 1.6)`), which the design does not draw.
 */
export function WelcomeScrim({ id, color, fromOpacity, toOpacity, style }: WelcomeScrimProps) {
  return (
    <View pointerEvents="none" style={style}>
      <Svg width="100%" height="100%">
        <Defs>
          <LinearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            <Stop offset={0} stopColor={color} stopOpacity={fromOpacity} />
            <Stop offset={1} stopColor={color} stopOpacity={toOpacity} />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${id})`} />
      </Svg>
    </View>
  );
}
