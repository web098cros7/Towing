import type { MapCoordinate } from '@towing/ui';

/**
 * The route the tracking map draws, from the truck's current (animated)
 * position to the pin.
 *
 * Points are compared on a local tangent plane at the truck: at the scale of a
 * route (a few km) metres east/north are as good as the sphere, and far cheaper.
 */

const EARTH_RADIUS_M = 6_371_008.8;
const RAD = Math.PI / 180;

type Planar = { x: number; y: number };

function toPlanar(origin: MapCoordinate, point: MapCoordinate): Planar {
  return {
    x:
      (point.longitude - origin.longitude) * RAD * EARTH_RADIUS_M * Math.cos(origin.latitude * RAD),
    y: (point.latitude - origin.latitude) * RAD * EARTH_RADIUS_M,
  };
}

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
