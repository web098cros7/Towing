/**
 * The MiTow redesign layer — import root `@/design`.
 *
 * tokens/      colours, type, layout, radii, elevation (exact Figma values)
 * icons/       MiLineIcon (Figma icon/* glyphs) + colour icon registry (icon/color/*)
 * components/  shared Figma components (MiTow · Components, section 218:2)
 * illustrations/  exported SVG illustrations (34's empty state)
 *
 * Reference: scratchpad mitow-specs/FOUNDATION.md.
 */
export * from './tokens';
export * from './icons';
export * from './components';
export * from './illustrations';
