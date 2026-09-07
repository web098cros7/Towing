import { Controller, Get, HttpCode, HttpStatus, Post, Query, Req, UseGuards } from '@nestjs/common';
import {
  bookingCancelSchema,
  bookingCreateSchema,
  cursorQuerySchema,
  type BookingCancel,
  type BookingCancelResponse,
  type BookingCreate,
  type BookingDetail,
  type BookingListResponse,
  type BookingOtpResponse,
  type CancellationQuote,
  type WsTicketResponse,
} from '@towing/api-contracts';
import { z } from 'zod';
import { ApiException } from '../../common/errors/api-exception';
import { IdempotencyKey } from '../../common/idempotency/idempotency-key.decorator';
import { ThrottleBucket } from '../../common/throttling/throttler.config';
import { ZodBody, ZodParam, ZodQuery } from '../../common/validation/zod.decorators';
import type { AuthedRequest } from '../auth/auth.types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Realms } from '../auth/realm.decorator';
import { BookingsService } from './bookings.service';

/**
 * §16.2's booking routes.
 *
 * `@Realms('customer')` is not decoration — a controller with no `@Realms()` is
 * FLEET-ONLY (the default that let eleven pre-Phase-10 controllers keep
 * byte-identical behaviour), so omitting it here would 403 every customer.
 */
@Controller('bookings')
@UseGuards(JwtAuthGuard)
@Realms('customer')
export class BookingsController {
  constructor(private readonly bookings: BookingsService) {}

  /**
   * §3.4's confirm. `money` bucket and a REQUIRED `Idempotency-Key`.
   *
   * Both follow from what this does rather than from what it costs: it locks a
   * fare and a commission percentage, and §19.4 requires a key on "all mutating
   * booking/money endpoints" precisely so a double-tap on a flaky connection
   * cannot produce two fare-locked bookings. The key is taken as a parameter so
   * a handler cannot compile without asking for it; the global interceptor does
   * the replay bookkeeping.
   */
  @Post()
  @ThrottleBucket('money')
  @HttpCode(HttpStatus.CREATED)
  create(
    @ZodBody(bookingCreateSchema) body: BookingCreate,
    @IdempotencyKey() _key: string,
    @Req() request: AuthedRequest,
  ): Promise<BookingDetail> {
    return this.bookings.create(customerId(request), body);
  }

  @Get()
  list(
    @ZodQuery(cursorQuerySchema) query: { cursor?: string; limit: number },
    @Req() request: AuthedRequest,
  ): Promise<BookingListResponse> {
    return this.bookings.list(customerId(request), query.limit, query.cursor);
  }

  /**
   * The reconnect authority for every realtime surface built later (§19.2's
   * "apps poll REST for state every 10s"). Phase 15's `SearchingScreen` already
   * polls it.
   */
  @Get(':id')
  get(
    @ZodParam(z.uuid(), 'id') bookingId: string,
    @Req() request: AuthedRequest,
  ): Promise<BookingDetail> {
    return this.bookings.get(customerId(request), bookingId);
  }

  /** §9.1.7 — never before assignment, and the window starts on this call. */
  @Get(':id/otp')
  otp(
    @ZodParam(z.uuid(), 'id') bookingId: string,
    @Req() request: AuthedRequest,
  ): Promise<BookingOtpResponse> {
    return this.bookings.issueOtp(customerId(request), bookingId);
  }

  /**
   * §9.1.6's "retry / widen" (Phase 17).
   *
   * RE-ENTERS THE SEARCH ON THE SAME BOOKING, which is the whole point.
   * `no_drivers_found` is deliberately NOT terminal in §5.1's table — making the
   * customer start a new booking would re-quote them, possibly at a higher
   * surge, for the platform's own failure to find anyone. The fare locked at
   * confirm survives.
   *
   * `money` bucket, because it puts a fare-locked booking back into dispatch.
   */
  @Post(':id/retry-search')
  @ThrottleBucket('money')
  @HttpCode(HttpStatus.OK)
  retrySearch(
    @ZodParam(z.uuid(), 'id') bookingId: string,
    @Req() request: AuthedRequest,
  ): Promise<BookingDetail> {
    return this.bookings.retrySearch(customerId(request), bookingId);
  }

  /**
   * Mints the `/customer` handshake credential (Phase 17).
   *
   * OWNERSHIP IS PROVED HERE, ONCE. The ticket carries the booking id, so the
   * gateway's room join needs no authorization logic of its own and nothing the
   * socket says afterwards can reach a room name — the same property `/fleet`
   * gets from its tenant claim and `/driver` from its subject.
   */
  @Post(':id/realtime/ticket')
  @HttpCode(HttpStatus.OK)
  @ThrottleBucket('realtime')
  issueTicket(
    @ZodParam(z.uuid(), 'id') bookingId: string,
    @Req() request: AuthedRequest,
  ): Promise<WsTicketResponse> {
    return this.bookings.issueRealtimeTicket(customerId(request), bookingId);
  }

  /**
   * §9.1.7's "cancel button (policy-aware, shows fee before confirming)".
   *
   * A READ, not a mutation, and it runs the SAME `cancellationPolicy()` the
   * cancel route below runs. Two implementations of §3.5 — one to quote and one
   * to charge — is the arrangement where a customer is shown ₹0 and billed ₹150,
   * and Phase 19 is the phase that starts collecting.
   */
  @Get(':id/cancellation-quote')
  cancellationQuote(
    @ZodParam(z.uuid(), 'id') bookingId: string,
    @Req() request: AuthedRequest,
  ): Promise<CancellationQuote> {
    return this.bookings.cancellationQuote(customerId(request), bookingId);
  }

  /**
   * §3.5, free branches only — the chargeable tiers need a ledger leg for the
   * driver's compensation, which is Phase 19. `money` because a cancellation
   * that CAN carry a fee belongs in the same bucket as the booking it undoes.
   */
  @Post(':id/cancel')
  @ThrottleBucket('money')
  @HttpCode(HttpStatus.OK)
  cancel(
    @ZodParam(z.uuid(), 'id') bookingId: string,
    @ZodBody(bookingCancelSchema) body: BookingCancel,
    @Req() request: AuthedRequest,
  ): Promise<BookingCancelResponse> {
    return this.bookings.cancel(customerId(request), bookingId, body);
  }
}

// Local to each customer controller, matching `me.controller.ts`.
function customerId(request: AuthedRequest): string {
  const auth = request.auth;
  if (!auth) throw ApiException.unauthorized();
  return auth.sub;
}
