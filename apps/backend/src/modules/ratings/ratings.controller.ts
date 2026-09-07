import { Controller, Get, HttpCode, HttpStatus, Post, Req, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { ratingSubmitSchema, type RatingDto, type RatingStateDto, type RatingSubmit } from '@towing/api-contracts';
import { ApiException } from '../../common/errors/api-exception';
import { ZodBody, ZodParam } from '../../common/validation/zod.decorators';
import type { AuthedRequest } from '../auth/auth.types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Realms } from '../auth/realm.decorator';
import { RatingsService } from './ratings.service';

/**
 * §9.1.10's "rate & review", customer side.
 *
 * The DIRECTION IS THE ROUTE, not a body field: a client asserting which side
 * of the transaction it is on is a client voting on something the token already
 * settles.
 */
@Controller('bookings')
@UseGuards(JwtAuthGuard)
@Realms('customer')
export class CustomerRatingsController {
  constructor(private readonly ratings: RatingsService) {}

  @Post(':id/rate')
  @HttpCode(HttpStatus.OK)
  rate(
    @ZodParam(z.uuid(), 'id') bookingId: string,
    @ZodBody(ratingSubmitSchema) body: RatingSubmit,
    @Req() request: AuthedRequest,
  ): Promise<RatingDto> {
    return this.ratings.submit({
      bookingId,
      actorId: actorId(request),
      direction: 'customer_to_driver',
      input: body,
    });
  }

  /** Has this customer rated yet — what the post-trip prompt checks. */
  @Get(':id/rating')
  state(
    @ZodParam(z.uuid(), 'id') bookingId: string,
    @Req() request: AuthedRequest,
  ): Promise<RatingStateDto> {
    return this.ratings.state(bookingId, actorId(request), 'customer_to_driver');
  }
}

/** §9.2.5's other half — the driver rating the customer. */
@Controller('driver/jobs')
@UseGuards(JwtAuthGuard)
@Realms('driver')
export class DriverRatingsController {
  constructor(private readonly ratings: RatingsService) {}

  @Post(':id/rate')
  @HttpCode(HttpStatus.OK)
  rate(
    @ZodParam(z.uuid(), 'id') bookingId: string,
    @ZodBody(ratingSubmitSchema) body: RatingSubmit,
    @Req() request: AuthedRequest,
  ): Promise<RatingDto> {
    return this.ratings.submit({
      bookingId,
      actorId: actorId(request),
      direction: 'driver_to_customer',
      input: body,
    });
  }

  @Get(':id/rating')
  state(
    @ZodParam(z.uuid(), 'id') bookingId: string,
    @Req() request: AuthedRequest,
  ): Promise<RatingStateDto> {
    return this.ratings.state(bookingId, actorId(request), 'driver_to_customer');
  }
}

function actorId(request: AuthedRequest): string {
  const auth = request.auth;
  if (!auth) throw ApiException.unauthorized();
  return auth.sub;
}
