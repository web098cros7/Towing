import type { PlaceDetail } from '@towing/api-contracts';
import { env } from '@/lib/env';
import { pickOnMapPlaceLiveSource } from './pickOnMapPlace.live';
import { pickOnMapPlaceMockSource } from './pickOnMapPlace.mock';

/**
 * App-local optional extension of `PlaceDetail` for screen 13's bottom card.
 *
 * Figma 13 draws the title as "<area/road>, <city>" ("MG Road, Bengaluru") and
 * the second line as the full postal address ("12, MG Road, Ashok Nagar,
 * Bengaluru, Karnataka 560001"). The contract carries neither shape: `label` is
 * a bare short label ("Indiranagar") and `address` is whatever the geocoder
 * formatted. `places/reverse` returning the designed title is a backend gap
 * (spec 13, Data gap 2); until it does, these two optional fields hold the
 * designed lines and the card falls back to `label` / `address` without them.
 */
export type PickOnMapPlace = PlaceDetail & {
  displayTitle?: string;
  displayAddress?: string;
};

/** Fills the display lines for one reverse-geocode answer. */
export interface PickOnMapPlaceSource {
  withDisplay(place: PlaceDetail): PickOnMapPlace;
}

/** The same `env.useMocks` seam as `placesDataSource`. */
export const pickOnMapPlaceSource: PickOnMapPlaceSource = env.useMocks
  ? pickOnMapPlaceMockSource
  : pickOnMapPlaceLiveSource;
