import { Module } from '@nestjs/common';
import { DIRECTIONS } from './directions.port';
import { DirectionsRouterAdapter } from './directions-router.adapter';
import { GoogleDirectionsAdapter } from './google-directions.adapter';
import { GoogleDistanceMatrixAdapter } from './google-distance-matrix.adapter';
import { HaversineDirectionsAdapter } from './haversine-directions.adapter';
import { HaversineRoutingAdapter } from './haversine-routing.adapter';
import { RoutingRouterAdapter } from './routing-router.adapter';
import { ROUTING } from './routing.port';

/**
 * The `money.module.ts` `PAYOUT_PROVIDER` idiom, one level up: rather than the
 * factory picking an adapter, it always binds the ROUTER, which picks per call
 * and degrades. The provider switch still lives in env; what changes is that a
 * `google_distance_matrix` deployment keeps working when Google does not.
 *
 * Both concrete adapters are instantiated whichever way `ROUTING_PROVIDER` is
 * set — which is exactly why neither constructor may validate a credential or
 * open a connection. `GoogleDistanceMatrixAdapter` does its check in
 * `onModuleInit`, guarded on the switch.
 *
 * Not `@Global()`: unlike storage or notifications this has exactly one consumer
 * family (pricing, and later booking creation and the ETA engine), so the import
 * edge is worth declaring.
 *
 * TWO PORTS IN ONE MODULE (Phase 18). `ROUTING` answers "how far by road" for
 * §7's fare bands; `DIRECTIONS` answers "what is the route and how long" for
 * §11.4/§11.5. They share this module because they share a vendor account and a
 * degradation philosophy, and they are separate ports because they have opposite
 * latency budgets and separate breakers — see `directions.port.ts`.
 */
@Module({
  providers: [
    HaversineRoutingAdapter,
    GoogleDistanceMatrixAdapter,
    RoutingRouterAdapter,
    { provide: ROUTING, useExisting: RoutingRouterAdapter },
    HaversineDirectionsAdapter,
    GoogleDirectionsAdapter,
    DirectionsRouterAdapter,
    { provide: DIRECTIONS, useExisting: DirectionsRouterAdapter },
  ],
  exports: [
    ROUTING,
    HaversineRoutingAdapter,
    GoogleDistanceMatrixAdapter,
    DIRECTIONS,
    HaversineDirectionsAdapter,
    GoogleDirectionsAdapter,
  ],
})
export class RoutingModule {}
