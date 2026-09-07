import { Controller, Get, HttpCode, HttpStatus, Post, Req, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import {
  paymentCaptureRequestSchema,
  paymentIntentRequestSchema,
  type PaymentCaptureRequest,
  type PaymentIntentDto,
  type PaymentIntentRequest,
  type PaymentResultDto,
  type WalletDto,
} from '@towing/api-contracts';
import { ApiException } from '../../common/errors/api-exception';
import { IdempotencyKey } from '../../common/idempotency/idempotency-key.decorator';
import { ThrottleBucket } from '../../common/throttling/throttler.config';
import { ZodBody, ZodParam } from '../../common/validation/zod.decorators';
import type { AuthedRequest } from '../auth/auth.types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Realms } from '../auth/realm.decorator';
import { PaymentsService } from './payments.service';
import { WalletService } from './wallet.service';

/**
 * §9.1.9 / §14.2's customer payment routes.
 *
 * `@Realms('customer')` is not decoration — a controller with no `@Realms()`
 * is FLEET-ONLY, so omitting it would 403 every customer who tried to pay.
 *
 * `@ThrottleBucket('money')` (20/min) on everything that writes. The bucket has
 * existed since Phase 3 and these are the routes it was named for.
 */
@Controller()
@UseGuards(JwtAuthGuard)
@Realms('customer')
export class PaymentsController {
  constructor(
    private readonly payments: PaymentsService,
    private readonly wallet: WalletService,
  ) {}

  /**
   * Opens the gateway order the app's sheet runs against.
   *
   * `Idempotency-Key` is REQUIRED, and it is the `createBooking` case rather
   * than the `retrySearch` one: one intent that survives retries, not a fresh
   * intent per attempt. A key minted per call would produce a second order for
   * a customer whose first response was simply lost.
   */
  @Post('payments/:bookingId/intent')
  @ThrottleBucket('money')
  @HttpCode(HttpStatus.CREATED)
  intent(
    @ZodParam(z.uuid(), 'bookingId') bookingId: string,
    @ZodBody(paymentIntentRequestSchema) body: PaymentIntentRequest,
    @IdempotencyKey() key: string,
    @Req() request: AuthedRequest,
  ): Promise<PaymentIntentDto> {
    return this.payments.createIntent(bookingId, customerId(request), body.purpose, key);
  }

  /**
   * Verify and settle. The route name is the plan's; the server never
   * instructs a capture (Standard Checkout auto-captures at the customer's
   * confirm) — it verifies the signature, asks the gateway what actually
   * happened, and only then writes a ledger leg.
   */
  @Post('payments/:bookingId/capture')
  @ThrottleBucket('money')
  @HttpCode(HttpStatus.OK)
  capture(
    @ZodParam(z.uuid(), 'bookingId') bookingId: string,
    @ZodBody(paymentCaptureRequestSchema) body: PaymentCaptureRequest,
    @IdempotencyKey() _key: string,
    @Req() request: AuthedRequest,
  ): Promise<PaymentResultDto> {
    return this.payments.capture(bookingId, customerId(request), body);
  }

  /**
   * §9.1.9's in-app wallet. Read-only in Phase 19 — rows arrive as §14.5
   * refunds and adjustments, never as a top-up. Top-up is a whole second
   * payment flow that neither §9.1.9 nor the plan asks for.
   */
  @Get('wallet')
  walletBalance(@Req() request: AuthedRequest): Promise<WalletDto> {
    return this.wallet.balance(customerId(request));
  }

  @Get('wallet/transactions')
  walletTransactions(@Req() request: AuthedRequest) {
    return this.wallet.transactions(customerId(request));
  }
}

// Local to each customer controller, matching `bookings.controller.ts`.
function customerId(request: AuthedRequest): string {
  const auth = request.auth;
  if (!auth) throw ApiException.unauthorized();
  return auth.sub;
}
