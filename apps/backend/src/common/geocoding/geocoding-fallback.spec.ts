import { beforeEach, describe, expect, it, vi } from 'vitest';
import { assertProductionSafety, loadEnv, type Env } from '../../config/env';
import { ExternalCallPolicy } from '../http/external-call.policy';
import { MetricsService } from '../observability/metrics.service';
import { GeocodingRouterAdapter } from './geocoding-router.adapter';
import { GooglePlacesAdapter } from './google-places.adapter';
import { LocalGazetteerAdapter } from './local-gazetteer.adapter';

/**
 * §19.2 — "Places degraded → local gazetteer".
 *
 * THE LADDER IS TRIPPED, NOT STUBBED, exactly as `routing-fallback.spec.ts`
 * argues for its own: swapping in a throwing fake proves the router's `catch`
 * block runs, while making the REAL adapter fail until `ExternalCallPolicy`
 * opens its breaker proves the DETECTOR works. A ladder whose detector never
 * fires is a ladder that never runs in production.
 *
 * `fetch` is the only thing faked here — the adapter, the policy and the router
 * are all the real objects.
 */

const BENGALURU = { lat: 12.9716, lng: 77.5946 };

function envWith(overrides: Record<string, string> = {}): Env {
  return loadEnv({
    ...process.env,
    GEOCODING_PROVIDER: 'google_places',
    GOOGLE_MAPS_API_KEY: 'test-key',
    GEOCODING_TIMEOUT_MS: '80',
    EXTERNAL_CALL_BREAKER_THRESHOLD: '3',
    EXTERNAL_CALL_BREAKER_RESET_MS: '10000',
    ...overrides,
  } as NodeJS.ProcessEnv);
}

function build(env: Env) {
  const metrics = new MetricsService(env);
  const policy = new ExternalCallPolicy(env, metrics);
  const google = new GooglePlacesAdapter(env, policy);
  const local = new LocalGazetteerAdapter();
  const router = new GeocodingRouterAdapter(env, google, local, metrics);
  return { policy, google, local, router };
}

function predictionsResponse(...names: string[]) {
  return new Response(
    JSON.stringify({
      status: 'OK',
      predictions: names.map((name, index) => ({
        place_id: `google-${index}`,
        structured_formatting: { main_text: name, secondary_text: 'Somewhere' },
      })),
    }),
    { status: 200 },
  );
}

