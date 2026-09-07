import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import type { GeoPoint } from '@towing/api-contracts';
import { ENV, type Env } from '../../config/env';
import { ExternalCallPolicy } from '../http/external-call.policy';
import type { DirectionsPort, Route, RouteLeg } from './directions.port';

/**
 * Google Directions, through §19.3's `ExternalCallPolicy`.
 *
 * NEVER EXECUTED AGAINST GOOGLE. The key exists (SETUP-CHECKLIST item 7, created
 * 21 Aug 2026) and the Directions API is enabled on it — but enabled and dormant:
 * "staged for route lines in a later phase; no code calls it". This is that code,
 * written against the documented shape and exercised only by fakes, exactly as
 * `GoogleDistanceMatrixAdapter` and Phase 13's four channel adapters were.
 * `DIRECTIONS_PROVIDER` defaults to `haversine` and production refuses to boot on
 * this adapter with no key.
 *
 * THE BUDGET IS THE OPPOSITE OF DISTANCE MATRIX'S, and that is the reason the
 * two are separate ports. Distance Matrix sits inside §7.6's 2-second estimate
 * guarantee, so it gets 1.5 s and two attempts. This runs once, at assignment,
 * after the customer has already been told a driver is coming and is watching a
 * map that works without it. Nothing is blocked on the answer, so it gets §19.3's
 * full 2–5 s band and a third attempt — and a route obtained on the third try is
 * worth far more than a fast failure, because the alternative is a straight line
 * for the whole trip.
 *
 * ONE CALL, TWO LEGS. The pickup rides as a `waypoints` entry, so a tow's
 * driver→pickup→drop journey is a single billable request that returns both legs
 * with their own polylines and durations. Asking twice would double the bill for
 * the same information on an account with no hard spend cap.
 */

/** A vendor answer that will be exactly as wrong next time. Not worth a retry. */
export class DirectionsPermanentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DirectionsPermanentError';
  }
}

interface DirectionsResponse {
  status?: string;
  error_message?: string;
  routes?: Array<{
    legs?: Array<{
      distance?: { value?: number };
      duration?: { value?: number };
      duration_in_traffic?: { value?: number };
      steps?: unknown[];
      polyline?: { points?: string };
    }>;
    overview_polyline?: { points?: string };
  }>;
}

/**
 * Statuses that mean the request is wrong, or that no road route exists between
 * these points. Retrying any of them produces the same answer and delays the
 * fallback. `OVER_QUERY_LIMIT` and `UNKNOWN_ERROR` are deliberately absent —
 * those are blips worth another attempt.
 */
const PERMANENT_STATUSES = new Set([
  'NOT_FOUND',
  'ZERO_RESULTS',
  'MAX_WAYPOINTS_EXCEEDED',
  'MAX_ROUTE_LENGTH_EXCEEDED',
  'INVALID_REQUEST',
  'REQUEST_DENIED',
]);

@Injectable()
export class GoogleDirectionsAdapter implements DirectionsPort, OnModuleInit {
  readonly vendor = 'google_directions';

  private readonly logger = new Logger(GoogleDirectionsAdapter.name);

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly policy: ExternalCallPolicy,
  ) {}

  onModuleInit(): void {
    // Guarded on the provider switch — both adapters are instantiated whichever
    // one the router prefers, so an unguarded check warns on every Haversine boot.
    if (this.env.DIRECTIONS_PROVIDER !== 'google_directions') return;
    if (!this.env.GOOGLE_MAPS_API_KEY) {
      this.logger.warn('DIRECTIONS_PROVIDER=google_directions but GOOGLE_MAPS_API_KEY is unset');
    }
  }

  async route(from: GeoPoint, via: GeoPoint | null, to: GeoPoint): Promise<Route> {
    return this.policy.run<Route>(
      {
        vendor: this.vendor,
        attempts: 3,
        backoffMs: 200,
        timeoutMs: this.env.DIRECTIONS_TIMEOUT_MS,
        isRetryable: (error) => !(error instanceof DirectionsPermanentError),
      },
      async (signal) => {
        const url = new URL(this.env.GOOGLE_DIRECTIONS_URL);
        url.searchParams.set('origin', `${from.lat},${from.lng}`);
        url.searchParams.set('destination', `${to.lat},${to.lng}`);
        if (via) url.searchParams.set('waypoints', `${via.lat},${via.lng}`);
        url.searchParams.set('mode', 'driving');
        url.searchParams.set('units', 'metric');
        // Traffic-aware, per §11.5's "Initial ETA from Directions API
        // (traffic-aware) at assignment". `departure_time=now` is what switches
        // `duration_in_traffic` on; without it Directions returns free-flow times
        // and every ETA is optimistic in exactly the conditions a tow is called.
        url.searchParams.set('departure_time', 'now');
        url.searchParams.set('key', this.env.GOOGLE_MAPS_API_KEY ?? '');

        const response = await fetch(url, { signal, headers: { accept: 'application/json' } });
        const text = await response.text();

        if (!response.ok) {
          if (response.status < 500) {
            throw new DirectionsPermanentError(`${response.status}: ${text.slice(0, 200)}`);
          }
          throw new Error(`Directions returned ${response.status}`);
        }

        const body = JSON.parse(text) as DirectionsResponse;

        // Directions answers 200 OK with a failure in the body — the same trap
        // Distance Matrix sets, and the same check.
        if (body.status && body.status !== 'OK') {
          const detail = `${body.status}${body.error_message ? `: ${body.error_message}` : ''}`;
          if (PERMANENT_STATUSES.has(body.status)) throw new DirectionsPermanentError(detail);
          throw new Error(`Directions status ${detail}`);
        }

        const vendorLegs = body.routes?.[0]?.legs;
        if (!vendorLegs?.length) {
          throw new DirectionsPermanentError('Directions returned no legs');
        }

        const legs: RouteLeg[] = vendorLegs.map((leg, index) => {
          const polyline = leg.polyline?.points;
          // A leg with no geometry is not a route we can draw. Falling back is
          // better than shipping a leg the client will render as nothing.
          if (!polyline) {
            throw new DirectionsPermanentError(`Directions leg ${index} carried no polyline`);
          }
          const distanceMeters = leg.distance?.value;
          if (typeof distanceMeters !== 'number' || !Number.isFinite(distanceMeters)) {
            throw new DirectionsPermanentError(`Directions leg ${index} carried no distance`);
          }
          // `duration_in_traffic` when the account and the request support it,
          // plain `duration` otherwise. Preferring the traffic figure is the
          // whole reason `departure_time` is set above.
          const seconds = leg.duration_in_traffic?.value ?? leg.duration?.value;
          if (typeof seconds !== 'number' || !Number.isFinite(seconds)) {
            throw new DirectionsPermanentError(`Directions leg ${index} carried no duration`);
          }

          return {
            polyline,
            distanceMeters: Math.round(distanceMeters),
            durationSeconds: Math.round(seconds),
          };
        });

        return { legs, source: 'google_directions' };
      },
    );
  }
}
