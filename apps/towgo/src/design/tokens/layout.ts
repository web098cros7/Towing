import type { ViewStyle } from 'react-native';

/**
 * MiTow metrics, authored on the 393×852 iPhone 16 frame and used as-is.
 *
 * ⚠ Do NOT apply the ×1.1026 correction from `tokens/reference.ts` to these:
 * the MiTow boards were authored natively at 393.
 */
export const mitowLayout = {
  /** Horizontal page margin (21 on every screen). */
  sideMargin: 21,
  /** Vertical gap between content blocks (sheet gap). */
  blockGap: 16,
  /** Gap between a heading and the content it introduces. */
  headingGap: 12,
  /** Top of the content column (Figma y 49, directly under the 50 status bar). */
  contentTop: 49,

  /** CTA button height as instanced on screens (Primary Button master is 50; Home "Book a Tow" keeps 50). */
  controlHeight: 54,
  /** Text Field input box height. */
  inputHeight: 56,
  /** OTP Cell (281:1732) size. */
  otpCell: { width: 48, height: 56 },
  /** Segment (243:837) height. */
  segmentHeight: 40,
  /** Nav Bar (258:1437) height. */
  navBarHeight: 46,

  /** Modal sheet padding: 14 top, 21 sides, 34 bottom. */
  sheetPadTop: 14,
  sheetPadBottom: 34,
  /** Sheet grabber bar: 36×5, radius 2.5, border/handle. */
  handle: { width: 36, height: 5 },
  /** Selector pill height ("Pickup now", "For me"). */
  pillHeight: 32,
  /** Radio option row minimum height (screens 11/12). */
  optionRowHeight: 60,
  /** Tab bar height excluding safe area (Home in-sheet bar is 70; pinned bar is 84 incl. indicator zone). */
  tabBarHeight: 70,
  /** Service Tile circle (224:23). */
  serviceCircle: 68,
  /** Service Card (258:1481) height as drawn. */
  serviceCardHeight: 117,
} as const;

/** Corner radii. Not viewport-scaled. */
export const mitowRadii = {
  /** Primary / Secondary Button. */
  button: 14,
  /** Text Field input box. */
  input: 14,
  otpCell: 12,
  segment: 10,
  /** Map Callout bubble. */
  callout: 10,
  /** Cards: Locations card, trip card, Vehicle Card, Menu Card as instanced on 06/10. */
  card: 16,
  /** Info Banner, Service Card, Menu Card master. */
  cardSm: 14,
  image: 16,
  /** Sheet top corners. */
  sheet: 24,
  /** Pills, chips, circles. */
  pill: 999,
} as const;

/**
 * Figma effect styles `MiTow/Elevation/*`, reproduced EXACTLY with React
 * Native's `boxShadow` (RN 0.76+, New Architecture — this app is RN 0.86).
 * `boxShadow` takes every layer, on both platforms, with the Figma blur value
 * as-is (Figma's CSS export writes the same `box-shadow` numbers).
 *
 * Spread these into a style: `style={{ ...mitowShadows.floating }}`.
 * Never combine with legacy `shadow*` / `elevation` on the same node.
 */
export const mitowShadows = {
  /** MiTow/Elevation/Sheet: 0 -6 blur 24, #101828 at 8%. */
  sheet: { boxShadow: '0px -6px 24px 0px rgba(16, 24, 40, 0.08)' },
  /** MiTow/Elevation/Card: 0 1 blur 2, #101828 at 4%. */
  card: { boxShadow: '0px 1px 2px 0px rgba(16, 24, 40, 0.04)' },
  /** MiTow/Elevation/Floating: 0 1 blur 3 at 6% + 0 6 blur 16 at 10%, #101828. */
  floating: {
    boxShadow: '0px 1px 3px 0px rgba(16, 24, 40, 0.06), 0px 6px 16px 0px rgba(16, 24, 40, 0.1)',
  },
} as const satisfies Record<string, ViewStyle>;
