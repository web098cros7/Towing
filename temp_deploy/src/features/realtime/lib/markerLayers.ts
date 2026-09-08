import type { ExpressionSpecification, Map as MapLibreMap } from 'maplibre-gl';
import { presenceFor } from '../presence';
import type { FleetPosition, FleetZone, MapStatusFilter } from '../types';
import type { MapColors } from './mapColors';

export const TRUCKS_SOURCE = 'fleet-trucks';
export const HEADINGS_SOURCE = 'fleet-headings';
export const ROUTES_SOURCE = 'fleet-routes';
export const ZONES_SOURCE = 'fleet-zones';
export const ROUTE_LINE_LAYER = 'fleet-route-line';
export const ROUTE_ENDPOINT_LAYER = 'fleet-route-endpoint';
export const TRUCK_DOT_LAYER = 'fleet-truck-dot';
export const TRUCK_HALO_LAYER = 'fleet-truck-halo';
export const TRUCK_HEADING_LAYER = 'fleet-truck-heading';
export const ZONE_FILL_LAYER = 'fleet-zone-fill';
export const ZONE_LINE_LAYER = 'fleet-zone-line';

/** Length of the direction whisker, in metres on the ground. */
const HEADING_WHISKER_M = 90;
const METERS_PER_DEG_LAT = 111_320;

export interface TruckFeatureProps extends Record<string, unknown> {
  truckId: string;
  plate: string;
  /** What the marker colour encodes — see `markerColorExpression`. */
  kind: 'on_job' | 'idle' | 'non_compliant' | 'inactive';
  presence: 'live' | 'stale' | 'offline';
  heading: number;
  driverName: string;
}

type FeatureCollection = {
  type: 'FeatureCollection';
  features: Array<{
    type: 'Feature';
    id?: number;
    geometry: { type: 'Point'; coordinates: [number, number] };
    properties: TruckFeatureProps;
  }>;
};

function kindOf(position: FleetPosition): TruckFeatureProps['kind'] {
  if (position.status === 'non_compliant') return 'non_compliant';
  if (position.status === 'inactive') return 'inactive';
  return position.activeBookingId ? 'on_job' : 'idle';
}

export function matchesFilter(position: FleetPosition, filter: MapStatusFilter): boolean {
  if (filter === 'all') return true;
  if (filter === 'on_job') return position.activeBookingId !== null;
  return position.status === filter;
}

/**
 * GeoJSON for the truck layer. A single source with data-driven paint rather
 * than one DOM marker per truck: at 200 trucks updating every second, DOM
 * markers cost a layout pass per frame and the map stops being interactive.
 */
export function trucksToGeoJson(
  positions: FleetPosition[],
  nowMs: number,
  /** Interpolated coordinates from the animation loop, keyed by truck id. */
  animated?: Map<string, { lat: number; lng: number; heading: number }>,
): FeatureCollection {
  const features: FeatureCollection['features'] = [];

  for (const [index, position] of positions.entries()) {
    const frame = animated?.get(position.truckId);
    const lat = frame?.lat ?? position.lat;
    const lng = frame?.lng ?? position.lng;
    // A truck that has never reported has nothing to draw. It still appears in
    // the rail and the filters — absent from the map is not absent from the UI.
    if (lat === null || lng === null) continue;

    features.push({
      type: 'Feature',
      // Numeric id so feature-state (hover/selection) works.
      id: index,
      geometry: { type: 'Point', coordinates: [lng, lat] },
      properties: {
        truckId: position.truckId,
        plate: position.plate,
        kind: kindOf(position),
        presence: presenceFor(position.at ? Date.parse(position.at) : null, nowMs),
        heading: frame?.heading ?? position.heading ?? 0,
        driverName: position.driverName ?? 'Unassigned',
      },
    });
  }

  return { type: 'FeatureCollection', features };
}

/**
 * A short line from each moving truck in its direction of travel.
 *
 * A LineString in real geography rather than a rotated icon: `icon-rotate` needs
 * an image (and an SDF one to be tintable), and `circle-translate` is not
 * data-driven per feature — so a whisker built in the GeoJSON is the only way to
 * get a per-truck bearing that also carries the marker's colour and presence.
 */
