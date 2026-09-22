import { Controller, HttpCode, HttpStatus, Post, Req, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import type { CashCollectedResponse } from '@towing/api-contracts';
import { ThrottleBucket } from '../../common/throttling/throttler.config';
import { ZodParam } from '../../common/validation/zod.decorators';
import type { AuthedRequest } from '../auth/auth.types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { KycApprovedGuard } from '../auth/kyc-approved.guard';
import { Realms } from '../auth/realm.decorator';
import { driverId } from '../driver-kyc/driver-kyc.controller';
import { PaymentsService } from './payments.service';

/**
 * Figma 27's driver side of cash: the driver confirms they collected the cash,
 * which is what finally moves the booking `completed → paid`.
 *
 * `KycApprovedGuard` on the whole controller, matching `JobExecutionController`
 * — a suspended driver cannot settle a job they should not be running.
 */
@Controller('jobs')
@UseGuards(JwtAuthGuard, KycApprovedGuard)
@Realms('driver')
export class DriverCashController {
  constructor(private readonly payments: PaymentsService) {}

  /** The driver's confirmation. Idempotent: a replay returns the same `paid`. */
  @Post(':id/cash-collected')
  @ThrottleBucket('money')
  @HttpCode(HttpStatus.OK)
  collected(
    @ZodParam(z.uuid(), 'id') bookingId: string,
    @Req() request: AuthedRequest,
  ): Promise<CashCollectedResponse> {
    return this.payments.confirmCashCollected(bookingId, driverId(request));
  }
}
