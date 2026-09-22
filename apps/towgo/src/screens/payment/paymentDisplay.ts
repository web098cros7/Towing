import { useTheme } from '@towing/theme';
import { mitowType, type MitowTypeVariant } from '@/design';
import { clockLabel } from '@/screens/booking/tracking/trackingDisplay';

/** English three-letter months, as 30 draws them ("12 Mar 2025"). Not `Intl`: Hermes quirks. */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * 30's Date & Time value, "12 Mar 2025, 10:52 AM": the day with no leading zero, the month, the
 * year, ", ", then 18's `clockLabel` (12-hour, no leading zero, capital AM / PM). Device-local.
 * `null` for an unreadable instant, so the row keeps its placeholder bar instead of "NaN".
 */
export function paidAtLabel(iso: string): string | null {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return null;
  const date = new Date(ms);
  return `${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}, ${clockLabel(ms)}`;
}

/**
 * The height Figma gives one line of a fractional line height: it boxes MiTow/Label 13 (16.5)
 * at 17, which 27's secure-note line (229 × 17) and 28's validity lines (rows 63.4 / 82.4 tall)
 * depend on. The same rule as the design layer's internal `useFigmaLineBox` (not exported from
 * `@/design`): scaled with `theme.scaleRatio` as `MiText` rounds it, then rounded up.
 */
export function useLineBox(variant: MitowTypeVariant): number {
  const ratio = useTheme().scaleRatio;
  const lineHeight = mitowType[variant].lineHeight;
  const scaled = ratio === 1 ? lineHeight : Math.round(lineHeight * ratio * 2) / 2;
  return Math.ceil(scaled);
}