export function headingsToGeoJson(
  positions: FleetPosition[],
  nowMs: number,
  animated?: Map<string, { lat: number; lng: number; heading: number }>,
): unknown {
  const features = [];

  for (const position of positions) {
    const frame = animated?.get(position.truckId);
    const lat = frame?.lat ?? position.lat;
    const lng = frame?.lng ?? position.lng;
    const heading = frame?.heading ?? position.heading;
    // A stationary truck has no direction to show, and drawing one would be a
    // confident lie about which way it is facing.
    if (lat === null || lng === null || heading === null || (position.speedKph ?? 0) < 1) continue;

    const radians = (heading * Math.PI) / 180;
    // Compass bearing: 0 = north (+lat), 90 = east (+lng).
    const dLat = (HEADING_WHISKER_M * Math.cos(radians)) / METERS_PER_DEG_LAT;
    const dLng =
      (HEADING_WHISKER_M * Math.sin(radians)) /
      (METERS_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180));

    features.push({
      type: 'Feature' as const,
      geometry: {
        type: 'LineString' as const,
        coordinates: [
          [lng, lat],
          [lng + dLng, lat + dLat],
        ],
      },
      properties: {
        kind: kindOf(position),
        presence: presenceFor(position.at ? Date.parse(position.at) : null, nowMs),
      },
    });
  }

  return { type: 'FeatureCollection', features };
}

/**
 * The active-job legs (§9.3.3 "active job routes").
 *
 * Deliberately a straight truck→pickup→drop line, drawn DASHED so it reads as an
 * approximation. A solid line would imply a routed path, and §11.4 is explicit
 * that an unsnapped route "drives through buildings" — the road-following
 * polyline needs the Directions API, which lands with Track B.
 */
export function routesToGeoJson(
  positions: FleetPosition[],
  animated?: Map<string, { lat: number; lng: number; heading: number }>,
): unknown {
  const features = [];

  for (const position of positions) {
    const leg = position.activeJobLeg;
    if (!leg) continue;

    const frame = animated?.get(position.truckId);
    const lat = frame?.lat ?? position.lat;
    const lng = frame?.lng ?? position.lng;

    // Truck → pickup → drop. The truck leg is dropped when we have no position,
    // rather than anchoring the line at 0,0.
    const path: number[][] = [];
    if (lat !== null && lng !== null) path.push([lng, lat]);
    path.push([leg.pickup.lng, leg.pickup.lat]);
    if (leg.drop) path.push([leg.drop.lng, leg.drop.lat]);
    if (path.length < 2) continue;

    features.push({
      type: 'Feature' as const,
      geometry: { type: 'LineString' as const, coordinates: path },
      properties: { truckId: position.truckId, kind: 'on_job', presence: 'live' },
    });

    for (const [name, point] of [
      ['pickup', leg.pickup],
      ['drop', leg.drop],
    ] as const) {
      if (!point) continue;
      features.push({
        type: 'Feature' as const,
        geometry: { type: 'Point' as const, coordinates: [point.lng, point.lat] },
        properties: { endpoint: name, truckId: position.truckId },
      });
    }
  }

  return { type: 'FeatureCollection', features };
}

export function zonesToGeoJson(zones: FleetZone[]): unknown {
  return {
    type: 'FeatureCollection',
    features: zones.map((zone) => ({
      type: 'Feature',
      geometry: zone.geometry,
      properties: { id: zone.id, name: zone.name },
    })),
  };
}

function markerColorExpression(colors: MapColors): ExpressionSpecification {
  return [
    'case',
    // Presence wins over status: an offline truck is grey whatever it was
    // doing, because its last known state is not evidence of its current one.
    ['==', ['get', 'presence'], 'offline'],
    colors.offline,
    ['==', ['get', 'kind'], 'non_compliant'],
    colors.nonCompliant,
    ['==', ['get', 'kind'], 'inactive'],
    colors.inactive,
    ['==', ['get', 'kind'], 'on_job'],
    colors.onJob,
    colors.idle,
  ];
}

/** Stale markers dim rather than vanish — "we lost it", not "it is gone" (§11.6). */
function markerOpacityExpression(): ExpressionSpecification {
  return [
    'case',
    ['==', ['get', 'presence'], 'offline'],
    0.35,
    ['==', ['get', 'presence'], 'stale'],
    0.6,
    1,
  ];
}

