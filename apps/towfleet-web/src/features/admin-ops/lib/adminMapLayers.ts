import type { AnimatedFrame, AdminLiveBooking, AdminLiveDriver } from '@towing/api-contracts';
import type { ExpressionSpecification, Map as MapLibreMap } from 'maplibre-gl';
import type { MapColors } from '@/features/realtime/lib/mapColors';
import { presenceFor } from '@/features/realtime/presence';

/**
 * MapLibre layers for the admin live map (W4, §9.4.6).
 *
 * Same discipline as the fleet canvas — a GeoJSON source with data-driven
 * paint, never DOM markers — for the same reason: at a couple of thousand
 * moving markers, one DOM node per marker costs a layout pass per frame.
 *
 * Three things the fleet map does not draw:
 *  - a BOOKING layer (each active job's pickup as a hollow point), because the
 *    admin map watches the marketplace, not one fleet's trucks;
 *  - a driver→pickup LEG for assigned jobs, dashed because it is a straight
 *    approximation, not a routed path (§11.4's rule, applied here too);
 *  - nothing else — zones are the same unscoped `service_zones` geography the
 *    fleet draws, and the driver marker reuses the presence semantics so
 *    "stale" means the same thing on both consoles.
 */

export const ADMIN_DRIVERS_SOURCE = 'admin-drivers';
export const ADMIN_HEADINGS_SOURCE = 'admin-driver-headings';
export const ADMIN_BOOKINGS_SOURCE = 'admin-bookings';
export const ADMIN_LEGS_SOURCE = 'admin-booking-legs';
export const ADMIN_ZONES_SOURCE = 'admin-zones';

export const ADMIN_DRIVER_DOT_LAYER = 'admin-driver-dot';
export const ADMIN_DRIVER_HALO_LAYER = 'admin-driver-halo';
export const ADMIN_DRIVER_HEADING_LAYER = 'admin-driver-heading';
export const ADMIN_BOOKING_PICKUP_LAYER = 'admin-booking-pickup';
export const ADMIN_LEG_LINE_LAYER = 'admin-booking-leg';
export const ADMIN_ZONE_FILL_LAYER = 'admin-zone-fill';
export const ADMIN_ZONE_LINE_LAYER = 'admin-zone-line';

/** Length of the direction whisker, in metres on the ground (fleet parity). */
const HEADING_WHISKER_M = 90;
const METERS_PER_DEG_LAT = 111_320;

type FeatureCollection = { type: 'FeatureCollection'; features: unknown[] };

function kindOf(driver: AdminLiveDriver, onJobDriverIds: ReadonlySet<string>): 'on_job' | 'idle' {
  return onJobDriverIds.has(driver.driverId) ? 'on_job' : 'idle';
}

export function driversToGeoJson(
  drivers: AdminLiveDriver[],
  nowMs: number,
  frames: Map<string, AnimatedFrame>,
  onJobDriverIds: ReadonlySet<string>,
): FeatureCollection {
  const features: unknown[] = [];

  for (const [index, driver] of drivers.entries()) {
    const frame = frames.get(driver.driverId);
    const lat = frame?.lat ?? driver.lat;
    const lng = frame?.lng ?? driver.lng;
    // A driver who never pinged has nothing to draw — they still appear in the
    // rail, because absent from the map is not absent from the UI.
    if (lat === null || lng === null) continue;

    features.push({
      type: 'Feature',
      id: index,
      geometry: { type: 'Point', coordinates: [lng, lat] },
      properties: {
        driverId: driver.driverId,
        name: driver.name ?? 'Unnamed driver',
        kind: kindOf(driver, onJobDriverIds),
        presence: presenceFor(driver.at ? Date.parse(driver.at) : null, nowMs),
        heading: frame?.heading ?? driver.headingDeg ?? 0,
      },
    });
  }

  return { type: 'FeatureCollection', features };
}

