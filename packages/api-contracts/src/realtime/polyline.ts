import type { GeoPoint } from '../common/geo';

/**
 * Google's Encoded Polyline Algorithm Format, precision 5 — encode and decode.
 *
 * IT LIVES IN THE CONTRACTS PACKAGE for the reason `interpolation.ts` gives:
 * four surfaces need it — the backend (encode, for the Haversine fallback, and
 * decode for §11.5's deviation trigger), the fleet console, TowGo and
 * TowPartner — and three of them cannot import each other. It is a wire FORMAT,
 * which is exactly what this package is for.
 *
 * HAND-WRITTEN RATHER THAN `@mapbox/polyline`, which is the obvious dependency.
 * The algorithm is forty lines and has not changed since 2007; the package would
 * add a runtime dependency to the deployed image for arithmetic, and this repo
 * has repeatedly chosen the forty lines (`RedisThrottlerStorage` over two
 * published packages, `formatINR` over `Intl`, a hand-rolled Lua CAS over a
 * locking library). It is also needed in BOTH directions, which the popular
 * packages split across two.
 *
 * WHY THE SERVER DECODES AT ALL, given that it is the clients that draw. §11.5's
 * "driver deviates > 200 m from polyline" is a server-side recompute trigger, so
 * the ETA engine has to measure a point against the line. And the Haversine
 * fallback has to ENCODE, because both apps and the share page take one shape —
 * a degraded route that arrived as raw coordinates while a real one arrived
 * encoded would mean two rendering paths, and the one that is exercised least is
 * the one that breaks.
 *
 * PRECISION 5 IS ~1.1 m AT THE EQUATOR, which is finer than any GPS fix this
 * system will ever see, and is what the Directions API emits. Precision 6 exists
 * and is not what Google returns.
 */

const PRECISION = 1e5;

/**
 * Decode to `{ lat, lng }` points.
 *
 * Returns `[]` for malformed input rather than throwing. A polyline arrives from
 * a vendor or out of a database column, and the two callers — a deviation check
 * and a render — both degrade perfectly well to "no line": the deviation trigger
 * simply does not fire, and the map draws a straight leg. Throwing would take
 * down an ETA recompute over a cosmetic value.
 */
export function decodePolyline(encoded: string): GeoPoint[] {
  const points: GeoPoint[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  while (index < encoded.length) {
    const latDelta = decodeSignedValue(encoded, index);
    if (latDelta === null) return points;
    index = latDelta.index;
    lat += latDelta.value;

    const lngDelta = decodeSignedValue(encoded, index);
    if (lngDelta === null) return points;
    index = lngDelta.index;
    lng += lngDelta.value;

    points.push({ lat: lat / PRECISION, lng: lng / PRECISION });
  }

  return points;
}

function decodeSignedValue(
  encoded: string,
  start: number,
): { value: number; index: number } | null {
  let index = start;
  let shift = 0;
  let result = 0;
  let byte: number;

  do {
    if (index >= encoded.length) return null;
    byte = encoded.charCodeAt(index++) - 63;
    result |= (byte & 0x1f) << shift;
    shift += 5;
    // 32 bits of shift means the input is not a polyline; stop rather than loop.
    if (shift > 35) return null;
  } while (byte >= 0x20);

  // The low bit is the sign, and the value is inverted rather than negated.
  const value = result & 1 ? ~(result >> 1) : result >> 1;
  return { value, index };
}

/** Encode `{ lat, lng }` points. The inverse of `decodePolyline`. */
export function encodePolyline(points: readonly GeoPoint[]): string {
  let previousLat = 0;
  let previousLng = 0;
  let out = '';

  for (const point of points) {
    const lat = Math.round(point.lat * PRECISION);
    const lng = Math.round(point.lng * PRECISION);
    out += encodeSignedValue(lat - previousLat);
    out += encodeSignedValue(lng - previousLng);
    previousLat = lat;
    previousLng = lng;
  }

  return out;
}

function encodeSignedValue(value: number): string {
  let v = value < 0 ? ~(value << 1) : value << 1;
  let out = '';

  while (v >= 0x20) {
    out += String.fromCharCode((0x20 | (v & 0x1f)) + 63);
    // `>>>`, not `>>`: the sign inversion above can leave the high bit set and
    // an arithmetic shift would never terminate this loop.
    v >>>= 5;
  }

  out += String.fromCharCode(v + 63);
  return out;
}
