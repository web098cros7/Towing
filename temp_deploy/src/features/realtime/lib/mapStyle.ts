import type { StyleSpecification } from 'maplibre-gl';
import type { MapColors } from './mapColors';

/**
 * The vendorless default basemap.
 *
 * Tiles are a vendor and billing decision this project has not made, and Phase
 * 5's acceptance criterion is "positions <= 2s behind pings", not "pretty
 * tiles". So the default style has NO tile source at all: a token-coloured
 * background, with the fleet's service-zone polygons drawn on top for real
 * geographic context. No API key, no external request, works offline, and keeps
 * the Playwright smoke hermetic.
 *
 * Setting `NEXT_PUBLIC_MAP_STYLE_URL` swaps in a real vendor style; the zone and
 * truck layers are added in `map.on('load')` so they compose with either.
 */
export function vendorlessStyle(colors: MapColors): StyleSpecification {
  return {
    version: 8,
    // Empty rather than a vendor default: a glyphs URL would be a silent
    // network dependency the moment a layer used a text field.
    sources: {},
    layers: [
      {
        id: 'background',
        type: 'background',
        paint: { 'background-color': colors.background },
      },
    ],
  };
}