/** A short whisker in each moving driver's bearing — same trick as the fleet map. */
export function driverHeadingsToGeoJson(
  drivers: AdminLiveDriver[],
  nowMs: number,
  frames: Map<string, AnimatedFrame>,
): FeatureCollection {
  const features: unknown[] = [];

  for (const driver of drivers) {
    const frame = frames.get(driver.driverId);
    const lat = frame?.lat ?? driver.lat;
    const lng = frame?.lng ?? driver.lng;
    const heading = frame?.heading ?? driver.headingDeg;
    if (lat === null || lng === null || heading === null || (driver.speedKph ?? 0) < 1) continue;

    const radians = (heading * Math.PI) / 180;
    const dLat = (HEADING_WHISKER_M * Math.cos(radians)) / METERS_PER_DEG_LAT;
    const dLng =
      (HEADING_WHISKER_M * Math.sin(radians)) /
      (METERS_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180));

    features.push({
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates: [
          [lng, lat],
          [lng + dLng, lat + dLat],
        ],
      },
      properties: {
        kind: 'idle',
        presence: presenceFor(driver.at ? Date.parse(driver.at) : null, nowMs),
      },
    });
  }

  return { type: 'FeatureCollection', features };
}

/** Each active booking's pickup as a hollow point — never mistakable for a driver. */
export function bookingPickupsToGeoJson(bookings: AdminLiveBooking[]): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: bookings.map((booking) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [booking.pickup.lng, booking.pickup.lat] },
      properties: { bookingId: booking.bookingId, status: booking.status },
    })),
  };
}

/**
 * The straight driver→pickup leg for every assigned job whose driver is on the
 * map. Dashed in paint, exactly like the fleet legs: an approximation labelled
 * as one.
 */
export function bookingLegsToGeoJson(
  bookings: AdminLiveBooking[],
  drivers: AdminLiveDriver[],
  frames: Map<string, AnimatedFrame>,
): FeatureCollection {
  const byDriver = new Map(drivers.map((driver) => [driver.driverId, driver]));
  const features: unknown[] = [];

  for (const booking of bookings) {
    if (!booking.driverId) continue;
    const driver = byDriver.get(booking.driverId);
    if (!driver) continue;

    const frame = frames.get(driver.driverId);
    const lat = frame?.lat ?? driver.lat;
    const lng = frame?.lng ?? driver.lng;
    if (lat === null || lng === null) continue;

    features.push({
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates: [
          [lng, lat],
          [booking.pickup.lng, booking.pickup.lat],
        ],
      },
      properties: { bookingId: booking.bookingId },
    });
  }

  return { type: 'FeatureCollection', features };
}

export function adminZonesToGeoJson(zones: Array<{ id: string; name: string; geometry: unknown }>): FeatureCollection {
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
    // Presence wins over status, as on the fleet map: an offline marker is grey
    // whatever it was doing when the ping stopped.
    ['==', ['get', 'presence'], 'offline'],
    colors.offline,
    ['==', ['get', 'kind'], 'on_job'],
    colors.onJob,
    colors.idle,
  ];
}

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

