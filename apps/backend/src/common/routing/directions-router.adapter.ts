import { Inject, Injectable, Logger } from '@nestjs/common';
import type { GeoPoint } from '@towing/api-contracts';
import { ENV, type Env } from '../../config/env';
import { MetricsService } from '../observability/metrics.service';
import type { DirectionsPort, Route } from './directions.port';
import { GoogleDirectionsAdapter } from './google-directions.adapter';
import { HaversineDirectionsAdapter } from './haversine-directions.adapter';

/**
 * §19.2's degradation ladder for routes, written in the same commit as the
 * primary — "a ladder that has never executed is not a ladder".
 *
 * Structurally identical to `RoutingRouterAdapter` and deliberately so: it binds
 * the port, catches everything, counts the degradation separately from the
 * vendor failure `ExternalCallPolicy` has already recorded, and returns a usable
 * answer. `EtaService` asks for a route and gets one.
 *
 * IT ALSO CARRIES A KILL SWITCH, which the routing router does not.
 * `DIRECTIONS_ENABLED=false` skips Google entirely without a redeploy — §19.8's
 * pattern, and the operational lever this phase needs that the pricing one did
 * not. Directions is billed per call on an account with no hard spend cap, and
 * the honest response to "the bill is running away" at 2 a.m. is a switch, not a
 * code change. Every trip still gets a route line and an ETA; they are just
 * straight and labelled `haversine`.
 */
@Injectable()
export class DirectionsRouterAdapter implements DirectionsPort {
  private readonly logger = new Logger(DirectionsRouterAdapter.name);

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly google: GoogleDirectionsAdapter,
    private readonly haversine: HaversineDirectionsAdapter,
    private readonly metrics: MetricsService,
  ) {}

  async route(from: GeoPoint, via: GeoPoint | null, to: GeoPoint): Promise<Route> {
    if (!this.env.DIRECTIONS_ENABLED || this.env.DIRECTIONS_PROVIDER !== 'google_directions') {
      return this.haversine.route(from, via, to);
    }

    try {
      return await this.google.route(from, via, to);
    } catch (error) {
      this.metrics.observeExternalCall('directions_fallback', 'error');
      this.logger.warn(
        `Directions unavailable (${error instanceof Error ? error.name : 'unknown'}) — falling back to straight-line legs`,
      );
      return this.haversine.route(from, via, to);
    }
  }
}
