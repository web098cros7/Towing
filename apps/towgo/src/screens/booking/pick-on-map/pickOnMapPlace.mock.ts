import { recentLocations } from '@/features/booking/data/recentLocations.data';
import type { PickOnMapPlaceSource } from './pickOnMapPlace';

/**
 * Mock display lines for screen 13, one per `recentLocations` preset (the mock
 * gazetteer `placesMockSource.reverse` answers from), keyed by preset id.
 *
 * Every entry is in the designed shape: a one-line "<area/road>, <city>" title
 * and a full postal address that wraps to the two drawn lines on the 313-wide
 * text column. The MG Road entry is Figma 13's own example.
 */
const MOCK_DISPLAY: Record<string, { title: string; address: string }> = {
  r1: {
    title: 'MG Road, Bengaluru',
    address: '12, MG Road, Ashok Nagar, Bengaluru, Karnataka 560001',
  },
  r2: {
    title: 'Koramangala, Bengaluru',
    address: '80 Feet Road, 5th Block, Koramangala, Bengaluru, Karnataka 560095',
  },
  r3: {
    title: 'Devanahalli, Bengaluru',
    address: 'KIAL Road, Kempegowda Intl. Airport, Devanahalli, Bengaluru, Karnataka 560300',
  },
  r4: {
    title: 'HSR Layout, Bengaluru',
    address: '27th Main Road, Sector 2, HSR Layout, Bengaluru, Karnataka 560102',
  },
  r5: {
    title: 'Indiranagar, Bengaluru',
    address: '100 Feet Road, HAL 2nd Stage, Indiranagar, Bengaluru, Karnataka 560038',
  },
  r6: {
    title: 'Whitefield, Bengaluru',
    address: 'ITPL Main Road, Whitefield, Bengaluru, Karnataka 560066',
  },
  r7: {
    title: 'Majestic, Bengaluru',
    address: 'Kempegowda Bus Station, Gandhi Nagar, Bengaluru, Karnataka 560009',
  },
};

/**
 * The nearest preset to the pin, at ANY distance. `placesMockSource.reverse`
 * stops naming places past 3 km and puts the raw coordinate on both lines; the
 * mock gazetteer is Bengaluru-only, so without this a phone anywhere else would
 * never see the designed card in mock mode.
 */
export const pickOnMapPlaceMockSource: PickOnMapPlaceSource = {
  withDisplay(place) {
    let nearestId: string | null = null;
    let nearestMeters = Infinity;
    for (const location of recentLocations) {
      const meters = roughMeters(
        place.point.lat,
        place.point.lng,
        location.coords.latitude,
        location.coords.longitude,
      );
      if (meters < nearestMeters) {
        nearestMeters = meters;
        nearestId = location.id;
      }
    }

    const display = nearestId ? MOCK_DISPLAY[nearestId] : undefined;
    if (!display) return place;
    return { ...place, displayTitle: display.title, displayAddress: display.address };
  },
};

/** Equirectangular metres, as `placesMockSource` measures. */
function roughMeters(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const metersPerDegLat = 111_320;
  const dLat = (bLat - aLat) * metersPerDegLat;
  const dLng = (bLng - aLng) * metersPerDegLat * Math.cos(((aLat + bLat) / 2) * (Math.PI / 180));
  return Math.hypot(dLat, dLng);
}
