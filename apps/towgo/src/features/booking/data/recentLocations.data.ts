export type RecentLocation = {
  id: string;
  /** Menu row title (Figma 10 `238:530`), e.g. "Kempegowda Intl. Airport". */
  name: string;
  /** Menu row subtitle (Figma 10 `238:531`), e.g. "KIAL Rd, Devanahalli, Bengaluru". */
  address: string;
  /**
   * Real coordinates for the named place.
   *
   * Added in Phase 14: `POST /v1/pricing/estimate` point-in-polygons the pickup
   * against `service_zones` and measures the drop, so a location with no
   * coordinate cannot be priced at all. Places autocomplete (`placesMockSource`)
   * still searches this list in mock mode.
   */
  coords: { latitude: number; longitude: number };
  /**
   * ⚠ APP-LOCAL OPTIONAL EXTENSION. What picking this place writes into Figma
   * 10's Pickup / Drop value, drawn as "<place>, <city>" ("MG Road, Bengaluru").
   * The mock rows carry it (the same display titles screen 13 shows for these
   * presets); a row without one writes its `name`.
   */
  value?: string;
};

/**
 * A saved place as Figma 10's "Saved & Recent" draws it: a kind that picks the
 * colour icon (home → icon/color/home, work → icon/color/briefcase), a title and
 * an address line.
 *
 * ⚠ APP-LOCAL SHAPE. `SavedAddress` in the contracts has a free-text `label`
 * and no kind, so against the real backend the kind is read from the label
 * ("Home" / "Work"); in mock mode the rows below are used as drawn.
 */
export type SavedLocationKind = 'home' | 'work';

export type SavedLocation = RecentLocation & { kind: SavedLocationKind };

/** The value a picked place writes into the Pickup / Drop field. */
export function locationValue(place: RecentLocation): string {
  return place.value ?? place.name;
}

/** The mock gazetteer: Places autocomplete and reverse geocoding search this in mock mode. */
export const recentLocations: RecentLocation[] = [
  {
    id: 'r1',
    name: 'MG Road',
    address: 'Bengaluru, Karnataka, India',
    coords: { latitude: 12.9756, longitude: 77.6068 },
    value: 'MG Road, Bengaluru',
  },
  {
    id: 'r2',
    name: 'Koramangala',
    address: '5th Block, Bengaluru, Karnataka',
    coords: { latitude: 12.9345, longitude: 77.6266 },
    value: 'Koramangala, Bengaluru',
  },
  // Deliberately kept although it sits OUTSIDE the seeded Bengaluru zone
  // (lat 13.1986 > the polygon's 13.15 edge): it is the one entry that
  // exercises §9.1.5's "pin moved outside zone" path against a real 422.
  {
    id: 'r3',
    name: 'Kempegowda Intl. Airport',
    address: 'KIAL Rd, Devanahalli, Bengaluru',
    coords: { latitude: 13.1986, longitude: 77.7066 },
    value: 'Kempegowda Intl. Airport',
  },
  {
    id: 'r4',
    name: 'HSR Layout',
    address: 'Sector 2, HSR Layout, Bengaluru',
    coords: { latitude: 12.9116, longitude: 77.6389 },
    value: 'HSR Layout, Bengaluru',
  },
  {
    id: 'r5',
    name: 'Indiranagar',
    address: '100 Feet Road, Bengaluru',
    coords: { latitude: 12.9784, longitude: 77.6408 },
    value: 'Indiranagar, Bengaluru',
  },
  {
    id: 'r6',
    name: 'Whitefield',
    address: 'ITPL Main Road, Bengaluru',
    coords: { latitude: 12.9855, longitude: 77.7367 },
    value: 'Whitefield, Bengaluru',
  },
  {
    id: 'r7',
    name: 'Majestic Bus Stand',
    address: 'Kempegowda, Bengaluru',
    coords: { latitude: 12.9776, longitude: 77.5713 },
    value: 'Majestic, Bengaluru',
  },
];

/** Figma 10 rows 1-2: the customer's saved Home and Work (mock). */
export const savedLocations: SavedLocation[] = [
  {
    id: 's-home',
    kind: 'home',
    name: 'Home',
    address: 'MG Road, Bengaluru',
    coords: { latitude: 12.9752, longitude: 77.605 },
    value: 'MG Road, Bengaluru',
  },
  {
    id: 's-work',
    kind: 'work',
    name: 'Work',
    address: 'Koramangala 5th Block, Bengaluru',
    coords: { latitude: 12.9345, longitude: 77.6266 },
    value: 'Koramangala 5th Block, Bengaluru',
  },
];

/**
 * How many recent rows Figma 10 draws. The design gives no maximum; two is what
 * it shows under the two saved rows, and it keeps the list clear of Continue.
 */
export const RECENT_PLACES_LIMIT = 2;

/** Figma 10 rows 3-4: the recent destinations, newest first (mock seed). */
export const recentDestinations: RecentLocation[] = ['r3', 'r4']
  .map((id) => recentLocations.find((location) => location.id === id))
  .filter((location): location is RecentLocation => location !== undefined);
