import { Controller, Delete, Get, HttpCode, HttpStatus, Post, Req, UseGuards } from '@nestjs/common';
import {
  type BookingShareResponse,
  type BookingTracking,
  type CallContact,
  type PublicTrack,
} from '@towing/api-contracts';
import { z } from 'zod';
import { ApiException } from '../../common/errors/api-exception';
import { ThrottleBucket } from '../../common/throttling/throttler.config';
import { ZodParam } from '../../common/validation/zod.decorators';
import type { AuthedRequest } from '../auth/auth.types';
import { JwtAuthGuard, Public } from '../auth/jwt-auth.guard';
import { Realms } from '../auth/realm.decorator';
import { TrackingService } from './tracking.service';

/**
 * §9.1.7's tracking surface — the customer's half.
 *
 * A SEPARATE CONTROLLER FROM `BookingsController` DESPITE SHARING ITS PREFIX,
 * for a structural reason rather than a stylistic one: `TrackingModule` imports
 * `BookingsModule` (it needs `CustomerGateway` and the state-machine constants),
 * so putting these routes on `BookingsController` would require `BookingsModule`
 * to import `TrackingModule` back. Nest resolves that cycle only with
 * `forwardRef`, which is a thing worth not having.
 */
@Controller('bookings')
@UseGuards(JwtAuthGuard)
@Realms('customer')
export class TrackingController {
  constructor(private readonly tracking: TrackingService) {}

  /**
   * §19.2's polling rung for live tracking.
   *
   * `realtime` bucket, not `reads`: the app polls this every ten seconds while a
   * socket is down, and the 120/min `reads` budget is shared with every other
   * screen the customer might open at the same time.
   */
  @Get(':id/tracking')
  @ThrottleBucket('realtime')
  liveTracking(
    @ZodParam(z.uuid(), 'id') bookingId: string,
    @Req() request: AuthedRequest,
  ): Promise<BookingTracking> {
    return this.tracking.tracking(bookingId, customerId(request));
  }

  /**
   * §11.7 — mint a share link.
   *
   * IDEMPOTENT WITHOUT AN `Idempotency-Key`, on the same reasoning
   * `POST /jobs/:id/accept` uses: the mechanism a key would provide is weaker
   * than the one the route already has. A second tap returns the LIVE token
   * rather than minting a new one, because rotating would silently kill the page
   * somebody is already watching — and that is true for a genuine retry and an
   * accidental double-tap alike, which is more than a replay cache offers.
   */
  @Post(':id/share')
  @HttpCode(HttpStatus.OK)
  share(
    @ZodParam(z.uuid(), 'id') bookingId: string,
    @Req() request: AuthedRequest,
  ): Promise<BookingShareResponse> {
    return this.tracking.share(bookingId, customerId(request));
  }

  /** §11.7's "revocable from the tracking screen". 204 — nothing to say back. */
  @Delete(':id/share')
  @HttpCode(HttpStatus.NO_CONTENT)
  revokeShare(
    @ZodParam(z.uuid(), 'id') bookingId: string,
    @Req() request: AuthedRequest,
  ): Promise<void> {
    return this.tracking.revokeShare(bookingId, customerId(request));
  }

  /** §9.1.7's call button. See `TelephonyPort` for why `masked` is on the response. */
  @Get(':id/contact')
  contact(
    @ZodParam(z.uuid(), 'id') bookingId: string,
    @Req() request: AuthedRequest,
  ): Promise<CallContact> {
    return this.tracking.customerContact(bookingId, customerId(request));
  }
}

/**
 * §11.7's public page — the only unauthenticated read of a booking in the system.
 *
 * NOT UNDER `bookings/`, NO `JwtAuthGuard`, NO `@Realms()`, and every one of
 * those is deliberate. The same shape `WebhooksController` has and for a related
 * reason: the caller cannot be asked to hold a session, so the credential is the
 * thing they were given. Here that is a 128-bit token, and the projection behind
 * it is an allowlist (`publicTrackSchema`) rather than a redaction.
 *
 * IT IS NOT `@SkipThrottling()`, unlike the webhook, and that is the difference
 * worth stating. A webhook's HMAC rejects an unsigned request in microseconds
 * before any database work, which is a better gate than a counter. This route
 * has no such gate — a valid token is a valid token, and a link that has been
 * forwarded into a group chat can be refreshed by a hundred people at once. The
 * `realtime` bucket is what keeps a shared link from becoming a load generator.
 */
@Controller('track')
export class PublicTrackController {
  constructor(private readonly tracking: TrackingService) {}

  @Get(':token')
  @Public()
  @ThrottleBucket('realtime')
  track(
    // Bounded and character-constrained rather than a bare string: this value
    // reaches a WHERE clause, and although Drizzle parameterises it, an
    // unbounded body of text arriving on an unauthenticated route is worth
    // refusing at the edge. base64url is exactly this alphabet.
    @ZodParam(z.string().min(16).max(64).regex(/^[A-Za-z0-9_-]+$/), 'token') token: string,
  ): Promise<PublicTrack> {
    return this.tracking.publicTrack(token);
  }
}

// Local to each customer controller, matching `bookings.controller.ts`.
function customerId(request: AuthedRequest): string {
  const auth = request.auth;
  if (!auth) throw ApiException.unauthorized();
  return auth.sub;
}

