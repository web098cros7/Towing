import { beforeEach, describe, expect, it, vi } from 'vitest';
import { assertProductionSafety, loadEnv, type Env } from '../../config/env';
import { ExternalCallPolicy } from '../http/external-call.policy';
import { MetricsService } from '../observability/metrics.service';
import { GoogleDistanceMatrixAdapter } from './google-distance-matrix.adapter';
import { HaversineRoutingAdapter } from './haversine-routing.adapter';
import { RoutingRouterAdapter } from './routing-router.adapter';

/**
 * §19.2 — "Google Maps/Directions degraded → straight-line ETA fallback".
 *
 * THE LADDER IS TRIPPED, NOT STUBBED. The plan is explicit that the fallback
 * must be "asserted by tripping the breaker, not by stubbing the adapter away",
 * and the distinction is the whole point: swapping in a throwing fake proves the
 * router's `catch` block runs, while making the real adapter fail until
 * `ExternalCallPolicy` opens its breaker proves the DETECTOR works. A ladder
 * whose detector never fires is a ladder that never runs in production.
 *
 * `fetch` is the only thing faked here — the adapter, the policy and the router
 * are all the real objects.
 */

const BENGALURU = { lat: 12.9716, lng: 77.5946 };
const CHENNAI = { lat: 13.0827, lng: 80.2707 };

function envWith(overrides: Record<string, string> = {}): Env {
  return loadEnv({
    ...process.env,
    ROUTING_PROVIDER: 'google_distance_matrix',
    GOOGLE_MAPS_API_KEY: 'test-key',
    ROUTING_TIMEOUT_MS: '80',
    EXTERNAL_CALL_BREAKER_THRESHOLD: '3',
    EXTERNAL_CALL_BREAKER_RESET_MS: '10000',
    ...overrides,
  } as NodeJS.ProcessEnv);
}

function build(env: Env) {
  const metrics = new MetricsService(env);
  const policy = new ExternalCallPolicy(env, metrics);
  const google = new GoogleDistanceMatrixAdapter(env, policy);
  const haversine = new HaversineRoutingAdapter();
  const router = new RoutingRouterAdapter(env, google, haversine, metrics);
  return { policy, google, haversine, router };
}

function okResponse(distanceMeters: number, durationSeconds: number) {
  return new Response(
    JSON.stringify({
      status: 'OK',
      rows: [
        {
          elements: [
            { status: 'OK', distance: { value: distanceMeters }, duration: { value: durationSeconds } },
          ],
        },
      ],
    }),
    { status: 200 },
  );
}

