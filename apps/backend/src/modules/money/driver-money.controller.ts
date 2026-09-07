import { Controller, Delete, Get, HttpCode, HttpStatus, Post, Req, UseGuards } from '@nestjs/common';
import {
  cursorQuerySchema,
  driverEarningsQuerySchema,
  payoutAccountLinkSchema,
  payoutRequestSchema,
  payoutsQuerySchema,
  type DriverEarningsQuery,
  type DriverEarningsSummaryDto,
  type PayoutAccountLinkRequest,
  type PayoutRequest,
  type PayoutsQuery,
} from '@towing/api-contracts';
import { ApiException } from '../../common/errors/api-exception';
import { IdempotencyKey } from '../../common/idempotency/idempotency-key.decorator';
import { ThrottleBucket } from '../../common/throttling/throttler.config';
import { ZodBody, ZodQuery } from '../../common/validation/zod.decorators';
import type { AuthedRequest } from '../auth/auth.types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Realms } from '../auth/realm.decorator';
import { DriverEarningsService } from './driver-earnings.service';
import { DriverPayoutAccountService } from './driver-payout-account.service';
import { PayoutsService } from './payouts.service';

/**
 * §9.2.4's driver money surface — earnings, wallet, payouts and Route
 * onboarding.
 *
 * ⚠ DELIBERATELY NO `KycApprovedGuard`, following the precedent
 * `driver-notifications.controller.ts` set and for the same reason. §3.1's KYC
 * gate governs who may RECEIVE WORK. Withholding money a driver has already
 * earned is not a KYC decision — it is a payout hold, and if the platform ever
 * wants one it belongs in §9.4.10's Finance queue where a human takes it and
 * `admin_actions` records it. A driver whose documents expired can still see
 * what they are owed.
 *
 * `@Realms('driver')` is not optional: a controller with no `@Realms()` is
 * FLEET-ONLY, so omitting it would 403 every driver.
 */
@Controller('driver')
@UseGuards(JwtAuthGuard)
@Realms('driver')
export class DriverMoneyController {
  constructor(
    private readonly earnings: DriverEarningsService,
    private readonly payouts: PayoutsService,
    private readonly account: DriverPayoutAccountService,
  ) {}

  @Get('earnings')
  summary(
    @ZodQuery(driverEarningsQuerySchema) query: DriverEarningsQuery,
    @Req() request: AuthedRequest,
  ): Promise<DriverEarningsSummaryDto> {
    return this.earnings.summary(driverId(request), query);
  }

  /** The §9.2.4 per-trip breakdown: gross → commission (band + %) → net. */
  @Get('earnings/trips')
  trips(
    @ZodQuery(cursorQuerySchema) query: { cursor?: string; limit: number },
    @Req() request: AuthedRequest,
  ) {
    return this.earnings.trips(driverId(request), query);
  }

  @Get('earnings/weekly')
  weekly(@Req() request: AuthedRequest) {
    return this.earnings.weekly(driverId(request));
  }

  /** The raw ledger feed — payouts, adjustments and §14.5 reversals included. */
  @Get('wallet/transactions')
  transactions(
    @ZodQuery(cursorQuerySchema) query: { cursor?: string; limit: number },
    @Req() request: AuthedRequest,
  ) {
    return this.earnings.transactions(driverId(request), query);
  }

  /**
   * §14.4's payout request.
   *
   * The wallet is debited HERE, at request time, whether or not Finance has to
   * approve it — that is what stops a driver spending the same balance twice
   * while the queue is being worked. Approval gates only the vendor call.
   */
  @Post('payouts')
  @ThrottleBucket('money')
  @HttpCode(HttpStatus.CREATED)
  requestPayout(
    @ZodBody(payoutRequestSchema) body: PayoutRequest,
    @IdempotencyKey() key: string,
    @Req() request: AuthedRequest,
  ) {
    return this.payouts.request(
      { ownerType: 'driver', ownerId: driverId(request) },
      body.amountPaise,
      key,
    );
  }

  @Get('payouts')
  listPayouts(
    @ZodQuery(payoutsQuerySchema) query: PayoutsQuery,
    @Req() request: AuthedRequest,
  ) {
    return this.payouts.list({ ownerType: 'driver', ownerId: driverId(request) }, query);
  }

  @Get('payout-account')
  payoutAccount(@Req() request: AuthedRequest) {
    return this.account.get(driverId(request));
  }

  /**
   * Route linked-account onboarding, driver side — and it needed ZERO adapter
   * change: `PayoutProviderPort.linkAccount` has taken `ownerType` since Phase
   * 7, and `RazorpayRouteAdapter` already branches `vendor` for a fleet and
   * `employee` for a driver.
   */
  @Post('payout-account')
  @ThrottleBucket('money')
  @HttpCode(HttpStatus.OK)
  linkPayoutAccount(
    @ZodBody(payoutAccountLinkSchema) body: PayoutAccountLinkRequest,
    @Req() request: AuthedRequest,
  ) {
    return this.account.link(driverId(request), body);
  }

  @Delete('payout-account')
  @HttpCode(HttpStatus.NO_CONTENT)
  async unlinkPayoutAccount(@Req() request: AuthedRequest): Promise<void> {
    await this.account.unlink(driverId(request));
  }
}

function driverId(request: AuthedRequest): string {
  const auth = request.auth;
  if (!auth) throw ApiException.unauthorized();
  return auth.sub;
}
