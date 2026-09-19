import React from 'react';
import { MiText, mitowType, type MiTextProps } from '@/design';

/**
 * `MiText` at the Figma text style's exact metrics.
 *
 * `MiText` multiplies size, line height and letter spacing by `theme.scaleRatio`
 * (width ÷ 390, clamped 0.88–1.06, then rounded), so on a 393 or 411dp phone
 * "Display 34" renders 34.5/40.5 or 36/42 and the consent paragraph re-wraps.
 * 06 Consent draws fixed type (Display 34 is 34/40 at -0.85, Body L 15.5/21 at
 * -0.31 …), so this passes the unscaled token values back in as a style
 * override. Colour, weight and the Inter family still come from `MiText`.
 */
export function ExactText({ variant = 'bodyM15', style, ...rest }: MiTextProps) {
  const token = mitowType[variant];
  return (
    <MiText
      variant={variant}
      style={[
        {
          fontSize: token.fontSize,
          lineHeight: token.lineHeight,
          letterSpacing: token.letterSpacing,
        },
        style,
      ]}
      {...rest}
    />
  );
}
