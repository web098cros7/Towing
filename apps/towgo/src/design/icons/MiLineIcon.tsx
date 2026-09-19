import React from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { SvgXml } from 'react-native-svg';
import { mitowColors } from '../tokens/colors';
import { lineIconSvgs, type MiLineIconName } from './lineIcons';

export type MiLineIconProps = {
  /** Figma icon/* name without the prefix, e.g. 'chevron-right' for icon/chevron-right. */
  name: MiLineIconName;
  /** Edge of the square box in px. Figma instances: 24 by default; 18, 20, 22, 25, 26, 28, 29, 30 where a spec says so. */
  size?: number;
  /** Tint for every stroke and fill that is the glyph colour. White knock-outs stay white. */
  color?: string;
  /**
   * Absolute stroke width in px, for an instance whose spec overrides the
   * component's own weight (e.g. 58's message icon at 2.1). Omit it to keep the
   * component's weight.
   */
  strokeWidth?: number;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
};

/**
 * A Figma line icon (MiTow · Components, icon/*) rendered from its exported SVG.
 *
 * ⚠ STROKE WIDTHS STAY ABSOLUTE WHEN THE ICON IS RESIZED, because that is what
 * Figma does: resizing an instance scales the paths but not the stroke weight.
 * A chevron-right drawn at 18 or 20 in the design is still 2.2 thick. The glyphs
 * are authored in a 24 viewBox, so each stroke-width is rewritten to
 * `width × 24 / size` for the drawn size, which renders at the original px.
 * (Letting SvgXml scale them made small icons visibly thin: 1.65 instead of 2.2
 * at 18, and screens had started building local copies to compensate.)
 *
 * Filled parts (the solid home, the calendar dots) scale with the box as usual.
 * Decorative by default (hidden from screen readers) unless `accessibilityLabel`
 * is given.
 */
export function MiLineIcon({
  name,
  size = 24,
  color = mitowColors.textPrimary,
  strokeWidth,
  style,
  accessibilityLabel,
}: MiLineIconProps) {
  const xml = React.useMemo(() => {
    const source = lineIconSvgs[name];
    if (size === 24 && strokeWidth === undefined) return source;
    const toViewBox = (px: number) => Math.round(((px * 24) / size) * 1000) / 1000;
    return source.replace(/stroke-width="([\d.]+)"/g, (_match, own: string) => {
      const px = strokeWidth ?? Number(own);
      return `stroke-width="${toViewBox(px)}"`;
    });
  }, [name, size, strokeWidth]);

  return (
    <View
      style={[{ width: size, height: size }, style]}
      accessible={!!accessibilityLabel}
      accessibilityLabel={accessibilityLabel}
      accessibilityElementsHidden={!accessibilityLabel}
      importantForAccessibility={accessibilityLabel ? 'yes' : 'no-hide-descendants'}
      pointerEvents="none"
    >
      <SvgXml xml={xml} width={size} height={size} color={color} />
    </View>
  );
}

export type { MiLineIconName };