describe('GeocodingRouterAdapter — the §19.2 ladder', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('uses Places while it is healthy', async () => {
    const { router } = build(envWith());
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => predictionsResponse('Indiranagar Extension')),
    );

    const { results, source } = await router.autocomplete('indira', BENGALURU);
    expect(source).toBe('google_places');
    expect(results[0]?.primary).toBe('Indiranagar Extension');
  });

  it('falls back to the gazetteer once the breaker has actually opened', async () => {
    const { router } = build(envWith());
    const fetchMock = vi.fn(async () => new Response('boom', { status: 500 }));
    vi.stubGlobal('fetch', fetchMock);

    // Drive the REAL breaker open. Each `autocomplete` makes two attempts, so
    // two calls is comfortably past the threshold of three failures.
    await router.autocomplete('indira', BENGALURU);
    await router.autocomplete('indira', BENGALURU);

    // THE ASSERTION IS THE CALL COUNT, not a peek at the breaker's state. That
    // an open circuit stops calling the vendor is the behaviour worth pinning: a
    // degraded product must not also hammer a struggling provider, and a
    // fallback that still made the request would pass every other check here.
    const callsBefore = fetchMock.mock.calls.length;
    const { results, source } = await router.autocomplete('indira', BENGALURU);

    expect(source).toBe('local');
    expect(results[0]?.primary).toBe('Indiranagar');
    expect(fetchMock.mock.calls.length).toBe(callsBefore);
  });

  it('degrades a hung Places call rather than making the customer wait', async () => {
    const { router } = build(envWith());
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async (_url: unknown, init?: { signal?: AbortSignal }) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
          }),
      ),
    );

    const { source, results } = await router.autocomplete('koram', BENGALURU);

    expect(source).toBe('local');
    expect(results[0]?.primary).toBe('Koramangala');
  });

  it('does NOT degrade on a legitimately empty Google result', async () => {
    // ZERO_RESULTS from a healthy vendor is a real answer — "we have never heard
    // of that either". Falling through to a twenty-one-entry gazetteer would
    // make the two rungs disagree about what exists, and a customer would see
    // suggestions appear only for the places we happen to hardcode.
    const { router } = build(envWith());
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ status: 'ZERO_RESULTS' }), { status: 200 })),
    );

    const { results, source } = await router.autocomplete('indira', BENGALURU);

    expect(source).toBe('google_places');
    expect(results).toEqual([]);
  });

  it('treats REQUEST_DENIED as permanent — no retry, straight to the fallback', async () => {
    const { router } = build(envWith());
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ status: 'REQUEST_DENIED', error_message: 'bad key' }), {
          status: 200,
        }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const { source } = await router.autocomplete('indira', BENGALURU);

    expect(source).toBe('local');
    // One attempt, not two: a key that is wrong will be exactly as wrong next
    // time, and a human is waiting.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('uses the gazetteer directly when the provider switch says local', async () => {
    const { router } = build(envWith({ GEOCODING_PROVIDER: 'local' }));
    const fetchMock = vi.fn(async () => predictionsResponse('Should not be called'));
    vi.stubGlobal('fetch', fetchMock);

    const { source } = await router.autocomplete('indira', BENGALURU);

    expect(source).toBe('local');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('resolves a local place id without asking Google, even on the google rung', async () => {
    // A client can hold a `local:` id from before a key was configured. The
    // prefix is ours and Google would reject it, so it must never be sent.
    const { router } = build(envWith());
    const fetchMock = vi.fn(async () => predictionsResponse('nope'));
    vi.stubGlobal('fetch', fetchMock);

    const { result, source } = await router.details('local:indiranagar');

    expect(source).toBe('local');
    expect(result?.point.lat).toBeCloseTo(12.9784, 4);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reverse-geocodes through the fallback when Places is unreachable', async () => {
    const { router } = build(envWith());
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('ENOTFOUND');
      }),
    );

    const { result, source } = await router.reverse({ lat: 12.9788, lng: 77.6444 });

    expect(source).toBe('local');
    expect(result.label).toBe('Indiranagar');
    // The PIN's coordinate, not the locality centroid.
    expect(result.point).toEqual({ lat: 12.9788, lng: 77.6444 });
  });
});

describe('production safety', () => {
  it('refuses google_places with no key', () => {
    // The same rule `ROUTING_PROVIDER` already enforces: `local` in production
    // is ALLOWED (it is a real §19.2 path the breaker falls back to anyway), and
    // refusing it would make a Google Cloud billing account a launch blocker.
    // What is refused is the misconfiguration.
    const env = loadEnv({
      ...process.env,
      NODE_ENV: 'production',
      GEOCODING_PROVIDER: 'google_places',
      GOOGLE_MAPS_API_KEY: '',
      JWT_ACCESS_SECRET: 'x'.repeat(48),
      FILE_SIGNING_SECRET: 'y'.repeat(48),
      PAYOUT_PROVIDER: 'razorpay_route',
      PAYOUT_WEBHOOK_SECRET: 'z'.repeat(32),
      PAYMENT_GATEWAY: 'razorpay',
      PAYMENT_WEBHOOK_SECRET: 'y'.repeat(32),
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
    } as NodeJS.ProcessEnv);

    expect(() => assertProductionSafety(env)).toThrow(/GOOGLE_MAPS_API_KEY is required/);
  });

  it('allows local in production', () => {
    const env = loadEnv({
      ...process.env,
      NODE_ENV: 'production',
      GEOCODING_PROVIDER: 'local',
      JWT_ACCESS_SECRET: 'x'.repeat(48),
      FILE_SIGNING_SECRET: 'y'.repeat(48),
      PAYOUT_PROVIDER: 'razorpay_route',
      PAYOUT_WEBHOOK_SECRET: 'z'.repeat(32),
      PAYMENT_GATEWAY: 'razorpay',
      PAYMENT_WEBHOOK_SECRET: 'y'.repeat(32),
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
    } as NodeJS.ProcessEnv);

    expect(() => assertProductionSafety(env)).not.toThrow();
  });
});
