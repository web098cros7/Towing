import { darkTheme, lightTheme } from '@towing/theme/tokens';
import { fleetAccent } from '@towing/web-ui';
import type { ThemeMode } from '@/lib/useThemeMode';

/**
 * Literal hex for the map layers.
 *
 * MapLibre paints into WebGL and cannot resolve CSS custom properties, so
 * `var(--success)` — which works fine for the Recharts SVG props elsewhere in
 * this app — silently renders nothing here. Reading the token objects directly
 * keeps the map on the same palette as every badge without a runtime
 * getComputedStyle parse.
 */
export interface MapColors {
  background: string;
  zoneFill: string;
  zoneLine: string;
  /** Truck marker fills, by what the operator needs to distinguish (§9.3.3). */
  onJob: string;
  idle: string;
  nonCompliant: string;
  inactive: string;
  /** Presence overlay (§11.6): stale is dimmed, offline is grey. */
  stale: string;
  offline: string;
  markerStroke: string;
  text: string;
}

export function mapColors(mode: ThemeMode): MapColors {
  const theme = mode === 'dark' ? darkTheme : lightTheme;
  const accent = mode === 'dark' ? fleetAccent.dark : fleetAccent.light;

  return {
    background: theme.colors.mapBg,
    // Zones are context, never the subject — a tinted wash, not a filled shape.
    zoneFill: theme.colors.info,
    zoneLine: theme.colors.divider,
    // §9.3.3 asks for "on job / idle / offline / non-compliant". On-job takes
    // the brand accent so the eye lands on working trucks first.
    onJob: accent.brand ?? theme.colors.info,
    idle: theme.colors.success,
    nonCompliant: theme.colors.error,
    inactive: theme.colors.textTertiary,
    stale: theme.colors.warning,
    offline: theme.colors.textTertiary,
    markerStroke: theme.colors.card,
    text: theme.colors.textPrimary,
  };
}
