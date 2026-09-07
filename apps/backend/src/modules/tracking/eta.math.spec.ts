import { describe, expect, it } from 'vitest';
import { decodePolyline, encodePolyline } from '@towing/api-contracts';
import {
  distanceToPolylineMeters,
  remainingRouteMeters,
  secondsForMeters,
  smoothEta,
} from './eta.math';

/**
 * §11.5's arithmetic, table-driven — the half of the ETA engine that has edge
 * cases and needs no database, socket or clock.
 */

describe('§11.5 ETA smoothing', () => {
  it('passes the first estimate through untouched', () => {
    // There is nothing to smooth against. Clamping a first value toward a
    // previous one that does not exist would mean the customer's very first ETA
    // was invented rather than measured.
    expect(smoothEta(null, 600)).toBe(600);
  });

  it('never moves the displayed value more than ±40 % in one step', () => {
    // §11.5's literal bound. 600 s ± 40 % is [360, 840].
    expect(smoothEta(600, 6_000)).toBe(840);
    expect(smoothEta(600, 10)).toBe(360);
  });

  it('passes a change that is already inside the bound', () => {
    expect(smoothEta(600, 700)).toBe(700);
    expect(smoothEta(600, 500)).toBe(500);
  });

  it('converges monotonically on a real jump rather than lagging', () => {
    // The property that makes a CLAMP the right tool and a moving average the
    // wrong one: repeated updates walk steadily toward the truth and never
    // reverse. §11.5's stated enemy is the "7 min → 21 min → 8 min" whiplash,
    // which is a REVERSAL, not movement.
    let displayed = 600;
    const truth = 2_400;
    const seen: number[] = [];
    for (let i = 0; i < 6; i += 1) {
      displayed = smoothEta(displayed, truth);
      seen.push(displayed);
    }

    for (let i = 1; i < seen.length; i += 1) {
      expect(seen[i]!, 'must never go back down while converging upward').toBeGreaterThanOrEqual(
        seen[i - 1]!,
      );
    }
    expect(seen.at(-1)).toBeGreaterThan(2_000);
  });

  it('never displays a negative estimate', () => {
    expect(smoothEta(100, -50)).toBe(60);
    expect(smoothEta(null, -1)).toBe(0);
  });

  it('treats a zero or missing previous as no previous', () => {
    // A stored 0 would otherwise clamp every subsequent estimate to 0 forever,
    // since 0 ± 40 % is 0.
    expect(smoothEta(0, 900)).toBe(900);
  });
});

describe('§11.5 deviation detection', () => {
  // A short east-west line at the equator-ish latitude of Bengaluru.
  const path = [
    { lat: 12.9716, lng: 77.5946 },
    { lat: 12.9716, lng: 77.6046 },
  ];

  it('measures to the SEGMENT, not to the nearest vertex', () => {
    // A point exactly on the line, halfway between two vertices ~1 km apart.
    // A vertex-based measure would call this ~540 m off route and re-trigger a
    // recompute on every straight arterial in the city.
    const midpoint = { lat: 12.9716, lng: 77.5996 };
    expect(distanceToPolylineMeters(midpoint, path)).toBeLessThan(1);
  });

  it('reports a real deviation in metres', () => {
    // ~0.0018° of latitude is ~200 m.
    const off = { lat: 12.9734, lng: 77.5996 };
    const distance = distanceToPolylineMeters(off, path);
    expect(distance).toBeGreaterThan(180);
    expect(distance).toBeLessThan(220);
  });

  it('clamps to the segment ends rather than to an infinite line', () => {
    // Well past the eastern end. An un-clamped projection would measure the
    // perpendicular to the LINE — near zero — and never report the driver as
    // having left the route.
    const beyond = { lat: 12.9716, lng: 77.6146 };
    expect(distanceToPolylineMeters(beyond, path)).toBeGreaterThan(900);
  });

  it('is infinite for an empty path, so the trigger cannot fire on no route', () => {
    expect(distanceToPolylineMeters({ lat: 1, lng: 1 }, [])).toBe(Number.POSITIVE_INFINITY);
  });

  it('survives a degenerate segment', () => {
    // Directions does emit repeated vertices; a zero-length segment must not
    // divide by zero.
    const degenerate = [
      { lat: 12.9716, lng: 77.5946 },
      { lat: 12.9716, lng: 77.5946 },
    ];
    expect(distanceToPolylineMeters({ lat: 12.9716, lng: 77.5946 }, degenerate)).toBeLessThan(1);
  });
});

