import React from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

export type MiScrimProps = {
  /** Colour of the fade. */
  color: string;
  /** Opacity at the top edge. */
  fromOpacity: number;
  /** Opacity at the bottom edge. */
  toOpacity: number;
  /** Positioning — these are absolutely placed over imagery by the caller. */
  style?: StyleProp<ViewStyle>;
  /** Distinct per instance: SVG gradient ids share a document namespace. */
  id: string;
};

/**
 * A vertical scrim, used on Welcome to hold text legible over a photograph.
 *
 * Drawn with `react-native-svg`, matching `@towing/ui`'s `BottomScrim` and the
 * repo's standing decision not to add `expo-linear-gradient` for one gradient.
 * `BottomScrim` itself is not reusable here: it is bottom-anchored and always
 * ramps to full opacity, whereas this design needs a top scrim that fades white
 * to nothing and a bottom one that stops at 0.72.
 *
 * The stops are eased rather than linear. A straight ramp leaves the start of the
 * fade visible as a faint band across the image — the same problem, and the same
 * fix, that `BottomScrim` documents.
 */
const STOPS = [0, 0.25, 0.5, 0.75, 1];

export function MiScrim({ color, fromOpacity, toOpacity, style, id }: MiScrimProps) {
  return (
    <View pointerEvents="none" style={style}>
      <Svg width="100%" height="100%">
        <Defs>
          <LinearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            {STOPS.map((t) => (
              <Stop
                key={t}
                offset={t}
                stopColor={color}
                // Ease-in on the travel between the two opacities, so the
                // low-opacity end trails off instead of terminating on a line.
                stopOpacity={fromOpacity + (toOpacity - fromOpacity) * Math.pow(t, 1.6)}
              />
            ))}
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${id})`} />
      </Svg>
    </View>
  );
}
