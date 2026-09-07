import { Controller, Get, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import {
  payoutRequestSchema,
  payoutsQuerySchema,
  type FleetId,
  type PayoutRequest,
  type PayoutsQuery,
} from '@towing/api-contracts';
import { IdempotencyKey } from '../../common/idempotency/idempotency-key.decorator';
import { CurrentFleet } from '../../common/tenancy/current-fleet.decorator';
import { FleetScopeGuard } from '../../common/tenancy/fleet-scope.guard';
import { ProfileCompleteGuard } from '../../common/tenancy/profile-complete.guard';
import { ThrottleBucket } from '../../common/throttling/throttler.config';
import { ZodBody, ZodQuery } from '../../common/validation/zod.decorators';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PayoutsService } from './payouts.service';

/** §9.3.7 / §16.4: `POST /fleet/payouts`, `GET /fleet/payouts`. */
@Controller('fleet/payouts')
@UseGuards(JwtAuthGuard, FleetScopeGuard)
export class PayoutsController {
  constructor(private readonly payouts: PayoutsService) {}

  /**
   * The first route to use the `money` bucket (20/min) — it has existed since
   * Phase 3 and been applied to nothing.
   *
   * `ProfileCompleteGuard` enforces §9.3.1's "account usable only after
   * business profile completes" here, where money actually leaves.
   */
  @Post()
  @ThrottleBucket('money')
  @UseGuards(ProfileCompleteGuard)
  @HttpCode(HttpStatus.CREATED)
  request(
    @CurrentFleet() fleetId: FleetId,
    @ZodBody(payoutRequestSchema) body: PayoutRequest,
    @IdempotencyKey() key: string,
  ) {
    return this.payouts.request({ ownerType: 'fleet', ownerId: fleetId }, body.amountPaise, key);
  }

  @Get()
  list(@CurrentFleet() fleetId: FleetId, @ZodQuery(payoutsQuerySchema) query: PayoutsQuery) {
    return this.payouts.list({ ownerType: 'fleet', ownerId: fleetId }, query);
  }
}