describe('RoutingRouterAdapter — the §19.2 ladder', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('uses Distance Matrix while it is healthy', async () => {
    const { router } = build(envWith());
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => okResponse(345_678, 18_000)),
    );

    const route = await router.roadDistance(BENGALURU, CHENNAI);
    expect(route.source).toBe('google_distance_matrix');
    expect(route.distanceMeters).toBe(345_678);
    expect(route.durationSeconds).toBe(18_000);
  });

  it('opens the breaker after repeated failures, then serves Haversine', async () => {
    const env = envWith();
    const { router, policy } = build(env);

    const fetchMock = vi.fn(async () => new Response('upstream exploded', { status: 503 }));
    vi.stubGlobal('fetch', fetchMock);

    // Each `roadDistance` makes 2 attempts, so two calls is 4 failures against a
    // threshold of 3 — the breaker is open by the end of the second.
    for (let i = 0; i < 2; i += 1) {
      const degraded = await router.roadDistance(BENGALURU, CHENNAI);
      expect(degraded.source).toBe('haversine');
    }

    const callsBeforeBreakerOpen = fetchMock.mock.calls.length;
    expect(callsBeforeBreakerOpen).toBeGreaterThan(0);

    // THE ASSERTION THAT MATTERS: with the breaker open the router still answers,
    // and it answers WITHOUT touching the vendor at all. A fallback that keeps
    // calling a dead vendor is not protecting the §7.6 budget.
    const route = await router.roadDistance(BENGALURU, CHENNAI);
    expect(route.source).toBe('haversine');
    expect(fetchMock.mock.calls.length).toBe(callsBeforeBreakerOpen);

    // …and the distance is real, not a placeholder. Bengaluru→Chennai ≈ 290 km.
    expect(route.distanceMeters / 1_000).toBeGreaterThan(280);
    expect(route.distanceMeters / 1_000).toBeLessThan(300);
    expect(route.durationSeconds).toBeNull();

    policy.reset();
  });

  it('falls back on a TIMEOUT, not only on an error status', async () => {
    // The failure that actually threatens §7.6: Google does not fail, it hangs.
    const { router, policy } = build(envWith());
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            const timer = setTimeout(() => resolve(okResponse(1, 1)), 5_000);
            timer.unref?.();
          }),
      ),
    );

    const startedAt = Date.now();
    const route = await router.roadDistance(BENGALURU, CHENNAI);
    const elapsed = Date.now() - startedAt;

    expect(route.source).toBe('haversine');
    // Two attempts at an 80 ms budget, plus jitter — nowhere near the 5 s hang.
    expect(elapsed).toBeLessThan(2_000);
    policy.reset();
  });

  it('does not retry a 4xx — a bad key is not a blip', async () => {
    const { router, policy } = build(envWith());
    const fetchMock = vi.fn(async () => new Response('bad request', { status: 400 }));
    vi.stubGlobal('fetch', fetchMock);

    const route = await router.roadDistance(BENGALURU, CHENNAI);
    expect(route.source).toBe('haversine');
    // One attempt, not two: retrying a rejected key burns the §7.6 budget for a
    // result that cannot change.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    policy.reset();
  });

  it('treats a 200 carrying REQUEST_DENIED as a failure', async () => {
    // Distance Matrix answers 200 OK with the failure in the body. Trusting the
    // HTTP status alone would hand the pricing engine `undefined` metres.
    const { router, policy } = build(envWith());
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ status: 'REQUEST_DENIED', error_message: 'no key' }), {
            status: 200,
          }),
      ),
    );

    const route = await router.roadDistance(BENGALURU, CHENNAI);
    expect(route.source).toBe('haversine');
    expect(route.distanceMeters).toBeGreaterThan(0);
    policy.reset();
  });

  it('treats ZERO_RESULTS as a failure rather than a zero-kilometre tow', async () => {
    const { router, policy } = build(envWith());
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ status: 'OK', rows: [{ elements: [{ status: 'ZERO_RESULTS' }] }] }), {
            status: 200,
          }),
      ),
    );

    const route = await router.roadDistance(BENGALURU, CHENNAI);
    // A 0 km fare is the §7.1 minimum slab for a 290 km tow — silently the
    // cheapest possible answer, which is why an unroutable pair must degrade
    // rather than resolve.
    expect(route.source).toBe('haversine');
    expect(route.distanceMeters).toBeGreaterThan(280_000);
    policy.reset();
  });

  it('never calls the vendor at all when the provider is haversine', async () => {
    const { router } = build(envWith({ ROUTING_PROVIDER: 'haversine', GOOGLE_MAPS_API_KEY: '' }));
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const route = await router.roadDistance(BENGALURU, CHENNAI);
    expect(route.source).toBe('haversine');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('production safety for the routing switch', () => {
  it('refuses the real adapter with no key, and permits haversine', () => {
    const base = {
      ...process.env,
      NODE_ENV: 'production',
      JWT_ACCESS_SECRET: 'x'.repeat(48),
      FILE_SIGNING_SECRET: 'y'.repeat(48),
      PAYOUT_PROVIDER: 'razorpay_route',
      PAYOUT_WEBHOOK_SECRET: 'z'.repeat(48),
      PAYMENT_GATEWAY: 'razorpay',
      PAYMENT_WEBHOOK_SECRET: 'y'.repeat(48),
      RAZORPAY_KEY_ID: 'rzp_live_x',
      RAZORPAY_KEY_SECRET: 'secret',
      // Phase 18 added two more hard production requirements, and every
      // minimal-prod-env fixture has to satisfy them the way it already
      // satisfies the payout ones: a share link composed against localhost is
      // unrecoverable once somebody has sent it, and the direct-dial telephony
      // adapter publishes personal phone numbers (§20.4).
      PUBLIC_TRACK_BASE_URL: 'https://towing.app',
      TELEPHONY_PROVIDER: 'exotel',
      EXOTEL_SID: 'sid',
      EXOTEL_TOKEN: 'token',
      AUTH_DEV_OTP_ECHO: '',
    } as NodeJS.ProcessEnv;

    expect(() =>
      assertProductionSafety(
        loadEnv({ ...base, ROUTING_PROVIDER: 'google_distance_matrix', GOOGLE_MAPS_API_KEY: '' }),
      ),
    ).toThrow(/GOOGLE_MAPS_API_KEY/);

    // Haversine in production is ALLOWED — it is a real §19.2 path the breaker
    // falls back to anyway, so refusing it would make a Google Cloud billing
    // account a launch blocker.
    expect(() =>
      assertProductionSafety(loadEnv({ ...base, ROUTING_PROVIDER: 'haversine' })),
    ).not.toThrow();
  });
});
