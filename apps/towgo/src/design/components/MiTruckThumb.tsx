import React from 'react';
import { Image, type ImageSourcePropType, type StyleProp, type ImageStyle } from 'react-native';

/**
 * Figma Truck Thumb `238:490` as instanced in 20's Status card (`I239:567;224:15`):
 * 49 × 49, radius 10, clips, image fill (the 2048 × 1360 truck render, CROP
 * `[[0.06592,0,0.38931],[0,0.06801,0.73029]]` → source x 797, y 993, 135 × 92 px).
 *
 * Baked exactly as Figma renders the RESIZED instance: the 135 × 92 region stretched
 * non-uniformly into the square (the truck reads slightly narrow, as drawn), with the
 * radius-10 corners transparent. @1x/@2x/@3x = 49 / 98 / 147 px, RGBA, corner alpha 0.
 * It is an image, not a colour icon; never use the flat shield SVG `get_design_context`
 * returns for this node.
 *
 * Only the 49 × 49 instance is baked. The 104 × 72 master (a different stretch) is not.
 */
export const truckThumbSource: ImageSourcePropType = require('../../assets/images/truck-thumb.png');

export type MiTruckThumbProps = {
  /** Edge of the square. Default 49 (the only drawn instance size). */
  size?: number;
  style?: StyleProp<ImageStyle>;
};

/**
 * The thumbnail on its own. In 20's Status card pass the SOURCE to `MiInfoBanner`
 * instead: `<MiInfoBanner icon={truckThumbSource} iconSize={49} … />` (its icon slot
 * draws a `contain` image in a square, which fills exactly for this square asset).
 */
export function MiTruckThumb({ size = 49, style }: MiTruckThumbProps) {
  return (
    <Image
      source={truckThumbSource}
      resizeMode="stretch"
      style={[{ width: size, height: size }, style]}
      accessibilityIgnoresInvertColors
      accessibilityElementsHidden
      importantForAccessibility="no"
    />
  );
}
