import { useMemo } from 'react';
import { useReverseGeocode } from '@/features/places/api/places.queries';
import type { LatLng } from '@/types/geo';
import { pickOnMapPlaceSource, type PickOnMapPlace } from './pickOnMapPlace';

export type PickOnMapCard = {
  /** The reverse-geocode answer with its display lines, or undefined before the first one lands. */
  place: PickOnMapPlace | undefined;
  /** Bottom card title (Figma 13 `289:2335`). */
  title: string | undefined;
  /** Bottom card address line (Figma 13 `289:2336`). */
  address: string | undefined;
};

/**
 * The place under screen 13's pin: the shared `useReverseGeocode` query (which
 * keeps the previous answer on screen while the next one loads), dressed with
 * the designed title and address lines.
 */
export function usePickOnMapPlace(point: LatLng): PickOnMapCard {
  const { data } = useReverseGeocode(point);

  return useMemo(() => {
    if (!data) return { place: undefined, title: undefined, address: undefined };
    const place = pickOnMapPlaceSource.withDisplay(data);
    return {
      place,
      title: place.displayTitle ?? place.label,
      address: place.displayAddress ?? place.address,
    };
  }, [data]);
}
