import type { MapCoordinate, MapRegion } from '@towing/ui';

/**
 * Screen-space geometry for Figma 18's route, which a native map cannot stack
 * the way the design does.
 *
 * The design's z-order is Streets → Truck glow → Route → Truck image: the solid
 * #0B0C0E route starts 36 pt from the truck centre, INSIDE the 86 glow, drawn
 * over the glow and under the truck. On Google Maps (and Apple Maps) every
 * marker draws above every polyline, and the glow is part of the truck marker.
 * So the route is drawn in two pieces that meet seamlessly:
 *
 *  · the native polyline starts exactly where the design's route starts, on
 *    the 36 pt circle round the truck (its round cap included), and runs to
 *    the pin;
 *  · the stretch of that same line that lies under the glow (36 → 46 pt) is
 *    drawn again inside the truck marker's bitmap, between the glow and the
 *    truck image, so it reads above the glow exactly as drawn.
 *
 * Points are converted with a local tangent plane at the truck. The map never
 * rotates or tilts (`MapPreview` disables both), and Web Mercator is conformal,
 * so metres east/north map to screen x/−y at one scale: metres per point.
 */

const EARTH_RADIUS_M = 6_371_008.8;
const RAD = Math.PI / 180;

type Planar = { x: number; y: number };

/** Metres per screen point at the region's centre latitude, from its longitude span. */
export function metersPerPoint(region: MapRegion, mapWidthPt: number): number | null {
  if (!(mapWidthPt > 0) || !(region.longitudeDelta > 0)) return null;
  return (
    (region.longitudeDelta * RAD * EARTH_RADIUS_M * Math.cos(region.latitude * RAD)) / mapWidthPt
  );
}

function toPlanar(origin: MapCoordinate, point: MapCoordinate): Planar {
  return {
    x:
      (point.longitude - origin.longitude) * RAD * EARTH_RADIUS_M * Math.cos(origin.latitude * RAD),
    y: (point.latitude - origin.latitude) * RAD * EARTH_RADIUS_M,
  };
}

function fromPlanar(origin: MapCoordinate, point: Planar): MapCoordinate {
  return {
    latitude: origin.latitude + point.y / (RAD * EARTH_RADIUS_M),
    longitude:
      origin.longitude + point.x / (RAD * EARTH_RADIUS_M * Math.cos(origin.latitude * RAD)),
  };
}

const length = (p: Planar) => Math.hypot(p.x, p.y);

/**
 * The route as it stands from the truck's current (animated) position: the
 * travelled part is dropped by projecting the truck onto its nearest segment,
 * and the line starts at the truck itself, so it is always drawn truck → pin.
 */
export function routeFromTruck(route: MapCoordinate[], truck: MapCoordinate): MapCoordinate[] {
  if (route.length < 2) return [truck, ...route];

  const points = route.map((point) => toPlanar(truck, point));
  let best = 0;
  let bestDistance = Infinity;

  for (let i = 0; i < points.length - 1; i += 1) {
    const a = points[i]!;
    const b = points[i + 1]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const span = dx * dx + dy * dy;
    const t = span === 0 ? 0 : Math.min(1, Math.max(0, -(a.x * dx + a.y * dy) / span));
    const distance = Math.hypot(a.x + t * dx, a.y + t * dy);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = i;
    }
  }

  return [truck, ...route.slice(best + 1)];
}

/**
 * Where a path starting at the origin first leaves the circle of `radius`
 * (planar metres): the index of the first vertex outside it and the crossing
 * point on the segment before it. `null` when the path never leaves.
 */
function firstExit(points: Planar[], radius: number): { index: number; at: Planar } | null {
  for (let i = 1; i < points.length; i += 1) {
    const b = points[i]!;
    if (length(b) < radius) continue;
    const a = points[i - 1]!;
    // |a + t(b − a)| = radius, for the t in [0, 1] where the path goes out.
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const qa = dx * dx + dy * dy;
    const qb = 2 * (a.x * dx + a.y * dy);
    const qc = a.x * a.x + a.y * a.y - radius * radius;
    const disc = Math.max(0, qb * qb - 4 * qa * qc);
    const t = qa === 0 ? 0 : Math.min(1, Math.max(0, (-qb + Math.sqrt(disc)) / (2 * qa)));
    return { index: i, at: { x: a.x + t * dx, y: a.y + t * dy } };
  }
  return null;
}

export type RouteSplit = {
  /** The native polyline: from the design's route start (on the start circle) to the pin. */
  polyline: MapCoordinate[];
  /**
   * The stretch under the glow, in screen points relative to the truck centre
   * (x right, y down), for the truck marker to draw above its glow.
   */
  stub: { x: number; y: number }[];
};

/**
 * Splits a truck → pin path for the two-piece drawing described above.
 * `startPt` is the design's route start distance from the truck centre (36),
 * `stubEndPt` how far past the glow the in-marker copy runs (46).
 */
export function splitRouteAtTruck(
  path: MapCoordinate[],
  metresPerPt: number,
  startPt: number,
  stubEndPt: number,
): RouteSplit {
  const truck = path[0];
  if (!truck || path.length < 2 || !(metresPerPt > 0)) return { polyline: [], stub: [] };

  const planar = path.map((point) => toPlanar(truck, point));
  const start = firstExit(planar, startPt * metresPerPt);
  // The whole route lies under the truck (the pin is within 36 pt): nothing to draw.
  if (!start) return { polyline: [], stub: [] };

  const polyline = [fromPlanar(truck, start.at), ...path.slice(start.index)];

  const rest = [start.at, ...planar.slice(start.index)];
  const end = firstExit(
    // `firstExit` expects the origin-relative path; distances are from the truck.
    [{ x: 0, y: 0 }, ...rest],
    stubEndPt * metresPerPt,
  );
  const stubPlanar = end ? [...rest.slice(0, Math.max(1, end.index - 1)), end.at] : rest;

  const round = (n: number) => Math.round(n * 2) / 2;
  const stub = stubPlanar.map((p) => ({
    x: round(p.x / metresPerPt),
    y: round(-p.y / metresPerPt),
  }));

  return { polyline, stub };
}
