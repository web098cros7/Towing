import type { GeoPoint } from '@towing/api-contracts';

/**
 * The places the local geocoder knows.
 *
 * WHY A STATIC LIST AND NOT A TABLE. It is a development and degraded-mode
 * fallback, not a product surface: nobody administers it, nothing writes it, and
 * the moment a Places key exists it stops being the primary answer. A table
 * would need a migration, a seed, an admin CRUD nobody asked for, and a story
 * about what happens when the two sources disagree. `pricing.ts`'s launch matrix
 * earned a table because an admin genuinely tunes fares; this has not.
 *
 * COVERAGE IS THE TWO SEEDED CITIES ON PURPOSE. `db/seed/fixtures.ts` operates
 * in Bengaluru and Chennai, and every entry below sits inside one of the seeded
 * `service_zones` polygons except where marked — so a developer typing an
 * address gets somewhere the platform can actually dispatch to, and the one
 * deliberate exception exercises §9.1.5's "outside our service area" path.
 *
 * The first seven entries are the same places `apps/towgo/.../recentLocations.data.ts`
 * hardcoded as its preset list, at the same coordinates. That is deliberate: the
 * MiTow screen that used to read from that array now types against this, and a
 * coordinate that moved between the two would have made the switch look like a
 * pricing bug.
 */

export interface GazetteerEntry {
  /** Stable slug — `local:` prefixed on the wire so an id can never be mistaken for Google's. */
  id: string;
  name: string;
  /** The grey second line: locality and city. */
  area: string;
  city: string;
  point: GeoPoint;
  /** Extra spellings people actually type. Matched, never displayed. */
  aliases?: string[];
}

export const GAZETTEER: readonly GazetteerEntry[] = [
  // --- Bengaluru ----------------------------------------------------------
  { id: 'mg-road', name: 'MG Road', area: 'Bengaluru, Karnataka', city: 'Bengaluru', point: { lat: 12.9756, lng: 77.6068 }, aliases: ['mahatma gandhi road'] },
  { id: 'koramangala', name: 'Koramangala', area: '5th Block, Bengaluru', city: 'Bengaluru', point: { lat: 12.9345, lng: 77.6266 } },
  {
    // OUTSIDE the seeded Bengaluru polygon (lat 13.1986 > its 13.15 edge), and
    // kept that way. It is the one entry that reaches §9.1.5's "pin moved
    // outside zone" against a real 422 rather than a hypothetical one.
    id: 'blr-airport',
    name: 'Kempegowda Intl. Airport',
    area: 'Devanahalli, Bengaluru',
    city: 'Bengaluru',
    point: { lat: 13.1986, lng: 77.7066 },
    aliases: ['kia', 'bangalore airport', 'blr airport'],
  },
  { id: 'hsr-layout', name: 'HSR Layout', area: 'Sector 2, Bengaluru', city: 'Bengaluru', point: { lat: 12.9116, lng: 77.6389 } },
  { id: 'indiranagar', name: 'Indiranagar', area: '100 Feet Road, Bengaluru', city: 'Bengaluru', point: { lat: 12.9784, lng: 77.6408 } },
  { id: 'whitefield', name: 'Whitefield', area: 'ITPL Main Road, Bengaluru', city: 'Bengaluru', point: { lat: 12.9855, lng: 77.7367 }, aliases: ['itpl'] },
  { id: 'majestic', name: 'Majestic Bus Stand', area: 'Kempegowda, Bengaluru', city: 'Bengaluru', point: { lat: 12.9776, lng: 77.5713 }, aliases: ['kempegowda bus station'] },
  { id: 'jayanagar', name: 'Jayanagar', area: '4th Block, Bengaluru', city: 'Bengaluru', point: { lat: 12.9250, lng: 77.5938 } },
  { id: 'electronic-city', name: 'Electronic City', area: 'Phase 1, Bengaluru', city: 'Bengaluru', point: { lat: 12.8452, lng: 77.6602 }, aliases: ['ecity'] },
  { id: 'marathahalli', name: 'Marathahalli', area: 'Outer Ring Road, Bengaluru', city: 'Bengaluru', point: { lat: 12.9591, lng: 77.6974 } },
  { id: 'yeshwanthpur', name: 'Yeshwanthpur', area: 'Tumkur Road, Bengaluru', city: 'Bengaluru', point: { lat: 13.0287, lng: 77.5540 } },
  { id: 'banashankari', name: 'Banashankari', area: '2nd Stage, Bengaluru', city: 'Bengaluru', point: { lat: 12.9250, lng: 77.5667 } },
  { id: 'hebbal', name: 'Hebbal', area: 'Bellary Road, Bengaluru', city: 'Bengaluru', point: { lat: 13.0358, lng: 77.5970 } },
  { id: 'hosur-road', name: 'Hosur Road', area: 'NH-44 corridor, Bengaluru', city: 'Bengaluru', point: { lat: 12.8698, lng: 77.6500 }, aliases: ['nh44', 'nh-44'] },

  // --- Chennai ------------------------------------------------------------
  { id: 'anna-nagar', name: 'Anna Nagar', area: 'Chennai, Tamil Nadu', city: 'Chennai', point: { lat: 13.0850, lng: 80.2101 } },
  { id: 't-nagar', name: 'T. Nagar', area: 'Chennai, Tamil Nadu', city: 'Chennai', point: { lat: 13.0418, lng: 80.2341 }, aliases: ['thyagaraya nagar'] },
  { id: 'adyar', name: 'Adyar', area: 'Chennai, Tamil Nadu', city: 'Chennai', point: { lat: 13.0067, lng: 80.2570 } },
  { id: 'velachery', name: 'Velachery', area: 'Chennai, Tamil Nadu', city: 'Chennai', point: { lat: 12.9791, lng: 80.2210 } },
  { id: 'guindy', name: 'Guindy', area: 'Chennai, Tamil Nadu', city: 'Chennai', point: { lat: 13.0067, lng: 80.2206 } },
  { id: 'chennai-central', name: 'Chennai Central', area: 'Park Town, Chennai', city: 'Chennai', point: { lat: 13.0827, lng: 80.2755 }, aliases: ['central station'] },
  { id: 'omr', name: 'OMR', area: 'Old Mahabalipuram Road, Chennai', city: 'Chennai', point: { lat: 12.9010, lng: 80.2279 }, aliases: ['old mahabalipuram road', 'rajiv gandhi salai'] },
];

/** `local:` prefixed so an id can never be mistaken for — or fed to — Google's. */
export const LOCAL_PLACE_PREFIX = 'local:';
