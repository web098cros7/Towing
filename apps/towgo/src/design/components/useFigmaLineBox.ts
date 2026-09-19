import { useTheme } from '@towing/theme';
import { mitowType, type MitowTypeVariant } from '../tokens/type';

/**
 * Figma boxes a single line of a fractional line height at the next whole pixel:
 * MiTow/Label 13 (16.5) is a 17-tall text box, which is why 22's Day pill is 25
 * (4 + 17 + 4) and its bubbles 80 / 60. RN lays the line out at 16.5, so a text that
 * must reproduce the drawn box takes this as its `minHeight`.
 *
 * Scales with `theme.scaleRatio` exactly as `MiText` rounds (half pixels), then rounds
 * up. Internal to the design layer (not exported from the index).
 */
export function useFigmaLineBox(variant: MitowTypeVariant): number {
  const ratio = useTheme().scaleRatio;
  const lineHeight = mitowType[variant].lineHeight;
  const scaled = ratio === 1 ? lineHeight : Math.round(lineHeight * ratio * 2) / 2;
  return Math.ceil(scaled);
}
