import type { MiColorIconName } from '@/design';

/**
 * The six Service Cards on Figma 09 (`259:1627`), in grid order (left to right,
 * top to bottom). Titles are the design's copy verbatim; `slug` is the
 * `services.slug` the booking store is seeded with when the card is tapped.
 *
 * Every slug has a catalogue row and a server fare, `lockout` included (migration
 * 0035 added it as a flat roadside service; its ₹799 fare is a placeholder until
 * Ehsan sets it).
 */
export type RoadsideServiceSlug =
  'flat_tyre' | 'battery' | 'fuel' | 'lockout' | 'breakdown' | 'car_tow';

export type RoadsideService = {
  slug: RoadsideServiceSlug;
  title: string;
  /** icon/color/* component drawn at 64. `tow-truck` uses the detached overflowing art instead. */
  icon: MiColorIconName;
};

export const ROADSIDE_SERVICES: readonly RoadsideService[] = [
  { slug: 'flat_tyre', title: 'Flat Tyre Support', icon: 'tyre' },
  { slug: 'battery', title: 'Battery Jump Start', icon: 'battery' },
  { slug: 'fuel', title: 'Out of Fuel', icon: 'fuel-pump' },
  { slug: 'lockout', title: 'Car Lockout', icon: 'lock' },
  // The catalogue calls this row "Breakdown assistance"; the design's label wins on screen.
  { slug: 'breakdown', title: 'Minor Mechanical Help', icon: 'wrench' },
  { slug: 'car_tow', title: 'Tow a Car', icon: 'tow-truck' },
];
