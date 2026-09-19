import React from 'react';
import {
  Image,
  View,
  type ImageSourcePropType,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { colorIconSources, type MiColorIconName } from '../icons/colorIcons';

export type MiColorIconProps = {
  /** Figma icon/color/<name>, e.g. 'tow-truck'. Preferred over `source`. */
  name?: MiColorIconName;
  /** @deprecated A require()d image. Use `name`. */
  source?: ImageSourcePropType;
  /** Edge of the square box (the instance size in Figma: 18, 20, 24, 28, 32, 34, 36, 40, 49, 50, 56, 64 …). */
  size: number;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
};

/**
 * A Figma colour icon (icon/color/*). Each is a 48pt square with the art
 * centred and NO background; the PNGs are transparent 192×192 exports, so
 * `contain` in a square box of the instance size reproduces the design.
 *
 * Both dimensions are set explicitly: a require()d Image sized by only one
 * dimension renders at its intrinsic 192.
 */
export function MiColorIcon({ name, source, size, style, accessibilityLabel }: MiColorIconProps) {
  const resolved = name ? colorIconSources[name] : source;
  return (
    <View style={[{ width: size, height: size }, style]}>
      {resolved ? (
        <Image
          source={resolved}
          resizeMode="contain"
          style={{ width: '100%', height: '100%' }}
          accessibilityIgnoresInvertColors
          accessibilityLabel={accessibilityLabel}
          accessibilityElementsHidden={!accessibilityLabel}
          importantForAccessibility={accessibilityLabel ? 'yes' : 'no'}
        />
      ) : null}
    </View>
  );
}
