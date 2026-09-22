import { Controller, Get, HttpCode, HttpStatus, Post, Req, UseGuards } from '@nestjs/common';
import { referralApplySchema, type ReferralApply } from '@towing/api-contracts';
import { ZodBody } from '../../common/validation/zod.decorators';
import type { AuthedRequest } from '../auth/auth.types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Realms } from '../auth/realm.decorator';
import { customerId } from '../me/me.controller';
import { ReferralsService } from './referrals.service';

/** Figma 45 — Refer & Earn, customer-only. */
@Controller('me/referral')
@UseGuards(JwtAuthGuard)
@Realms('customer')
export class ReferralsController {
  constructor(private readonly referrals: ReferralsService) {}

  @Get()
  summary(@Req() request: AuthedRequest) {
    return this.referrals.summary(customerId(request));
  }

  @Post('apply')
  @HttpCode(HttpStatus.OK)
  apply(@ZodBody(referralApplySchema) body: ReferralApply, @Req() request: AuthedRequest) {
    return this.referrals.apply(customerId(request), body.code);
  }
}
