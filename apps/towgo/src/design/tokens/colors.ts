/**
 * MiTow colour tokens — the Figma variable collection "MiTow · Color"
 * (file P7CqHnGxNFOpA6AZN9CXaH, read with get_variable_defs on section 218:2).
 *
 * Every value is copied from Figma. The comment on each key is its Figma
 * variable name, so a screen spec that says `text/secondary` maps to
 * `mitowColors.textSecondary` without guessing.
 *
 * A plain constants object rather than an extension of `@towing/theme`: the
 * shared theme is compiled by BOTH apps, and `brandYellow` here is not
 * `theme.colors.brand` (#FFB800). MiTow is hard-locked to light mode.
 */
export const mitowColors = {
  /** brand/yellow */
  brandYellow: '#FCC30B',
  /** brand/yellow-soft — a surface, never text. */
  brandYellowSoft: '#FDF6DC',

  /** text/primary */
  textPrimary: '#0B0C0E',
  /** text/secondary */
  textSecondary: '#4A5568',
  /** text/brand — inline links ("Clear recents", "Edit", "Terms of Service"). */
  textBrand: '#9A6A00',
  /** text/on-dark */
  textOnDark: '#FFFFFF',
  /** text/placeholder */
  textPlaceholder: '#6B7485',

  /** surface/page */
  surfacePage: '#FFFFFF',
  /** surface/inverse — dark CTA fill, map callout bubble, the sheet dim (at 45%). */
  surfaceInverse: '#111316',
  /** surface/muted — service circles, pills, disabled field fill. */
  surfaceMuted: '#F3F5F8',
  /** surface/canvas — the Login page background (screen 03). */
  surfaceCanvas: '#F3F6F8',

  /** border/subtle */
  borderSubtle: '#ECEFF3',
  /** border/handle — sheet grabber, Secondary Button Tone=Subtle border. */
  borderHandle: '#CCD2DA',

  /** status/success */
  success: '#39AB5A',
  /** status/success-soft */
  successSoft: '#E4F5E9',
  /** status/success-text — the fare breakdown's discount line. */
  successText: '#237A42',
  /** status/danger — Text Field State=Error border. */
  danger: '#E5484D',
  /** status/danger-soft */
  dangerSoft: '#FDECEC',
  /** status/danger-text — Text Field State=Error helper text. */
  dangerText: '#C0343A',
  /** status/warning-text (same value as text/brand). */
  warningText: '#9A6A00',

  /** accent/blue */
  accentBlue: '#3C87F0',

  /** The Figma "Dim" layer: surface/inverse #111316 at 45% layer opacity. */
  dim: 'rgba(17,19,22,0.45)',
} as const;

export type MitowColor = keyof typeof mitowColors;
