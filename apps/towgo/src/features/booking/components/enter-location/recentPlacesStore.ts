import { useMemo } from 'react';
import { create } from 'zustand';
import { env } from '@/lib/env';
import { useBookings } from '@/features/bookings/api/bookings.queries';
import type { Booking } from '@/features/bookings/types';
import {
  recentDestinations,
  RECENT_PLACES_LIMIT,
  type RecentLocation,
} from '../../data/recentLocations.data';

/**
 * Figma 10 "Saved & Recent", rows 3-4: the customer's recent places.
 *
 * ⚠ NO RECENTS ENDPOINT. The rows come from what the app already has:
 * - mock mode: seeded with the drawn rows (Kempegowda Intl. Airport, HSR Layout);
 * - real backend: the customer's booking history (drop, then pickup, newest
 *   booking first), so a returning customer sees real places from launch;
 * - both: every place picked on screen 10 this session goes on top.
 *
 * "Clear recents" empties the session list and hides history rows from
 * bookings made before the clear. Neither survives an app restart, because
 * there is nowhere to store the clear.
 */
type RecentPlacesState = {
  recents: RecentLocation[];
  /** Epoch ms of the last "Clear recents"; history before it is hidden. */
  clearedAt: number | null;
  addRecent: (place: RecentLocation) => void;
  clearRecents: () => void;
};

export const useRecentPlacesStore = create<RecentPlacesState>((set, get) => ({
  recents: env.useMocks ? recentDestinations : [],
  clearedAt: null,
  addRecent: (place) =>
    set({
      recents: [place, ...get().recents.filter((r) => r.id !== place.id)].slice(
        0,
        RECENT_PLACES_LIMIT,
      ),
    }),
  clearRecents: () => set({ recents: [], clearedAt: Date.now() }),
}));

/**
 * The label both booking sources give an address the server does not have (a
 * roadside job with no drop, an old row with no pickup label). Not a place.
 */
const NO_ADDRESS = '—';

const isAddress = (label: string) => label.trim() !== '' && label.trim() !== NO_ADDRESS;

/**
 * The trip-history rows, from the app's `Booking` as `bookingsRestSource` maps
 * it: the contract's `dropAddress` / `drop` arrive as `destinationLabel` /
 * `dropPoint`, and `pickupAddress` / `pickup` as `originLabel` / `pickupPoint`.
 * An end without a point, or whose label is the '—' placeholder, is skipped.
 */
function historyPlaces(items: Booking[], clearedAt: number | null): RecentLocation[] {
  const bookings = items
    .filter((b) => clearedAt === null || Date.parse(b.createdAt) > clearedAt)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  const rows: RecentLocation[] = [];
  for (const b of bookings) {
    if (b.dropPoint && isAddress(b.destinationLabel))
      rows.push(fromAddress(`${b.id}:drop`, b.destinationLabel, b.dropPoint));
    if (b.pickupPoint && isAddress(b.originLabel))
      rows.push(fromAddress(`${b.id}:pickup`, b.originLabel, b.pickupPoint));
  }
  return rows;
}

/** "Indiranagar, Bengaluru" → title "Indiranagar", subtitle "Bengaluru". */
function fromAddress(
  id: string,
  address: string,
  point: { lat: number; lng: number },
): RecentLocation {
  const [head, ...rest] = address.split(',').map((part) => part.trim());
  return {
    id,
    name: head || address,
    address: rest.join(', '),
    coords: { latitude: point.lat, longitude: point.lng },
    value: address,
  };
}

const sameValue = (a: RecentLocation, b: RecentLocation) =>
  (a.value ?? a.name).trim().toLowerCase() === (b.value ?? b.name).trim().toLowerCase();

/** The recent rows to draw, newest first, at most `RECENT_PLACES_LIMIT`. */
export function useRecentPlaces(): RecentLocation[] {
  const session = useRecentPlacesStore((s) => s.recents);
  const clearedAt = useRecentPlacesStore((s) => s.clearedAt);
  const { items } = useBookings();

  return useMemo(() => {
    const rows: RecentLocation[] = [
      ...session,
      ...(env.useMocks ? [] : historyPlaces(items, clearedAt)),
    ];
    const distinct: RecentLocation[] = [];
    for (const row of rows) {
      if (!distinct.some((d) => sameValue(d, row))) distinct.push(row);
      if (distinct.length === RECENT_PLACES_LIMIT) break;
    }
    return distinct;
  }, [session, clearedAt, items]);
}
