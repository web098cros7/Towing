import type { Map as MapLibreMap } from 'maplibre-gl';
import type { AdminZone } from '@towing/api-contracts';
import type { MapColors } from '@/features/realtime/lib/mapColors';

/** Same local shape the fleet and ops layer modules use — no `geojson` dep. */
type FeatureCollection = {
  type: 'FeatureCollection';
  features: unknown[];
};

/**
 * The zone editor's own layers.
 *
 * A SEPARATE SOURCE from the ops live map's: that one draws the marketplace for
 * an operator watching it, this one draws the thing being EDITED, and the two
 * want different emphasis (an inactive zone is grey context on the live map and
 * a "this is switched off" here). Sharing the ids would mean one screen telling
 * the other what it may not draw.
 *
 * The draft polygon is NOT here — Terra Draw renders what is being drawn, and a
 * second source mirroring it would be two answers to "where is the line".
 */

export const ZONES_SOURCE = 'editor-zones';
export const ZONES_FILL_LAYER = 'editor-zone-fill';
export const ZONES_LINE_LAYER = 'editor-zone-line';

export function zonesToGeoJson(
  zones: AdminZone[],
  selectedZoneId: string | null,
): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: zones.map((zone) => ({
      type: 'Feature',
      geometry: zone.area,
      properties: {
        zoneId: zone.id,
        name: zone.name,
        // Strings, not booleans: MapLibre paints from data-driven expressions,
        // and `case` reads better against what the legend says out loud.
        state: zone.isActive ? 'active' : 'paused',
        selected: zone.id === selectedZoneId ? 'yes' : 'no',
      },
    })),
  };
}

/** Idempotent: called on load, then re-called as the theme changes. */
export function addZoneLayers(map: MapLibreMap, colors: MapColors): void {
  if (map.getSource(ZONES_SOURCE)) return;

  map.addSource(ZONES_SOURCE, {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] },
  });
  map.addLayer({
    id: ZONES_FILL_LAYER,
    type: 'fill',
    source: ZONES_SOURCE,
    paint: {
      'fill-color': ['case', ['==', ['get', 'state'], 'active'], colors.zoneFill, colors.inactive],
      'fill-opacity': ['case', ['==', ['get', 'selected'], 'yes'], 0.22, 0.1],
    },
  });
  map.addLayer({
    id: ZONES_LINE_LAYER,
    type: 'line',
    source: ZONES_SOURCE,
    paint: {
      'line-color': ['case', ['==', ['get', 'state'], 'active'], colors.zoneLine, colors.inactive],
      // Dashes are this map's marker for "not live" — it survives a greyscale
      // screenshot, unlike a hue change.
      'line-dasharray': [
        'case',
        ['==', ['get', 'state'], 'active'],
        ['literal', [1]],
        ['literal', [2, 2]],
      ],
      'line-width': ['case', ['==', ['get', 'selected'], 'yes'], 3, 1.5],
    },
  });
}

/** Re-colours existing layers after a theme flip. */
export function applyZoneColors(map: MapLibreMap, colors: MapColors): void {
  if (!map.getLayer(ZONES_FILL_LAYER) || !map.getLayer(ZONES_LINE_LAYER)) return;
  map.setPaintProperty(ZONES_FILL_LAYER, 'fill-color', [
    'case',
    ['==', ['get', 'state'], 'active'],
    colors.zoneFill,
    colors.inactive,
  ]);
  map.setPaintProperty(ZONES_LINE_LAYER, 'line-color', [
    'case',
    ['==', ['get', 'state'], 'active'],
    colors.zoneLine,
    colors.inactive,
  ]);
}

export function setZoneData(
  map: MapLibreMap,
  zones: AdminZone[],
  selectedZoneId: string | null,
): void {
  const source = map.getSource(ZONES_SOURCE) as
    | { setData: (data: FeatureCollection) => void }
    | undefined;
  source?.setData(zonesToGeoJson(zones, selectedZoneId));
}