export function addAdminLayers(map: MapLibreMap, colors: MapColors): void {
  map.addSource(ADMIN_ZONES_SOURCE, {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] } as never,
  });
  map.addSource(ADMIN_LEGS_SOURCE, {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] } as never,
  });
  map.addSource(ADMIN_HEADINGS_SOURCE, {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] } as never,
  });
  map.addSource(ADMIN_DRIVERS_SOURCE, {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] } as never,
  });
  map.addSource(ADMIN_BOOKINGS_SOURCE, {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] } as never,
  });

  map.addLayer({
    id: ADMIN_ZONE_FILL_LAYER,
    type: 'fill',
    source: ADMIN_ZONES_SOURCE,
    paint: { 'fill-color': colors.zoneFill, 'fill-opacity': 0.07 },
  });
  map.addLayer({
    id: ADMIN_ZONE_LINE_LAYER,
    type: 'line',
    source: ADMIN_ZONES_SOURCE,
    paint: { 'line-color': colors.zoneLine, 'line-width': 1.5, 'line-dasharray': [3, 2] },
  });

  map.addLayer({
    id: ADMIN_LEG_LINE_LAYER,
    type: 'line',
    source: ADMIN_LEGS_SOURCE,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': colors.onJob,
      'line-opacity': 0.45,
      'line-width': ['interpolate', ['linear'], ['zoom'], 8, 1.5, 14, 2.5],
      'line-dasharray': [2, 2],
    },
  });

  map.addLayer({
    id: ADMIN_BOOKING_PICKUP_LAYER,
    type: 'circle',
    source: ADMIN_BOOKINGS_SOURCE,
    paint: {
      'circle-radius': 5,
      'circle-color': colors.background,
      'circle-stroke-width': 2,
      'circle-stroke-color': colors.onJob,
      'circle-opacity': 0.95,
    },
  });

  map.addLayer({
    id: ADMIN_DRIVER_HALO_LAYER,
    type: 'circle',
    source: ADMIN_DRIVERS_SOURCE,
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 8, 14, 16],
      'circle-color': markerColorExpression(colors),
      'circle-opacity': 0.18,
    },
  });

  map.addLayer({
    id: ADMIN_DRIVER_HEADING_LAYER,
    type: 'line',
    source: ADMIN_HEADINGS_SOURCE,
    layout: { 'line-cap': 'round' },
    paint: {
      'line-color': markerColorExpression(colors),
      'line-opacity': markerOpacityExpression(),
      'line-width': ['interpolate', ['linear'], ['zoom'], 8, 1.5, 14, 3],
    },
  });

  map.addLayer({
    id: ADMIN_DRIVER_DOT_LAYER,
    type: 'circle',
    source: ADMIN_DRIVERS_SOURCE,
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 4, 14, 7],
      'circle-color': markerColorExpression(colors),
      'circle-opacity': markerOpacityExpression(),
      'circle-stroke-width': 2,
      'circle-stroke-color': colors.background,
      'circle-stroke-opacity': markerOpacityExpression(),
    },
  });
}

/** Theme flips repaint in place — MapLibre cannot read CSS variables. */
export function applyAdminColors(map: MapLibreMap, colors: MapColors): void {
  if (map.getLayer(ADMIN_ZONE_FILL_LAYER)) {
    map.setPaintProperty(ADMIN_ZONE_FILL_LAYER, 'fill-color', colors.zoneFill);
  }
  if (map.getLayer(ADMIN_ZONE_LINE_LAYER)) {
    map.setPaintProperty(ADMIN_ZONE_LINE_LAYER, 'line-color', colors.zoneLine);
  }
  if (map.getLayer(ADMIN_LEG_LINE_LAYER)) {
    map.setPaintProperty(ADMIN_LEG_LINE_LAYER, 'line-color', colors.onJob);
  }
  if (map.getLayer(ADMIN_BOOKING_PICKUP_LAYER)) {
    map.setPaintProperty(ADMIN_BOOKING_PICKUP_LAYER, 'circle-stroke-color', colors.onJob);
    map.setPaintProperty(ADMIN_BOOKING_PICKUP_LAYER, 'circle-color', colors.background);
  }
  for (const layer of [ADMIN_DRIVER_HALO_LAYER, ADMIN_DRIVER_HEADING_LAYER, ADMIN_DRIVER_DOT_LAYER]) {
    if (!map.getLayer(layer)) continue;
    if (layer === ADMIN_DRIVER_HEADING_LAYER) {
      map.setPaintProperty(layer, 'line-color', markerColorExpression(colors));
    } else {
      map.setPaintProperty(layer, 'circle-color', markerColorExpression(colors));
    }
  }
}
