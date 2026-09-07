import type { GeoPoint } from '@towing/api-contracts';

/**
 * §11.4/§11.5 — the ROUTE, as opposed to the distance (Phase 18).
 *
 * `routing.port.ts` said this was coming and why it was not there yet: "§11.5
 * will need routes and live ETAs in Phase 18 and can be slower. This port serves
 * the first; the polyline half stays out until something needs to draw one."
 * Something now draws one.
 *
 * A SEPARATE PORT, NOT A METHOD ON `RoutingPort`, for three reasons that all
 * come down to the two having different obligations:
 *
 *   · Different budget. `roadDistance` runs inside §7.6's 2-second estimate
 *     guarantee and is capped at 1.5 s. This runs once at assignment, after the
 *     customer has already been told a driver is coming, and can afford a longer
 *     timeout and a third attempt.
 *   · Different vendor. Distance Matrix and Directions are two billable Google
 *     APIs with two `ExternalCallPolicy` breakers. One port with two vendors
 *     inside it would mean a Distance Matrix outage tripping the ETA engine.
 *   · Different call shape. Distance Matrix is a matrix of origins against
 *     destinations. Directions is one journey with waypoints, which is precisely
 *     what lets a single request return both legs of a tow.
 *
 * ONE CALL PER BOOKING. §11.5's literal reading is a Directions request at
 * assignment and a recompute every 60 s thereafter; at 500 concurrent bookings
 * that is 500 billable calls a minute against an account with no hard spend cap
 * (SETUP-CHECKLIST item 7, both cap routes checked and both closed). The engine
 * therefore asks once, with the pickup as a waypoint so both legs come back
 * together, and derives every later estimate locally. §11.5's recompute triggers
 * are honoured — they just do not re-bill.
 */

/** One leg of a journey: driver→pickup, then pickup→drop. */
export interface RouteLeg {
  /**
   * Google's encoded polyline algorithm, at precision 5. Passed to both apps
   * verbatim; `react-native-maps` and MapLibre both want the decoded points, so
   * `polyline.ts` beside this file decodes and the clients decode their own.
   *
   * Encoded rather than an array of points because a 200-point city route is
   * ~4 KB as JSON pairs and ~500 bytes encoded, and it rides every tracking
   * poll and every share-page render.
   */
  polyline: string;
  distanceMeters: number;
  /** Traffic-aware where the vendor supplies it; a modelled guess on the fallback. */
  durationSeconds: number;
}

export interface Route {
  /** `[driver→pickup]`, or `[driver→pickup, pickup→drop]` when a drop exists. */
  legs: RouteLeg[];
  source: RouteSource;
}

export type RouteSource = 'google_directions' | 'haversine';

export interface DirectionsPort {
  /**
   * `via` is the pickup and is what makes this one call instead of two. It is
   * optional only so a drop-less service (roadside assistance, jump start) has a
   * shape to ask with; when `via` is null the single leg runs `from → to`.
   */
  route(from: GeoPoint, via: GeoPoint | null, to: GeoPoint): Promise<Route>;
}

export const DIRECTIONS = Symbol('DIRECTIONS');
