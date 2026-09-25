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
  /**
   * Whether `title` / `address` describe THIS point. `loading` while the lookup
   * for the current point is in flight: the query keeps the previous answer as
   * placeholder data, and confirming then saved the previous place's name at the
   * new point ("stuck on the previous address", owner, 25 Sep 2026), so nothing
   * is exposed until this point's own answer lands. `failed` when it errored.
   */
  status: 'loading' | 'ready' | 'failed';
};

/**
 * The place under screen 13's pin: the shared `useReverseGeocode` query (which
 * keeps the previous answer on screen while the next one loads), dressed with
 * the designed title and address lines.
 */
export function usePickOnMapPlace(point: LatLng): PickOnMapCard {
  const { data, isPlaceholderData, isError } = useReverseGeocode(point);
  const current = data && !isPlaceholderData ? data : undefined;
  const status: PickOnMapCard['status'] = current ? 'ready' : isError ? 'failed' : 'loading';

  return useMemo(() => {
    if (!current) return { place: undefined, title: undefined, address: undefined, status };
    const place = pickOnMapPlaceSource.withDisplay(current);
    return {
      place,
      title: place.displayTitle ?? place.label,
      address: place.displayAddress ?? place.address,
      status,
    };
  }, [current, status]);
}
