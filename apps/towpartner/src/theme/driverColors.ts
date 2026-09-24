/**
 * MiTow Driver accent palette.
 *
 * The driver app reuses the shared @towing/theme for everything structural
 * (surfaces, text, borders, spacing, radii, typography, shadows, the amber
 * brand used by shared primitives like Button). These are the *extra* accents
 * the driver Figma introduces — the gold FAB, the orange link/active accent,
 * the online-status greens, the cream hero fills, and the coloured icon-chip
 * families — that don't exist as semantic tokens in the shared theme.
 *
 * Kept as a plain constants object (not a theme extension) because the app is
 * locked to light mode; if a dark driver design lands, promote these to the
 * theme package instead.
 */
export const driverColors = {
  /** Gold — the center FAB and gold circular icon backgrounds. */
  gold: '#FACC15',
  /** Deep amber — New Job CTAs, banner pin, offer pill and countdown (Figma 78:197). */
  amber: '#F5A212',
  /** Orange — links ("View All"), the active tab, small accents. */
  accent: '#FB923C',
  /** Online-status greens. */
  online: '#16A34A',
  onlineDot: '#22C55E',

  /** Cream hero-card fill (a solid stand-in for the subtle Figma gradient). */
  heroBg: '#FBF4E6',
  heroFrom: '#FAF3E6',
  heroTo: '#F7ECD9',
  /** Profile hero card fill + the ring behind the avatar photo. */
  profileCardBg: '#FDF6EC',
  avatarRing: '#F4E3C8',
  /** New Job notice banner + the cream circle behind the car illustration. */
  noticeBg: '#FDF3E0',

  /** Right-chevron on list rows. */
  chevron: '#D1D5DB',

  /** Coloured circular icon-chip families: soft background + solid glyph. */
  chip: {
    gold: { bg: '#FEF0D9', fg: '#EA9A0B' },
    orange: { bg: '#FFEDD5', fg: '#F97316' },
    green: { bg: '#DCFCE7', fg: '#16A34A' },
    blue: { bg: '#DBEAFE', fg: '#3B82F6' },
    purple: { bg: '#F3E8FF', fg: '#A855F7' },
    indigo: { bg: '#EEF1F8', fg: '#312E81' },
    red: { bg: '#FEE2E2', fg: '#DC2626' },
    slate: { bg: '#F3F4F6', fg: '#374151' },
  },

  /** Home "Quick Actions" tile background tints. */
  tile: {
    cream: '#FAF3E6',
    mint: '#EEF5EE',
    blue: '#EEF1F8',
    purple: '#F0EEF8',
  },
} as const;

export type ChipTone = keyof typeof driverColors.chip;

// The job-status → label/tone/icon map lives in `features/jobs/statusMeta.ts`,
// the domain owner of that vocabulary. A partial copy used to sit here and
// covered only 3 of the contract's 10 statuses.
