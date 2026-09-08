import type { FleetZone } from '../types';

/**
 * Ray-casting point-in-polygon against a zone's GeoJSON geometry.
 *
 * Client-side because the zone filter is a view concern over data already in the
 * browser — round-tripping to PostGIS for `ST_Contains` would add latency to a
 * dropdown. Planar rather than geodesic: at city scale the error is metres, and
 * this decides which markers to hide, not who gets dispatched.
 */
export function pointInZone(lng: number, lat: number, zone: FleetZone): boolean {
  const geometry = zone.geometry as
    | { type?: string; coordinates?: unknown }
    | null
    | undefined;
  if (!geometry?.type) return false;

  if (geometry.type === 'Polygon') {
    return inPolygon(lng, lat, geometry.coordinates as number[][][]);
  }
  if (geometry.type === 'MultiPolygon') {
    const polygons = geometry.coordinates as number[][][][];
    return polygons.some((polygon) => inPolygon(lng, lat, polygon));
  }
  return false;
}

/** First ring is the outer boundary; the rest are holes. */
function inPolygon(lng: number, lat: number, rings: number[][][]): boolean {
  const [outer, ...holes] = rings;
  if (!outer || !inRing(lng, lat, outer)) return false;
  return !holes.some((hole) => inRing(lng, lat, hole));
}

function inRing(lng: number, lat: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const a = ring[i];
    const b = ring[j];
    if (!a || !b) continue;
    const [aLng, aLat] = a;
    const [bLng, bLat] = b;
    if (aLng === undefined || aLat === undefined || bLng === undefined || bLat === undefined) {
      continue;
    }

    const straddles = aLat > lat !== bLat > lat;
    if (straddles && lng < ((bLng - aLng) * (lat - aLat)) / (bLat - aLat) + aLng) {
      inside = !inside;
    }
  }
  return inside;
}
