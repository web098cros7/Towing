import { Body, Controller, Delete, Get, Post, Put, UseGuards } from '@nestjs/common';
import {
  fleetSettingsUpdateSchema,
  onboardingAdvanceSchema,
  payoutAccountLinkSchema,
  type FleetId,
  type FleetSettingsUpdate,
  type OnboardingAdvanceRequest,
  type PayoutAccountLinkRequest,
  fleetDriverPayUpdateSchema,
  type FleetDriverPayUpdate,
} from '@towing/api-contracts';
import { ThrottleBucket } from '../../common/throttling/throttler.config';
import { CurrentFleet } from '../../common/tenancy/current-fleet.decorator';
import { FleetScopeGuard } from '../../common/tenancy/fleet-scope.guard';
import { ProfileCompleteGuard } from '../../common/tenancy/profile-complete.guard';
import { ZodBody } from '../../common/validation/zod.decorators';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { SettingsService } from './settings.service';

/** §9.3.1 / §9.3.8: business profile, notification prefs, Route onboarding. */
@Controller('fleet/settings')
@UseGuards(JwtAuthGuard, FleetScopeGuard)
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  get(@CurrentFleet() fleetId: FleetId) {
    return this.settings.get(fleetId);
  }

  /**
   * `PUT` with a partial body, not `PATCH`. `PUT /v1/fleet/trucks/:id` already
   * takes a `.partial()` schema, so this is the house idiom — and the BFF proxy
   * exports GET/POST/PUT/DELETE with no PATCH, which stays true. Recorded here
   * so nobody "fixes" the proxy for a route that never needed it.
   */
  @Put()
  update(
    @CurrentFleet() fleetId: FleetId,
    @ZodBody(fleetSettingsUpdateSchema) body: FleetSettingsUpdate,
  ) {
    return this.settings.update(fleetId, body);
  }

  /**
   * Linking a bank account calls a vendor and creates a money destination, so
   * it carries the money throttle bucket and the §9.3.1 gate — Route needs the
   * legal name, GSTIN and address that the profile step collects.
   */
  /** 0042: share each job with the driver, or keep it and pay a salary. */
  @Put('driver-pay')
  updateDriverPay(
    @CurrentFleet() fleetId: FleetId,
    @ZodBody(fleetDriverPayUpdateSchema) body: FleetDriverPayUpdate,
  ) {
    return this.settings.updateDriverPay(fleetId, body);
  }

  @Post('payout-account')
  @ThrottleBucket('money')
  @UseGuards(ProfileCompleteGuard)
  linkPayoutAccount(
    @CurrentFleet() fleetId: FleetId,
    @ZodBody(payoutAccountLinkSchema) body: PayoutAccountLinkRequest,
  ) {
    return this.settings.linkPayoutAccount(fleetId, body);
  }

  @Delete('payout-account')
  @ThrottleBucket('money')
  unlinkPayoutAccount(@CurrentFleet() fleetId: FleetId) {
    return this.settings.unlinkPayoutAccount(fleetId);
  }

  @Post('onboarding/advance')
  advanceOnboarding(
    @CurrentFleet() fleetId: FleetId,
    @ZodBody(onboardingAdvanceSchema) body: OnboardingAdvanceRequest,
  ) {
    return this.settings.advanceOnboarding(fleetId, body.from);
  }
}