export function addFleetLayers(map: MapLibreMap, colors: MapColors): void {
  map.addSource(ZONES_SOURCE, {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] } as never,
  });
  map.addSource(ROUTES_SOURCE, {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] } as never,
  });
  map.addSource(HEADINGS_SOURCE, {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] } as never,
  });
  map.addSource(TRUCKS_SOURCE, {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] } as never,
  });

  map.addLayer({
    id: ZONE_FILL_LAYER,
    type: 'fill',
    source: ZONES_SOURCE,
    paint: { 'fill-color': colors.zoneFill, 'fill-opacity': 0.07 },
  });
  map.addLayer({
    id: ZONE_LINE_LAYER,
    type: 'line',
    source: ZONES_SOURCE,
    paint: { 'line-color': colors.zoneLine, 'line-width': 1.5, 'line-dasharray': [3, 2] },
  });

  // Beneath the trucks: the leg is context for the marker, not a subject.
  map.addLayer({
    id: ROUTE_LINE_LAYER,
    type: 'line',
    source: ROUTES_SOURCE,
    filter: ['==', ['geometry-type'], 'LineString'],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': colors.onJob,
      'line-opacity': 0.5,
      'line-width': ['interpolate', ['linear'], ['zoom'], 8, 1.5, 14, 2.5],
      // Dashed on purpose: this is a straight approximation, not a routed path.
      'line-dasharray': [2, 2],
    },
  });
  map.addLayer({
    id: ROUTE_ENDPOINT_LAYER,
    type: 'circle',
    source: ROUTES_SOURCE,
    filter: ['==', ['geometry-type'], 'Point'],
    paint: {
      'circle-radius': 4,
      // Hollow: an endpoint must not be mistaken for a truck.
      'circle-color': colors.background,
      'circle-stroke-width': 2,
      'circle-stroke-color': colors.onJob,
      'circle-opacity': 0.9,
    },
  });

  // A soft halo behind the dot keeps markers findable against the flat
  // background, and doubles as the hit target for taps.
  map.addLayer({
    id: TRUCK_HALO_LAYER,
    type: 'circle',
    source: TRUCKS_SOURCE,
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 8, 14, 16],
      'circle-color': markerColorExpression(colors),
      'circle-opacity': 0.18,
    },
  });

  map.addLayer({
    id: TRUCK_HEADING_LAYER,
    type: 'line',
    source: HEADINGS_SOURCE,
    layout: { 'line-cap': 'round' },
    paint: {
      'line-color': markerColorExpression(colors),
      'line-opacity': markerOpacityExpression(),
      'line-width': ['interpolate', ['linear'], ['zoom'], 8, 1.5, 14, 3],
    },
  });

  map.addLayer({
    id: TRUCK_DOT_LAYER,
    type: 'circle',
    source: TRUCKS_SOURCE,
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 4, 14, 7],
      'circle-color': markerColorExpression(colors),
      'circle-opacity': markerOpacityExpression(),
      'circle-stroke-width': 2,
      'circle-stroke-color': colors.markerStroke,
      'circle-stroke-opacity': markerOpacityExpression(),
    },
  });
}

/** Re-applies colours after a theme flip, without rebuilding the style. */
export function applyColors(map: MapLibreMap, colors: MapColors): void {
  const color = markerColorExpression(colors);
  for (const layer of [TRUCK_DOT_LAYER, TRUCK_HALO_LAYER]) {
    if (map.getLayer(layer)) map.setPaintProperty(layer, 'circle-color', color);
  }
  if (map.getLayer(TRUCK_HEADING_LAYER)) {
    map.setPaintProperty(TRUCK_HEADING_LAYER, 'line-color', color);
  }
  if (map.getLayer(TRUCK_DOT_LAYER)) {
    map.setPaintProperty(TRUCK_DOT_LAYER, 'circle-stroke-color', colors.markerStroke);
  }
  if (map.getLayer(ROUTE_LINE_LAYER)) {
    map.setPaintProperty(ROUTE_LINE_LAYER, 'line-color', colors.onJob);
  }
  if (map.getLayer(ROUTE_ENDPOINT_LAYER)) {
    map.setPaintProperty(ROUTE_ENDPOINT_LAYER, 'circle-stroke-color', colors.onJob);
    map.setPaintProperty(ROUTE_ENDPOINT_LAYER, 'circle-color', colors.background);
  }
  if (map.getLayer(ZONE_FILL_LAYER)) {
    map.setPaintProperty(ZONE_FILL_LAYER, 'fill-color', colors.zoneFill);
  }
  if (map.getLayer(ZONE_LINE_LAYER)) {
    map.setPaintProperty(ZONE_LINE_LAYER, 'line-color', colors.zoneLine);
  }
  if (map.getLayer('background')) {
    map.setPaintProperty('background', 'background-color', colors.background);
  }
}
