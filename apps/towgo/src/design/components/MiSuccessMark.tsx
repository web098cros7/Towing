import React from 'react';
import { Image, type ImageSourcePropType, type StyleProp, type ImageStyle } from 'react-native';

/**
 * Figma Success Mark `243:896` (200 × 115): an 81 status/success #39AB5A circle centred at
 * (97.7, 58.4) with a 6-wide white check `M83.2 58.9 L93.1 69.3 L113 47.9` (round caps and
 * joins), and eight 11.6 × 4.6 radius-1.2 confetti bars in brand/yellow #FCC30B, accent/blue
 * #3C87F0 and status/success. Rasterized with sharp 0.34.5 from the component's SVG export
 * (`30-assets/success-mark.svg`) at 200 × 115 / 400 × 230 / 600 × 345, never from a Figma PNG
 * export (those carry a white background); all four corners are alpha 0.
 */
export const successMarkSource: ImageSourcePropType = require('../../assets/images/success-mark.png');

/**
 * Props for {@link MiSuccessMark}.
 */
export type MiSuccessMarkProps = {
  /** Position it. The size is fixed at 200 × 115, as drawn. */
  style?: StyleProp<ImageStyle>;
};

/**
 * The mark on its own: 30 · Payment Successful (instance `245:1018`, no overrides); 31 and 32
 * draw the same component. Decorative (the title says it). Static: no animation is drawn.
 * Centre it in its row (`<View style={{ alignItems: 'center' }}>`). The check circle sits 2.3
 * left of the mark's centre, as drawn, so do not re-centre the art.
 */
export function MiSuccessMark({ style }: MiSuccessMarkProps) {
  return (
    <Image
      source={successMarkSource}
      resizeMode="stretch"
      style={[{ width: 200, height: 115 }, style]}
      accessibilityIgnoresInvertColors
      accessibilityElementsHidden
      importantForAccessibility="no"
    />
  );
}
