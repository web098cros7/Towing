import type { FareEstimate } from '../../types';

/** The route numbers 14's callout and 15's subtitle draw. */
export type RouteFacts = { distanceKm: number; etaMinutes: number };

type Point = { latitude: number; longitude: number };

/**
 * The server's straight-line fallback, mirrored so the design's ETA slot is
 * never empty:
 * - `HAVERSINE_ROUTE_FACTOR` / `charge_config.haversine_road_factor`, 1.3;
 * - `FALLBACK_SPEED_KPH`, 22, the speed `HaversineDirectionsAdapter` turns a
 *   straight line into the ETA a customer reads, floored at 1 minute.
 */
const ROAD_FACTOR = 1.3;
const FALLBACK_SPEED_KPH = 22;

/** "8.2": one decimal, as drawn in "8.2 km". */
export function formatKm(distanceKm: number): string {
  return distanceKm.toFixed(1);
}

/** Minutes for a billed (road) distance at the server's fallback speed. */
function fallbackEtaMinutes(distanceKm: number): number {
  return Math.max(1, Math.round((distanceKm / FALLBACK_SPEED_KPH) * 60));
}

/**
 * Distance and ETA before any quote exists (or when the quote failed), from the
 * booking's own pickup and drop. Replaced by the quote's numbers as soon as one
 * lands.
 */
export function straightLineRoute(pickup: Point, drop: Point | null): RouteFacts {
  if (!drop) return { distanceKm: 0, etaMinutes: fallbackEtaMinutes(0) };
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(drop.latitude - pickup.latitude);
  const dLng = toRad(drop.longitude - pickup.longitude);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLng / 2) ** 2 * Math.cos(toRad(pickup.latitude)) * Math.cos(toRad(drop.latitude));
  const km = 2 * 6_371.0088 * Math.asin(Math.min(1, Math.sqrt(a))) * ROAD_FACTOR;
  const rounded = Math.round(km * 100) / 100;
  return { distanceKm: rounded, etaMinutes: fallbackEtaMinutes(rounded) };
}

/**
 * The quote's distance and ETA, else the straight-line preview. `etaMinutes`
 * is null in the contract when the server routed without a duration; the slot
 * then takes the server's own fallback ETA for that distance.
 */
export function routeFacts(estimate: FareEstimate | undefined, preview: RouteFacts): RouteFacts {
  if (!estimate) return preview;
  return {
    distanceKm: estimate.distanceKm,
    etaMinutes: estimate.etaMinutes ?? fallbackEtaMinutes(estimate.distanceKm),
  };
}

/** 14 Route callout E4: `{km} km · {eta} min` (U+00B7 middle dot, "min"). */
export function routeCalloutText(route: RouteFacts): string {
  return `${formatKm(route.distanceKm)} km · ${route.etaMinutes} min`;
}

/**
 * 15 subtitle F2b: `Tow a {vehicle} · {method} · {km} km · about {eta} mins`
 * (U+00B7 middle dots, "mins").
 */
export function fareSubtitleText(
  route: RouteFacts,
  vehicleName: string,
  towMethod: string,
): string {
  return `Tow a ${vehicleName} · ${towMethod} · ${formatKm(route.distanceKm)} km · about ${
    route.etaMinutes
  } mins`;
}
