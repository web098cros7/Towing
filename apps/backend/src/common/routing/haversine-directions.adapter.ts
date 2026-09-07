import { Inject, Injectable } from '@nestjs/common';
import type { GeoPoint } from '@towing/api-contracts';
import { ENV, type Env } from '../../config/env';
import { haversineMeters } from '../../modules/pricing/pricing.math';
import type { DirectionsPort, Route, RouteLeg } from './directions.port';
import { encodePolyline } from '@towing/api-contracts';

/**
 * §19.2's straight-line rung for routes and ETAs — the permanent local path, and
 * the one every Directions failure lands on.
 *
 * SAME STANDING AS `HaversineRoutingAdapter`: this is the default
 * (`DIRECTIONS_PROVIDER` defaults to `haversine`), it stays reachable after a
 * Maps key exists because the breaker falls back to it, and `pnpm backend` must
 * keep working with no Google account forever.
 *
 * IT DOES SCALE, WHERE `HaversineRoutingAdapter` DELIBERATELY DOES NOT, and the
 * difference is worth stating because the two files sit next to each other. That
 * one returns raw great-circle metres and leaves the §7.4 `haversine_road_factor`
 * to `PricingService`, because the correction is a pricing knob and geometry
 * consumers (geofences, proximity sorts) need it unscaled. This one has exactly
 * one consumer — an ETA a human reads — and an unscaled straight line under-states
 * a city tow by ~30 % (measured over seven real routes, SETUP-CHECKLIST item 7:
 * mean 1.307). Telling a customer 6 minutes when the answer is 8 is the failure
 * §11.5 spends a whole smoothing rule trying to avoid.
 *
 * The line it draws IS the straight line, not a guess at the road, and
 * `source: 'haversine'` travels with it so every surface can say "estimated"
 * instead of presenting it as a routed answer.
 */
@Injectable()
export class HaversineDirectionsAdapter implements DirectionsPort {
  readonly source = 'haversine' as const;

  constructor(@Inject(ENV) private readonly env: Env) {}

  async route(from: GeoPoint, via: GeoPoint | null, to: GeoPoint): Promise<Route> {
    const waypoints = via ? [from, via, to] : [from, to];
    const legs: RouteLeg[] = [];

    for (let i = 0; i < waypoints.length - 1; i += 1) {
      legs.push(this.leg(waypoints[i]!, waypoints[i + 1]!));
    }

    return { legs, source: 'haversine' };
  }

  private leg(from: GeoPoint, to: GeoPoint): RouteLeg {
    const straight = haversineMeters(from, to);
    const distanceMeters = Math.round(straight * this.env.HAVERSINE_ROUTE_FACTOR);

    return {
      // Two points. The clients draw it dashed and label it "direct" — the same
      // treatment the Phase 5 fleet map gives its un-routed job legs, and for the
      // same reason: a solid line would imply a driven route.
      polyline: encodePolyline([from, to]),
      distanceMeters,
      durationSeconds: Math.max(
        60,
        Math.round((distanceMeters / 1000 / this.env.FALLBACK_SPEED_KPH) * 3600),
      ),
    };
  }
}
