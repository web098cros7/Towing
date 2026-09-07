import { Controller, Get, HttpCode, HttpStatus, Post, Put, Req, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import {
  adminFinanceConfigUpdateSchema,
  adminPayoutRejectSchema,
  adminPayoutsQuerySchema,
  type AdminFinanceConfigUpdate,
  type AdminPayoutRejectRequest,
  type AdminPayoutsQuery,
} from '@towing/api-contracts';
import { ApiException } from '../../common/errors/api-exception';
import { ThrottleBucket } from '../../common/throttling/throttler.config';
import { ZodBody, ZodParam, ZodQuery } from '../../common/validation/zod.decorators';
import type { AuthedRequest } from '../auth/auth.types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Realms, Roles } from '../auth/realm.decorator';
import { sessionContextFrom } from '../auth/token.service';
import { AdminFinanceService } from './admin-finance.service';

/**
 * §9.4.10's Finance approval queue — the second admin surface, after Phase 11's
 * KYC queue.
 *
 * ⚠ `@Realms('admin')` IS NOT OPTIONAL. A controller with no `@Realms()` FAILS
 * CLOSED to fleet-only, which is the default eleven pre-Phase-10 controllers
 * rely on — so omitting it here would 403 every admin rather than leaking to
 * fleets, but it would still be broken.
 *
 * `@Roles('super_admin', 'finance')` throughout, including the READ. Unlike the
 * KYC queue — where `support` can look but not decide — a payout queue exposes
 * every owner's bank details and amounts, and §9.4.10's AC says outright that
 * "payouts require Finance/Super Admin".
 */
@Controller('admin/finance')
@UseGuards(JwtAuthGuard)
@Realms('admin')
export class AdminFinanceController {
  constructor(private readonly finance: AdminFinanceService) {}

  @Get('payouts')
  @Roles('super_admin', 'finance')
  payouts(@ZodQuery(adminPayoutsQuerySchema) query: AdminPayoutsQuery) {
    return this.finance.payoutQueue(query);
  }

  @Post('payouts/:id/approve')
  @Roles('super_admin', 'finance')
  @ThrottleBucket('money')
  @HttpCode(HttpStatus.OK)
  approve(@ZodParam(z.uuid(), 'id') payoutId: string, @Req() request: AuthedRequest) {
    return this.finance.approve(adminId(request), payoutId, sessionContextFrom(request));
  }

  /**
   * Rejection requires a reason; approval does not.
   *
   * The same asymmetry `adminDocumentReviewSchema` uses for KYC, for the same
   * reason: approval is the expected outcome, while a rejection is something
   * somebody will have to explain later — to the driver whose money it is, and
   * to whoever reads `admin_actions`.
   */
  @Post('payouts/:id/reject')
  @Roles('super_admin', 'finance')
  @ThrottleBucket('money')
  @HttpCode(HttpStatus.OK)
  reject(
    @ZodParam(z.uuid(), 'id') payoutId: string,
    @ZodBody(adminPayoutRejectSchema) body: AdminPayoutRejectRequest,
    @Req() request: AuthedRequest,
  ) {
    return this.finance.reject(adminId(request), payoutId, body.reason, sessionContextFrom(request));
  }

  @Get('config')
  @Roles('super_admin', 'finance')
  config() {
    return this.finance.config();
  }

  @Put('config')
  @Roles('super_admin', 'finance')
  @ThrottleBucket('money')
  @HttpCode(HttpStatus.OK)
  updateConfig(
    @ZodBody(adminFinanceConfigUpdateSchema) body: AdminFinanceConfigUpdate,
    @Req() request: AuthedRequest,
  ) {
    return this.finance.updateConfig(adminId(request), body, sessionContextFrom(request));
  }
}

function adminId(request: AuthedRequest): string {
  const auth = request.auth;
  if (!auth) throw ApiException.unauthorized();
  return auth.sub;
}
