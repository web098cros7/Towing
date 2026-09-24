import { decodePolyline, encodePolyline } from '@towing/api-contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadEnv } from '../../config/env';
import { ExternalCallPolicy } from '../http/external-call.policy';
import { MetricsService } from '../observability/metrics.service';
import { GoogleDirectionsAdapter, legPolyline } from './google-directions.adapter';

/**
 * The Google Directions adapter against a response in Google's real shape: a
 * leg's geometry is in its STEPS (Google sends no `leg.polyline`). The adapter
 * used to read `leg.polyline`, so every real answer was rejected and each trip
 * fell back to a straight line; nothing tested it with a real-shaped response.
 */

const A = { lat: 26.1209, lng: 85.3647 };
const B = { lat: 26.1215, lng: 85.3702 };
const C = { lat: 26.1197, lng: 85.391 };

function adapter() {
  const env = loadEnv({
    ...process.env,
    DIRECTIONS_PROVIDER: 'google_directions',
    GOOGLE_MAPS_API_KEY: 'test-key',
  } as NodeJS.ProcessEnv);
  return new GoogleDirectionsAdapter(env, new ExternalCallPolicy(env, new MetricsService(env)));
}

/** A leg as Google sends it: distance, duration, steps with polylines, and no polyline of its own. */
function leg(points: Array<{ lat: number; lng: number }>, meters: number, seconds: number) {
  const steps = points.slice(1).map((to, i) => ({
    distance: { value: 1 },
    duration: { value: 1 },
    polyline: { points: encodePolyline([points[i]!, to]) },
  }));
  return { distance: { value: meters }, duration: { value: seconds }, steps };
}

describe('GoogleDirectionsAdapter', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('builds each leg from its steps, as Google sends it', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              status: 'OK',
              routes: [{ legs: [leg([A, B, C], 2600, 420)], overview_polyline: { points: 'x' } }],
            }),
            { status: 200 },
          ),
      ),
    );

    const route = await adapter().route(A, null, C);

    expect(route.source).toBe('google_directions');
    expect(route.legs).toHaveLength(1);
    expect(route.legs[0]).toMatchObject({ distanceMeters: 2600, durationSeconds: 420 });
    const shape = decodePolyline(route.legs[0]!.polyline);
    // A → B → C, the shared point between steps kept once.
    expect(shape).toHaveLength(3);
    expect(shape[1]!.lng).toBeCloseTo(B.lng, 4);
  });

  it('keeps two legs apart when there is a stop in between', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              status: 'OK',
              routes: [{ legs: [leg([A, B], 600, 60), leg([B, C], 2000, 360)] }],
            }),
            { status: 200 },
          ),
      ),
    );

    const route = await adapter().route(A, B, C);
    expect(route.legs.map((l) => decodePolyline(l.polyline).length)).toEqual([2, 2]);
  });
});

describe('legPolyline', () => {
  it('is null when no step carries a shape', () => {
    expect(legPolyline([{}, { polyline: {} }])).toBeNull();
    expect(legPolyline(undefined)).toBeNull();
  });
});
