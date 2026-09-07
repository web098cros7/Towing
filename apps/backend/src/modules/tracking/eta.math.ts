import type { GeoPoint } from '@towing/api-contracts';
import { ETA_SMOOTHING_FACTOR } from '@towing/api-contracts';
import { haversineMeters } from '../pricing/pricing.math';

/**
 * §11.5's arithmetic, as pure functions.
 *
 * SEPARATED FROM THE SERVICE ON PURPOSE, mirroring `pricing.math.ts`: this is
 * the part with edge cases worth a table-driven test, and none of it needs a
 * database, a socket or a clock it did not receive as an argument. The service
 * decides WHEN to recompute; this decides WHAT the number is.
 */

/**
 * §11.5's smoothing: "displayed ETA never jumps > ±40 % in one update (blended)
 * unless a route change explains it — prevents the 7 min → 21 min → 8 min
 * whiplash that destroys trust".
 *
 * A CLAMP, NOT AN AVERAGE, and the difference matters. A moving average lags:
 * feed it a genuine 3× jump and it takes several updates to arrive, so a driver
 * who has actually hit a jam shows as 8 minutes away for two more minutes and
 * then jumps anyway. A clamp moves the displayed value as far as it is allowed
 * to, every single update, so a real change converges monotonically — 8 → 11 →
 * 15 → 19 → 21 — and the customer sees a number that is always heading the right
 * way. Trust is damaged by REVERSALS, not by movement.
 *
 * The exception §11.5 names — "unless a route change explains it" — is the
 * caller's to apply: `smoothEta` is not called when the leg changes, because the
 * previous value was measuring a different journey and blending them would be
 * meaningless rather than merely slow.
 */
export function smoothEta(previousSeconds: number | null, nextSeconds: number): number {
  if (previousSeconds === null || previousSeconds <= 0) return Math.max(0, Math.round(nextSeconds));

  const maxDelta = previousSeconds * ETA_SMOOTHING_FACTOR;
  const lower = previousSeconds - maxDelta;
  const upper = previousSeconds + maxDelta;

  return Math.max(0, Math.round(Math.min(upper, Math.max(lower, nextSeconds))));
}

/**
 * Shortest distance from a point to a polyline, in metres — §11.5's
 * "driver deviates > 200 m from polyline" trigger.
 *
 * Segment-wise point-to-segment, not point-to-vertex. A city route's vertices can
 * be hundreds of metres apart on a straight arterial, so measuring to the nearest
 * VERTEX would report a driver sitting exactly on the road as 150 m off it and
 * re-trigger a recompute every minute of a perfectly normal trip.
 *
 * The projection is done in a local flat approximation (degrees scaled by
 * `cos(lat)` for longitude) rather than on the sphere. Over the tens of metres
 * this function cares about, the error is millimetres, and the alternative is
 * spherical trigonometry per segment per ping.
 */
export function distanceToPolylineMeters(point: GeoPoint, path: readonly GeoPoint[]): number {
  if (path.length === 0) return Number.POSITIVE_INFINITY;
  if (path.length === 1) return haversineMeters(point, path[0]!);

  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i < path.length - 1; i += 1) {
    const d = distanceToSegmentMeters(point, path[i]!, path[i + 1]!);
    if (d < best) best = d;
    // Nothing beats zero, and a long route is a lot of segments per ping.
    if (best === 0) break;
  }
  return best;
}

function distanceToSegmentMeters(p: GeoPoint, a: GeoPoint, b: GeoPoint): number {
  const latScale = 111_320;
  const lngScale = 111_320 * Math.cos((p.lat * Math.PI) / 180);

  const px = p.lng * lngScale;
  const py = p.lat * latScale;
  const ax = a.lng * lngScale;
  const ay = a.lat * latScale;
  const bx = b.lng * lngScale;
  const by = b.lat * latScale;

  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;

  // A degenerate segment (two identical vertices, which Directions does emit) is
  // a point.
  if (lengthSquared === 0) return Math.hypot(px - ax, py - ay);

  // Clamped so the projection cannot fall off either end of the segment — that
  // clamp is the entire difference between this and an infinite-line distance.
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSquared));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/**
 * How much of the route is left, in metres, measured along the line rather than
 * across it.
 *
 * WHY NOT JUST THE STRAIGHT-LINE DISTANCE TO THE DESTINATION. A driver on a ring
 * road can be 800 m from the pickup as the crow flies and 4 km from it by road,
 * and the crow's answer would show a customer "2 minutes away" for six minutes —
 * the single most common complaint about live-tracking ETAs. Walking the
 * remaining polyline costs one pass over an array that is already in memory.
 *
 * Falls back to the straight line when there is no usable path, which is exactly
 * the Haversine-source case where a straight line IS the route.
 */
export function remainingRouteMeters(
  position: GeoPoint,
  destination: GeoPoint,
  path: readonly GeoPoint[],
): number {
  if (path.length < 2) return haversineMeters(position, destination);

  // Snap to the nearest segment, then sum from there to the end. `nearest` is
  // the index of the segment START, so the partial leg is position → path[i+1].
  let nearestIndex = 0;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (let i = 0; i < path.length - 1; i += 1) {
    const d = distanceToSegmentMeters(position, path[i]!, path[i + 1]!);
    if (d < nearestDistance) {
      nearestDistance = d;
      nearestIndex = i;
    }
  }

  let remaining = haversineMeters(position, path[nearestIndex + 1]!);
  for (let i = nearestIndex + 1; i < path.length - 1; i += 1) {
    remaining += haversineMeters(path[i]!, path[i + 1]!);
  }

  return remaining;
}

/**
 * Seconds from metres, given the pace the ROUTE itself implied.
 *
 * DERIVED FROM THE ORIGINAL DIRECTIONS ANSWER, not from a constant and not from
 * the driver's instantaneous speed. Directions returned a distance and a
 * traffic-aware duration for this exact journey at this exact time of day; their
 * ratio is a far better predictor for the rest of it than either a global
 * average (which knows nothing about this road) or the current speedometer
 * reading (which is 0 km/h at every red light, and would make the ETA infinite
 * four times a kilometre).
 *
 * `fallbackKph` covers the case where no route pace exists — a Haversine route,
 * or a leg whose duration the vendor omitted.
 */
export function secondsForMeters(
  meters: number,
  routeMeters: number | null,
  routeSeconds: number | null,
  fallbackKph: number,
): number {
  const paceSecondsPerMeter =
    routeMeters && routeSeconds && routeMeters > 0
      ? routeSeconds / routeMeters
      : 3600 / (fallbackKph * 1000);

  // Never zero: "arriving now" is a state the client renders, and an ETA of 0
  // seconds several hundred metres out reads as a bug.
  return Math.max(30, Math.round(meters * paceSecondsPerMeter));
}
