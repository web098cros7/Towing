import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { LatLng } from '@/types/geo';
import type { NearbySupply, NearestPartner } from '../types';
import { homeDataSource } from './homeDataSource';
import { homeKeys } from './home.keys';

/**
 * §11.9's nearby supply, for the home screen's map.
 *
 * WRITTEN IN PHASE 12 AND NEVER CALLED until now — `HomeScreen` rendered a
 * placeholder map and no markers, so this hook sat unused for four phases. Phase
 * 16 gives it both halves it was missing: a real backend to ask, and a real map
 * to draw on.
 */
export function useNearbyDrivers(near: LatLng | undefined, radiusKm = 5) {
  return useQuery({
    queryKey: homeKeys.nearbyDrivers(near?.latitude, near?.longitude, radiusKm),
    queryFn: () => homeDataSource.getNearbyDrivers(near!, radiusKm),
    enabled: !!near,
    /**
     * 15s, matching the §6.1 stale-ping default: refreshing faster than supply
     * itself can change costs requests and moves nothing, and refreshing slower
     * would show the customer drivers the matcher has already excluded.
     */
    refetchInterval: 15_000,
    staleTime: 10_000,
    // Keeps the markers on screen while a pan's new query loads, so the map does
    // not empty and refill on every small movement.
    placeholderData: (previous) => previous,
  });
}

/**
 * Assumed average urban tow-truck speed for the ETA estimate below.
 * Only used when the source gives no partner ETA (§11.9 never does today).
 */
const ESTIMATE_SPEED_KMH = 20;

export function distanceKm(a: LatLng, b: LatLng): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}

/** Whole minutes at the assumed speed, never less than 1. */
export function estimateEtaMinutes(km: number): number {
  return Math.max(1, Math.ceil((km / ESTIMATE_SPEED_KMH) * 60));
}

// ---------------------------------------------------------------------------
// Figma 07 route vector `287:2037`
// ---------------------------------------------------------------------------

/**
 * The route's path in the vector's own space (origin (108.3, 243.5) on the
 * 393 x 852 frame, y DOWN): it starts at the customer's dot (0, 85.8) and ends
 * at the truck (167.7, 0).
 *
 * `M0 85.8 L22.7 72.5 L117.7 45.5 C123.2 39.5 123.7 26.5 127.2 16.5
 *  C130.7 7 137.7 3.5 147.7 2.5 L167.7 0`
 */
const ROUTE_END = { x: 167.7, y: 85.8 };
const CURVE_STEPS = 12;

type Pt = readonly [number, number];

/** The path as points from the customer's dot, x east and y NORTH, curves sampled smoothly. */
const DESIGN_ROUTE: readonly Pt[] = (() => {
  const up = (x: number, y: number): Pt => [x, ROUTE_END.y - y];
  const points: Pt[] = [up(0, 85.8), up(22.7, 72.5), up(117.7, 45.5)];
  const cubic = (p0: Pt, p1: Pt, p2: Pt, p3: Pt) => {
    for (let i = 1; i <= CURVE_STEPS; i++) {
      const t = i / CURVE_STEPS;
      const a = (1 - t) ** 3;
      const b = 3 * (1 - t) ** 2 * t;
      const c = 3 * (1 - t) * t ** 2;
      const d = t ** 3;
      points.push([
        a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0],
        a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1],
      ]);
    }
  };
  cubic(up(117.7, 45.5), up(123.2, 39.5), up(123.7, 26.5), up(127.2, 16.5));
  cubic(up(127.2, 16.5), up(130.7, 7), up(137.7, 3.5), up(147.7, 2.5));
  points.push(up(167.7, 0));
  return points;
})();

/**
 * Figma 07's route shape stretched between a partner and the customer, partner
 * first. DATA GAP: nothing on Home supplies a street-following polyline (no
 * directions source), so this keeps the drawn line (two bends, two curves)
 * instead of a straight segment. It does not follow real streets.
 */
