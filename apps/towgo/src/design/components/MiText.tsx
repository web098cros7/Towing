import React from 'react';
import { Text as RNText, type TextProps as RNTextProps, type TextStyle } from 'react-native';
import { useTheme, type FontWeightKey } from '@towing/theme';
import { mitowColors } from '../tokens/colors';
import { mitowType, type MitowTypeVariant } from '../tokens/type';

export type MiTextColor =
  'primary' | 'secondary' | 'brand' | 'onDark' | 'placeholder' | 'yellow' | 'success' | 'danger';

export type MiTextProps = RNTextProps & {
  variant?: MitowTypeVariant;
  color?: MiTextColor;
  /**
   * Overrides the variant's own weight. The design sets semibold spans inside
   * regular body copy — the consent paragraph's policy links, the verified
   * phone number on the OTP screen. Figma carries those as inline overrides
   * rather than named text styles, so this mirrors that instead of minting a
   * token for every weight/size pairing.
   */
  weight?: FontWeightKey;
  align?: TextStyle['textAlign'];
};

/**
 * Text for the MiTow redesign. The `@towing/ui` `Text` is not reusable here:
 * its `variant` is typed to `@towing/theme`'s `TypographyVariant`, and widening
 * that union to carry MiTow's names would change a type the driver app compiles
 * against.
 *
 * Scaling deliberately reuses `theme.scaleRatio` — the SAME clamped 0.88–1.06
 * ratio the rest of the app already scales by — rather than introducing a second
 * scaling authority. Sizes round to the half pixel, as `packages/theme/src/tokens/scale.ts`
 * does. Tracking rounds to 0.01, NOT the shared 0.05: the reference width is 390
 * and the design is drawn at 393, so on an iPhone 16 the ratio is 1.0077, and
 * 0.05 steps turned Figma's -0.32 / -0.21 / -0.28 into -0.30 / -0.20 / -0.30.
 *
 * No legibility floor is applied: the smallest token here is 13, which is 11.4 at
 * the minimum ratio — comfortably above the shared `MIN_FONT_SIZE` of 10.
 */
const roundHalf = (n: number) => Math.round(n * 2) / 2;

export function MiText({
  variant = 'bodyM15',
  color = 'primary',
  weight,
  align,
  style,
  children,
  ...rest
}: MiTextProps) {
  const theme = useTheme();
  const token = mitowType[variant];
  const ratio = theme.scaleRatio;

  const colorMap: Record<MiTextColor, string> = {
    primary: mitowColors.textPrimary,
    secondary: mitowColors.textSecondary,
    brand: mitowColors.textBrand,
    onDark: mitowColors.textOnDark,
    placeholder: mitowColors.textPlaceholder,
    yellow: mitowColors.brandYellow,
    // A credit, not a charge — the fare breakdown's discount line. The only
    // status colour in the scale so far.
    success: mitowColors.successText,
    // status/danger-text — Text Field State=Error helper.
    danger: mitowColors.dangerText,
  };

  const textStyle: TextStyle = {
    fontFamily: theme.fonts[weight ?? token.weight],
    fontSize: ratio === 1 ? token.fontSize : roundHalf(token.fontSize * ratio),
    lineHeight: ratio === 1 ? token.lineHeight : roundHalf(token.lineHeight * ratio),
    letterSpacing:
      ratio === 1 ? token.letterSpacing : Math.round(token.letterSpacing * ratio * 100) / 100,
    color: colorMap[color],
    textAlign: align,
  };

  return (
    // Same 1.2 cap as `@towing/ui`'s Text — accessibility sizes enlarge copy
    // without breaking the tight 393dp layouts this design is built on.
    <RNText maxFontSizeMultiplier={1.2} style={[textStyle, style]} {...rest}>
      {children}
    </RNText>
  );
}
