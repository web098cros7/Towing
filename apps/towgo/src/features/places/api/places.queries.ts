import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { LatLng } from '@/types/geo';
import { placesDataSource } from './placesDataSource';
import { placesKeys } from './places.keys';

/**
 * §9.1.5's address search.
 *
 * DEBOUNCED IN THE HOOK, NOT IN THE SCREEN. Places is billed per session and a
 * request per keystroke is the single most expensive mistake available in this
 * product — so the delay lives beside the query rather than in whichever screen
 * happens to call it, where the second caller would forget it.
 */

/**
 * 300 ms. Below ~250 ms a normal typing rhythm still fires per character; above
 * ~400 ms the list feels like it is lagging behind the keyboard.
 */
const DEBOUNCE_MS = 300;

/** Below three characters every query matches half the gazetteer. */
const MIN_QUERY_LENGTH = 3;

function useDebounced(value: string, delayMs = DEBOUNCE_MS): string {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}

export function usePlaceAutocomplete(query: string, near?: LatLng) {
  const debounced = useDebounced(query);
  const enabled = debounced.trim().length >= MIN_QUERY_LENGTH;

  return useQuery({
    queryKey: placesKeys.autocomplete(debounced, near),
    queryFn: () => placesDataSource.autocomplete(debounced.trim(), near),
    enabled,
    /**
     * Suggestions for a given string do not change minute to minute, and a
     * customer correcting a typo re-sends the same prefixes repeatedly. Holding
     * them for five minutes turns a backspace into a cache hit rather than
     * another billed call.
     */
    staleTime: 5 * 60_000,
    /**
     * Keeps the previous list on screen while the next one loads, so the
     * suggestions do not blank out between keystrokes — the difference between
     * a list that feels responsive and one that flickers.
     */
    placeholderData: (previous) => previous,
  });
}

/**
 * The pin's label. Enabled only when a point is supplied, so the map picker can
 * hold it disabled until the camera has settled.
 */
export function useReverseGeocode(point: LatLng | undefined) {
  return useQuery({
    queryKey: point
      ? placesKeys.reverse(point.latitude, point.longitude)
      : placesKeys.reverse(0, 0),
    queryFn: () => placesDataSource.reverse(point!),
    enabled: point !== undefined,
    // Every drag produces a different coordinate, so there is nothing to reuse
    // and a long staleTime would only grow the cache.
    staleTime: 0,
    placeholderData: (previous) => previous,
  });
}

/**
 * Resolving a picked suggestion. NOT a `useMutation` despite being a one-shot
 * action: the answer is a pure function of the id and is worth caching, and a
 * customer who taps back and re-picks the same address should not pay for a
 * second lookup.
 */
export async function resolvePlace(placeId: string) {
  return placesDataSource.details(placeId);
}

/**
 * The road route from pickup to drop, drawn on the booking map (owner decision,
 * 24 Sep 2026). Cached for the pair of points: Directions is billed per call.
 */
export function usePlaceRoute(from: LatLng | null | undefined, to: LatLng | null | undefined) {
  return useQuery({
    queryKey: placesKeys.route(
      from ?? { latitude: 0, longitude: 0 },
      to ?? { latitude: 0, longitude: 0 },
    ),
    queryFn: () => placesDataSource.route(from!, to!),
    enabled: !!from && !!to,
    staleTime: 10 * 60_000,
  });
}
