import type { TextStyle } from 'react-native';
import { mitowType, type MitowTypeVariant } from '@/design';

/**
 * Figma draws 02 · Welcome on one 393-wide frame with fixed type: tagline
 * Heading 18 (18/24/-0.36), button labels Strong 16 (16/21/-0.32), footer
 * Body S 14 (14/19/-0.21).
 *
 * `MiText` multiplies size, line height and tracking by `theme.scaleRatio`
 * (width / 390, clamped 0.88–1.06). Even at 393 that renders -0.35 / -0.30 /
 * -0.20, and on a 360dp Android phone it shrinks the tagline to 16.5/22. Passed
 * as `style` (which `MiText` applies after its own scaled values), this puts the
 * Figma style's own numbers back, so every width renders the drawn type.
 */
export function fixedType(variant: MitowTypeVariant): TextStyle {
  const token = mitowType[variant];
  return {
    fontSize: token.fontSize,
    lineHeight: token.lineHeight,
    letterSpacing: token.letterSpacing,
  };
}
