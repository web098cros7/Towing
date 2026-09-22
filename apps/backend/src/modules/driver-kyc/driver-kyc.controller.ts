import { Controller, Get, HttpCode, HttpStatus, Post, Put, Req, UseGuards } from '@nestjs/common';
import {
  driverCapabilitiesUpdateSchema,
  driverKycConfirmRequestSchema,
  driverKycPresignRequestSchema,
  type DriverCapabilitiesUpdate,
  type DriverKycConfirmRequest,
  type DriverKycPresignRequest,
} from '@towing/api-contracts';
import { ApiException } from '../../common/errors/api-exception';
import { ZodBody } from '../../common/validation/zod.decorators';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { KycApprovedGuard } from '../auth/kyc-approved.guard';
import { Realms } from '../auth/realm.decorator';
import type { AuthedRequest } from '../auth/auth.types';
import { DriverKycService } from './driver-kyc.service';

/**
 * Driver-facing KYC submission (Phase 11, §3.1 layer 1). `@Realms('driver')`
 * on the whole controller — every route here acts on the caller's own driver
 * row, identified from the token (`auth.sub`), never from a path param.
 */
@Controller('driver')
@UseGuards(JwtAuthGuard)
@Realms('driver')
export class DriverKycController {
  constructor(private readonly kyc: DriverKycService) {}

  @Post('kyc/documents/presign')
  presign(@ZodBody(driverKycPresignRequestSchema) body: DriverKycPresignRequest, @Req() request: AuthedRequest) {
    return this.kyc.presign(driverId(request), body.docType);
  }

  @Post('kyc/documents/confirm')
  @HttpCode(HttpStatus.NO_CONTENT)
  async confirm(
    @ZodBody(driverKycConfirmRequestSchema) body: DriverKycConfirmRequest,
    @Req() request: AuthedRequest,
  ): Promise<void> {
    await this.kyc.confirm(driverId(request), body);
  }

  @Get('kyc/status')
  status(@Req() request: AuthedRequest) {
    return this.kyc.status(driverId(request));
  }

  @Post('kyc/submit')
  @HttpCode(HttpStatus.OK)
  submit(@Req() request: AuthedRequest) {
    return this.kyc.submit(driverId(request));
  }

  /**
   * Deliberately NOT behind `KycApprovedGuard`, unlike the PUT below. The
   * guard exists to gate a sensitive *change*; a driver whose approval has
   * lapsed must still be able to see what they are currently set to — blanking
   * the screen for them is how this bug looked in the first place.
   */
  @Get('capabilities')
  capabilities(@Req() request: AuthedRequest) {
    return this.kyc.capabilities(driverId(request));
  }

  /**
   * §3.1 layer 2 in miniature: changing what you're willing to drive is a
   * "sensitive action" gated on being approved, the same way going online will
   * be once Phase 16 ships that route — this is the guard's first real user.
   */
  @Put('capabilities')
  @UseGuards(KycApprovedGuard)
  updateCapabilities(
    @ZodBody(driverCapabilitiesUpdateSchema) body: DriverCapabilitiesUpdate,
    @Req() request: AuthedRequest,
  ) {
    return this.kyc.updateCapabilities(driverId(request), body);
  }
}

/** Exported so the notification-centre driver controller resolves its subject the same way. */
export function driverId(request: AuthedRequest): string {
  const auth = request.auth;
  if (!auth) throw ApiException.unauthorized();
  return auth.sub;
}
