import React from 'react';
import { Image, View, type ImageSourcePropType } from 'react-native';
import { mitowRadii } from '../tokens/layout';

export type MiIllustrationProps = {
  source: ImageSourcePropType;
  /** The design slot's width ÷ height, e.g. `351 / 133` for the login hero. */
  aspectRatio: number;
  accessibilityLabel?: string;
  radius?: number;
};

/**
 * A full-width illustration locked to its design slot's aspect ratio.
 *
 * ⚠ THIS EXISTS BECAUSE THE OBVIOUS VERSION IS BROKEN. Putting `width: '100%'`
 * and `aspectRatio` straight onto an `<Image>` does NOT work for a `require()`d
 * asset: the bundled image carries intrinsic dimensions, and React Native sizes
 * the node from those rather than from `aspectRatio`. The login hero
 * (1053×399) rendered ~399dp tall instead of 133, and `resizeMode="cover"` then
 * cropped the sides hard enough to cut the tow truck out of frame — seen on
 * device, 17 Sep 2026.
 *
 * The fix is to let a plain `View` own the ratio (a View has no intrinsic size,
 * so `aspectRatio` wins) and give the Image BOTH dimensions as 100%, leaving it
 * nothing to infer. The radius and `overflow: 'hidden'` also live on the View —
 * Android does not reliably clip a rounded corner on an Image itself.
 */
export function MiIllustration({
  source,
  aspectRatio,
  accessibilityLabel,
  radius = mitowRadii.image,
}: MiIllustrationProps) {
  return (
    <View style={{ width: '100%', aspectRatio, borderRadius: radius, overflow: 'hidden' }}>
      <Image
        source={source}
        resizeMode="cover"
        style={{ width: '100%', height: '100%' }}
        accessibilityIgnoresInvertColors
        accessibilityLabel={accessibilityLabel}
        accessibilityElementsHidden={!accessibilityLabel}
        importantForAccessibility={accessibilityLabel ? 'yes' : 'no'}
      />
    </View>
  );
}
