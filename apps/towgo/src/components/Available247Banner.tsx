import React from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import { MiInfoBanner } from '@/design';

/**
 * Figma 09 · Roadside Assistance, "Available 24/7" banner (`259:1738`, an
 * instance of Info Banner `224:14`).
 *
 * - Icon slot swapped to icon/color/verified (`323:5546`) at 49.
 * - Copy overridden to "Available 24/7" / "We're here to get you moving."
 *   (straight apostrophe, full stop).
 * - The master's trailing chevron is hidden on this instance and the banner is
 *   not tappable, so it takes no `onPress`.
 */
export function Available247Banner({ style }: { style?: StyleProp<ViewStyle> } = {}) {
  return (
    <MiInfoBanner
      icon="verified"
      iconSize={49}
      title="Available 24/7"
      subtitle="We're here to get you moving."
      showChevron={false}
      style={style}
    />
  );
}
