import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  adminCommissionUpdateSchema,
  adminDispatchConfigUpdateSchema,
  adminPricingRuleCreateSchema,
  adminPricingRuleDeactivateSchema,
  adminPricingUpdateSchema,
  type AdminDispatchConfig,
  type AdminDispatchConfigUpdate,
  type AdminCommissionConfig,
  type AdminCommissionUpdate,
  type AdminPricingConfig,
  type AdminPricingHistoryEntry,
  type AdminPricingRule,
  type AdminPricingRuleCreate,
  type AdminPricingRuleDeactivate,
  type AdminPricingUpdate,
  type CommissionHistoryEntry,
} from '@towing/api-contracts';
import { ApiException } from '../../common/errors/api-exception';
import { ThrottleBucket } from '../../common/throttling/throttler.config';
import { ZodBody } from '../../common/validation/zod.decorators';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Realms, Roles } from '../auth/realm.decorator';
import type { AuthedRequest } from '../auth/auth.types';
import { sessionContextFrom } from '../auth/token.service';
import { AdminConfigService } from './admin-config.service';
import { AdminDispatchService } from './admin-dispatch.service';

/**
 * §16.5 pricing and commission configuration.
 *
 * PRICING IS `super_admin | finance | operations` (W10, decision G1): §4.2
 * gives Operations the pricing and surge levers and the console's nav has
 * always offered them (`pricing.edit`/`surge.edit` in the shared permission
 * map), so the route and the screen now agree instead of the screen offering a
 * 403. Finance keeps its access — removing it would break an existing
 * role-matrix contract for no gain.
 *
 * COMMISSION STAYS `super_admin | finance` on the write path. Operations
 * reaches commission through `commission.propose` (W11) instead: proposing a
 * rate is not setting one. `commission.guardrail` is super admin only.
 *
 * `@ThrottleBucket('money')` on every write, matching the precedent set by the
 * KYC decision route — an audited admin write that changes economics belongs in
 * the 20/min bucket, not the 300/min read one.
 */
@Controller('admin')
@UseGuards(JwtAuthGuard)
@Realms('admin')
export class AdminConfigController {
  constructor(
    private readonly config: AdminConfigService,
    private readonly dispatch: AdminDispatchService,
  ) {}

  @Get('pricing')
  @Roles('super_admin', 'finance', 'operations')
  getPricing(): Promise<AdminPricingConfig> {
    return this.config.getPricing();
  }

  @Put('pricing')
  @Roles('super_admin', 'finance', 'operations')
  @ThrottleBucket('money')
  @HttpCode(HttpStatus.OK)
  updatePricing(
    @ZodBody(adminPricingUpdateSchema) body: AdminPricingUpdate,
    @Req() request: AuthedRequest,
  ): Promise<AdminPricingConfig> {
    return this.config.updatePricing(adminId(request), body, sessionContextFrom(request));
  }

  /** §9.4.8's "saved (versioned)" — W10. */
  @Get('pricing/history')
  @Roles('super_admin', 'finance', 'operations')
  pricingHistory(): Promise<AdminPricingHistoryEntry[]> {
    return this.config.pricingHistory();
  }

  /** W10 — the matrices were unextendable without this. */
  @Post('pricing/rules')
  @Roles('super_admin', 'finance', 'operations')
  @ThrottleBucket('money')
  @HttpCode(HttpStatus.OK)
  createPricingRule(
    @ZodBody(adminPricingRuleCreateSchema) body: AdminPricingRuleCreate,
    @Req() request: AuthedRequest,
  ): Promise<AdminPricingRule> {
    return this.config.createPricingRule(adminId(request), body, sessionContextFrom(request));
  }

  /** Retirement, not deletion — a deactivated rule stops pricing new bookings. */
  @Post('pricing/rules/:id/deactivate')
  @Roles('super_admin', 'finance', 'operations')
  @ThrottleBucket('money')
  @HttpCode(HttpStatus.OK)
  deactivatePricingRule(
    @Param('id', ParseUUIDPipe) id: string,
    @ZodBody(adminPricingRuleDeactivateSchema) body: AdminPricingRuleDeactivate,
    @Req() request: AuthedRequest,
  ): Promise<AdminPricingRule> {
    return this.config.deactivatePricingRule(
      adminId(request),
      id,
      body,
      sessionContextFrom(request),
    );
  }

  @Get('commission')
  @Roles('super_admin', 'finance')
  getCommission(): Promise<AdminCommissionConfig> {
    return this.config.getCommission();
  }

  @Put('commission')
  @Roles('super_admin', 'finance')
  @ThrottleBucket('money')
  @HttpCode(HttpStatus.OK)
  updateCommission(
    @ZodBody(adminCommissionUpdateSchema) body: AdminCommissionUpdate,
    @Req() request: AuthedRequest,
  ): Promise<AdminCommissionConfig> {
    return this.config.updateCommission(adminId(request), body, sessionContextFrom(request));
  }

  /**
   * §16.5's dispatch configuration (Phase 17).
   *
   * `super_admin | operations`, NOT `finance` — and that split is the point of
   * §4.2's matrix. Pricing and commission are money decisions and belong to
   * finance; a radius ladder and a stale-ping threshold are operational levers
   * pulled during an incident by whoever is watching the map. The two routes on
   * this controller therefore have different role sets, which is the first time
   * that has been true.
   */
  @Get('dispatch-config')
  @Roles('super_admin', 'operations')
  getDispatch(): Promise<AdminDispatchConfig> {
    return this.dispatch.get();
  }

  @Put('dispatch-config')
  @Roles('super_admin', 'operations')
  @ThrottleBucket('money')
  @HttpCode(HttpStatus.OK)
  updateDispatch(
    @ZodBody(adminDispatchConfigUpdateSchema) body: AdminDispatchConfigUpdate,
    @Req() request: AuthedRequest,
  ): Promise<AdminDispatchConfig> {
    return this.dispatch.update(adminId(request), body, sessionContextFrom(request));
  }

  /** §3.3 "versioned + audited" — the version half, readable. */
  @Get('commission/history')
  @Roles('super_admin', 'finance')
  commissionHistory(): Promise<CommissionHistoryEntry[]> {
    return this.config.commissionHistory();
  }
}

// Local to each admin controller, matching `admin-drivers.controller.ts`.
function adminId(request: AuthedRequest): string {
  const auth = request.auth;
  if (!auth) throw ApiException.unauthorized();
  return auth.sub;
}
