import { useMemo } from 'react';
import type { TextStyle } from 'react-native';
import { useTheme } from '@towing/theme';
import type { MitowTypeToken } from '@/design';

/**
 * Figma text style "Board/Tagline" (03 Login tagline `259:1750`): Inter
 * SemiBold 10.5/13, letter spacing +0.5% = +0.0525px. The MiTow type scale has
 * no token for it.
 */
export const boardTagline: MitowTypeToken = {
  fontSize: 10.5,
  lineHeight: 13,
  letterSpacing: 0.0525,
  weight: 'semibold',
};

const roundHalf = (n: number) => Math.round(n * 2) / 2;

/**
 * The font part of a type token, scaled by `theme.scaleRatio` with exactly the
 * rounding `MiText` uses (half-pixel sizes, 0.05 tracking). For text `MiText`
 * cannot carry on its own: a style with no MiTow token, and `TextInput`.
 * Without it those drift from the scaled `MiText` copy around them on any
 * device whose ratio is not 1.
 */
export function useScaledTypeStyle(token: MitowTypeToken): TextStyle {
  const theme = useTheme();
  const ratio = theme.scaleRatio;
  const fontFamily = theme.fonts[token.weight];

  return useMemo(
    () => ({
      fontFamily,
      fontSize: ratio === 1 ? token.fontSize : roundHalf(token.fontSize * ratio),
      lineHeight: ratio === 1 ? token.lineHeight : roundHalf(token.lineHeight * ratio),
      letterSpacing:
        ratio === 1 ? token.letterSpacing : roundHalf(token.letterSpacing * ratio * 10) / 10,
    }),
    [fontFamily, ratio, token],
  );
}
