import { Controller, Get, Inject, UseGuards } from '@nestjs/common';
import {
  placeAutocompleteQuerySchema,
  placeDetailsQuerySchema,
  placeReverseQuerySchema,
  placeRouteQuerySchema,
  type PlaceAutocompleteQuery,
  type PlaceAutocompleteResponse,
  type PlaceDetail,
  type PlaceDetailsQuery,
  type PlaceReverseQuery,
  type PlaceRouteQuery,
  type PlaceRouteResponse,
} from '@towing/api-contracts';
import { DIRECTIONS, type DirectionsPort } from '../../common/routing/directions.port';
import { ThrottleBucket } from '../../common/throttling/throttler.config';
import { ZodQuery } from '../../common/validation/zod.decorators';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Realms } from '../auth/realm.decorator';
import { PlacesService } from './places.service';

/**
 * §9.1.5's Places proxies (Phase 16, re-homed from Phase 15).
 *
 * AUTHENTICATED, not `@Public()`. These routes spend money per call against a
 * vendor quota, so an open endpoint is someone else's free geocoder and our
 * bill. A signed-in customer is also the only caller that can do anything with
 * the answer.
 *
 * BOTH REALMS. The customer types a pickup; the driver will need the same
 * lookups for a destination correction and for §20's support flows. Sharing one
 * controller keeps one cache and one quota rather than two of each.
 */
@Controller('places')
@UseGuards(JwtAuthGuard)
@Realms('customer', 'driver')
@ThrottleBucket('reads')
export class PlacesController {
  constructor(
    private readonly places: PlacesService,
    @Inject(DIRECTIONS) private readonly directions: DirectionsPort,
  ) {}

  @Get('autocomplete')
  autocomplete(
    @ZodQuery(placeAutocompleteQuerySchema) query: PlaceAutocompleteQuery,
  ): Promise<PlaceAutocompleteResponse> {
    const near =
      query.lat !== undefined && query.lng !== undefined
        ? { lat: query.lat, lng: query.lng }
        : undefined;
    return this.places.autocomplete(query.q, near);
  }

  @Get('details')
  details(@ZodQuery(placeDetailsQuerySchema) query: PlaceDetailsQuery): Promise<PlaceDetail> {
    return this.places.details(query.placeId);
  }

  /**
   * The road route between two points, for the line the booking map draws
   * from pickup to drop (owner decision, 24 Sep 2026). The same Directions
   * adapter the trip uses, so it falls back to a straight line (and says so)
   * when Google cannot answer.
   */
  @Get('route')
  async route(
    @ZodQuery(placeRouteQuerySchema) query: PlaceRouteQuery,
  ): Promise<PlaceRouteResponse> {
    const route = await this.directions.route({ lat: query.fromLat, lng: query.fromLng }, null, {
      lat: query.toLat,
      lng: query.toLng,
    });
    const leg = route.legs[0];
    return {
      polyline: leg?.polyline ?? '',
      distanceMeters: leg?.distanceMeters ?? 0,
      durationSeconds: leg?.durationSeconds ?? 0,
      source: route.source,
    };
  }

  /** The draggable map pin's label (§9.1.5 step 2). */
  @Get('reverse')
  reverse(@ZodQuery(placeReverseQuerySchema) query: PlaceReverseQuery): Promise<PlaceDetail> {
    return this.places.reverse({ lat: query.lat, lng: query.lng });
  }
}