describe('§11.5 remaining distance', () => {
  /**
   * An L-shaped route: 1 km east, then 1 km north. The straight line from the
   * start to the end is ~1.41 km, the road is ~2.2 km.
   *
   * This is the ring-road case §11.5's ETA is most often wrong about, reduced to
   * two segments.
   */
  const lShape = [
    { lat: 12.9716, lng: 77.5946 },
    { lat: 12.9716, lng: 77.6038 },
    { lat: 12.9806, lng: 77.6038 },
  ];
  const destination = lShape[2]!;

  it('follows the route rather than cutting the corner', () => {
    const start = lShape[0]!;
    const along = remainingRouteMeters(start, destination, lShape);
    const crow = remainingRouteMeters(start, destination, []);

    expect(along).toBeGreaterThan(crow * 1.4);
    expect(along).toBeGreaterThan(1_900);
  });

  it('shrinks as the driver progresses along the line', () => {
    const early = remainingRouteMeters(lShape[0]!, destination, lShape);
    const corner = remainingRouteMeters(lShape[1]!, destination, lShape);
    expect(corner).toBeLessThan(early);
  });

  it('falls back to the straight line when there is no usable path', () => {
    // Which is exactly right for a Haversine-sourced route: there, the straight
    // line IS the route.
    const straight = remainingRouteMeters(lShape[0]!, destination, []);
    expect(straight).toBeGreaterThan(1_000);
    expect(straight).toBeLessThan(1_600);
  });
});

describe('§11.5 pace', () => {
  it("uses the route's own implied pace when the vendor gave one", () => {
    // 10 km in 1200 s is 30 km/h. 5 km left should be ~600 s, regardless of the
    // fallback speed — the route knew about this road and the constant does not.
    expect(secondsForMeters(5_000, 10_000, 1_200, 22)).toBe(600);
  });

  it('falls back to the configured speed when the route has no duration', () => {
    // 22 km/h over 5 km ≈ 818 s.
    const seconds = secondsForMeters(5_000, null, null, 22);
    expect(seconds).toBeGreaterThan(780);
    expect(seconds).toBeLessThan(860);
  });

  it('never returns zero', () => {
    // "Arriving now" is a state the client renders. A 0-second ETA several
    // metres out reads as a bug rather than as an arrival.
    expect(secondsForMeters(1, 10_000, 1_200, 22)).toBe(30);
    expect(secondsForMeters(0, null, null, 22)).toBe(30);
  });
});

describe('Google encoded polyline', () => {
  it('round-trips the example from Google’s own documentation', () => {
    // The canonical fixture: (38.5,-120.2) (40.7,-120.95) (43.252,-126.453).
    const encoded = '_p~iF~ps|U_ulLnnqC_mqNvxq`@';
    const points = decodePolyline(encoded);

    expect(points).toHaveLength(3);
    expect(points[0]!.lat).toBeCloseTo(38.5, 5);
    expect(points[0]!.lng).toBeCloseTo(-120.2, 5);
    expect(points[2]!.lat).toBeCloseTo(43.252, 5);
    expect(points[2]!.lng).toBeCloseTo(-126.453, 5);

    expect(encodePolyline(points)).toBe(encoded);
  });

  it('encodes and decodes a dense urban route without drift', () => {
    const original = Array.from({ length: 200 }, (_, i) => ({
      lat: Number((12.9716 + i * 0.0004).toFixed(5)),
      lng: Number((77.5946 + i * 0.0003).toFixed(5)),
    }));

    const round = decodePolyline(encodePolyline(original));
    expect(round).toHaveLength(original.length);
    for (let i = 0; i < original.length; i += 1) {
      expect(round[i]!.lat).toBeCloseTo(original[i]!.lat, 5);
      expect(round[i]!.lng).toBeCloseTo(original[i]!.lng, 5);
    }
  });

  it('returns what it could read from malformed input rather than throwing', () => {
    // A polyline arrives from a vendor or out of a database column, and both
    // callers degrade fine to "no line". Throwing would take down an ETA
    // recompute over a cosmetic value.
    expect(() => decodePolyline('!!!not a polyline!!!')).not.toThrow();
    expect(decodePolyline('')).toEqual([]);
  });

  it('handles the southern and western hemispheres', () => {
    // The sign is carried in the low bit and the value is INVERTED rather than
    // negated; getting that wrong is silent and only shows up below the equator.
    const points = [
      { lat: -33.8688, lng: 151.2093 },
      { lat: -37.8136, lng: 144.9631 },
    ];
    const round = decodePolyline(encodePolyline(points));
    expect(round[0]!.lat).toBeCloseTo(-33.8688, 5);
    expect(round[1]!.lng).toBeCloseTo(144.9631, 5);
  });
});