export function designShapedRoute(partner: LatLng, customer: LatLng): LatLng[] {
  const dLat = partner.latitude - customer.latitude;
  const dLng = partner.longitude - customer.longitude;
  return DESIGN_ROUTE.map(([x, y]) => ({
    latitude: customer.latitude + (y / ROUTE_END.y) * dLat,
    longitude: customer.longitude + (x / ROUTE_END.x) * dLng,
  })).reverse();
}

// ---------------------------------------------------------------------------
// The one partner Home draws
// ---------------------------------------------------------------------------

/**
 * Where Figma 07 frames the partner when no supply answer names one: along the
 * design's dot-to-truck vector (167.7 pt east, 85.8 pt north), 1.2 km out.
 * That distance estimates to the same whole minutes as the mock's example ETA,
 * so the callout does not change when the mock answers.
 * `homeMockSource` places its partner with the same two values.
 */
const FRAMING_DISTANCE_KM = 1.2;
const FRAMING_VECTOR = { east: 167.7, north: 85.8 };

function offsetByKm(from: LatLng, eastKm: number, northKm: number): LatLng {
  const latitude = from.latitude + northKm / 111.32;
  const longitude = from.longitude + eastKm / (111.32 * Math.cos((from.latitude * Math.PI) / 180));
  return { latitude, longitude };
}

/** The stand-in partner for "no answer yet", an error and "no drivers" (not a real driver). */
export function designFramingPartner(customer: LatLng): NearestPartner {
  const length = Math.hypot(FRAMING_VECTOR.east, FRAMING_VECTOR.north);
  const coordinate = offsetByKm(
    customer,
    (FRAMING_DISTANCE_KM * FRAMING_VECTOR.east) / length,
    (FRAMING_DISTANCE_KM * FRAMING_VECTOR.north) / length,
  );
  return {
    coordinate,
    etaMinutes: estimateEtaMinutes(distanceKm(customer, coordinate)),
    route: designShapedRoute(coordinate, customer),
    basis: 'designFraming',
  };
}

/**
 * The ONE partner Figma 07/08 draws on Home's map (glow, truck, route line,
 * "Towing partner" / "N mins away" callout).
 *
 * Always returns a partner once the customer's position is known, because the
 * design never draws Home without that group (product owner rule: no designed
 * element is dropped for missing data):
 * 1. the source's `nearestPartner` (the mock supplies the Figma example);
 * 2. otherwise the nearest §11.9 point, ETA estimated from straight-line
 *    distance (§11.9 has no partner or ETA field: data gap);
 * 3. otherwise (no answer yet, error, no drivers) `designFramingPartner`.
 * A missing route is filled with the design's route shape.
 */
export function nearestPartnerFrom(
  supply: NearbySupply | undefined,
  near: LatLng | undefined,
): NearestPartner | undefined {
  if (!near) return undefined;

  const named = supply?.nearestPartner;
  if (named) {
    return {
      basis: 'source',
      ...named,
      route:
        named.route && named.route.length >= 2
          ? named.route
          : designShapedRoute(named.coordinate, near),
    };
  }

  let best: LatLng | undefined;
  let bestKm = Number.POSITIVE_INFINITY;
  for (const point of supply?.points ?? []) {
    const km = distanceKm(near, point);
    if (km < bestKm) {
      best = point;
      bestKm = km;
    }
  }
  if (best) {
    return {
      coordinate: best,
      etaMinutes: estimateEtaMinutes(bestKm),
      route: designShapedRoute(best, near),
      basis: 'nearestSupply',
    };
  }

  return designFramingPartner(near);
}

/** Nearby supply reduced to the single partner Home's map draws. */
export function useNearestPartner(near: LatLng | undefined) {
  const query = useNearbyDrivers(near);
  const partner = useMemo(() => nearestPartnerFrom(query.data, near), [query.data, near]);
  return { ...query, partner };
}
