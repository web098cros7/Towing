import { useMemo } from 'react';
import { env } from '@/lib/env';
import { useAddresses } from '@/features/account/api/addresses.queries';
import {
  savedLocations,
  type SavedLocation,
  type SavedLocationKind,
} from '../../data/recentLocations.data';

/** The two saved rows Figma 10 draws, in order, with their fixed titles. */
export const SAVED_ROWS: { kind: SavedLocationKind; title: string }[] = [
  { kind: 'home', title: 'Home' },
  { kind: 'work', title: 'Work' },
];

/** One drawn saved row. `place` is null when the customer has not saved that address yet. */
export type SavedPlaceRow = {
  kind: SavedLocationKind;
  title: string;
  place: SavedLocation | null;
};

/**
 * Figma 10 rows 1-2, the saved Home and Work. BOTH ROWS ARE ALWAYS DRAWN, with
 * the titles "Home" and "Work" whatever case the customer typed the label in.
 *
 * Mock mode: the app-local rows in `recentLocations.data.ts`, as drawn.
 * Real backend: the customer's saved addresses (`useAddresses()`), where the
 * free-text label "Home" / "Work" (any case) stands in for the address kind the
 * contract does not have. A row whose address is not saved yet has
 * `place: null`; the screen sends that row to Add Location.
 */
export function useSavedPlaces(): SavedPlaceRow[] {
  const { data } = useAddresses();

  return useMemo(() => {
    const byKind = new Map<SavedLocationKind, SavedLocation>();
    if (env.useMocks) {
      for (const place of savedLocations) byKind.set(place.kind, place);
    } else {
      for (const address of data ?? []) {
        const label = (address.label ?? '').trim().toLowerCase();
        const row = SAVED_ROWS.find((r) => r.kind === label);
        if (!row || byKind.has(row.kind)) continue;
        byKind.set(row.kind, {
          id: address.id,
          kind: row.kind,
          name: row.title,
          address: address.fullAddress,
          coords: { latitude: address.lat, longitude: address.lng },
          value: address.fullAddress,
        });
      }
    }
    return SAVED_ROWS.map(({ kind, title }) => ({
      kind,
      title,
      place: byKind.get(kind) ?? null,
    }));
  }, [data]);
}
