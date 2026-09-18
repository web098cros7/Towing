import { Controller, Get, HttpCode, HttpStatus, Post, Req, UseGuards } from '@nestjs/common';
import {
  adminCompletePasswordChangeSchema,
  adminLoginRequestSchema,
  adminOtpVerifyRequestSchema,
  adminTotpConfirmSchema,
  adminTotpDisableSchema,
  type AdminCompletePasswordChange,
  type AdminLoginRequest,
  type AdminOtpVerifyRequest,
  type AdminTotpConfirm,
  type AdminTotpDisable,
} from '@towing/api-contracts';
import { ApiException } from '../../common/errors/api-exception';
import { SkipThrottling, ThrottleBucket } from '../../common/throttling/throttler.config';
import { ZodBody, ZodQuery } from '../../common/validation/zod.decorators';
import {
  devOtpQuerySchema,
  refreshRequestSchema,
  type AuthedRequest,
  type DevOtpQuery,
  type RefreshRequest,
} from '../auth/auth.types';
import { JwtAuthGuard, Public } from '../auth/jwt-auth.guard';
import { Realms, Roles } from '../auth/realm.decorator';
import { sessionContextFrom } from '../auth/token.service';
import { AdminAuthService } from './admin-auth.service';

/**
 * Admin console auth (§9.4, §16.5).
 *
 * `@Realms('admin')` is what stops a fleet-owner token reaching these routes:
 * without it `JwtAuthGuard` defaults to fleet-only and this controller would
 * 403 the very operators it is for. That default is deliberate — forgetting the
 * decorator fails closed.
 *
 * The one admin ACTION Phase 10 shipped (the §3.1 KYC decision route) has
 * moved to `modules/admin-drivers` (Phase 11) — this module is authentication
 * only.
 */
@Controller('admin/auth')
@UseGuards(JwtAuthGuard)
@Realms('admin')
@ThrottleBucket('auth')
export class AdminAuthController {
  constructor(private readonly auth: AdminAuthService) {}

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(@ZodBody(adminLoginRequestSchema) body: AdminLoginRequest) {
    return this.auth.login(body);
  }

  @Public()
  @Post('verify')
  @HttpCode(HttpStatus.OK)
  verify(
    @ZodBody(adminOtpVerifyRequestSchema) body: AdminOtpVerifyRequest,
    @Req() request: AuthedRequest,
  ) {
    return this.auth.verify(body, sessionContextFrom(request));
  }

  @Public()
  @Post('refresh')
  @ThrottleBucket('refresh')
  @HttpCode(HttpStatus.OK)
  refresh(@ZodBody(refreshRequestSchema) body: RefreshRequest, @Req() request: AuthedRequest) {
    return this.auth.refresh(body.refreshToken, sessionContextFrom(request));
  }

  @Public()
  @Post('logout')
  @ThrottleBucket('refresh')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@ZodBody(refreshRequestSchema) body: RefreshRequest): Promise<void> {
    await this.auth.logout(body.refreshToken);
  }

  /** Development only — 404s unless `AUTH_DEV_OTP_ECHO`. */
  @Public()
  @Get('dev/otp')
  @SkipThrottling()
  devOtp(@ZodQuery(devOtpQuerySchema) query: DevOtpQuery) {
    return this.auth.devOtp(query.challengeId);
  }

  /**
   * Session identity for the console shell (A7). Reads, not auth: the BFF
   * session route and the identity provider poll it, so it sits in the
   * 300/min `reads` bucket — the handler tag overrides the class `auth`
   * bucket (5/min), same mechanics as `refresh` below.
   */
  @Get('me')
  @ThrottleBucket('reads')  // Every authenticated admin may read their own identity — spelled out as
  // all four sub-roles rather than left undecorated, so the route-walk spec
  // (every /v1/admin/* route carries a role or permission decorator) holds
  // without an exemption. Behaviour is identical: the guard passes any admin.
  @Roles('super_admin', 'operations', 'support', 'finance')
  async me(@Req() request: AuthedRequest) {
    const auth = request.auth;
    if (!auth) throw ApiException.unauthorized();

    const identity = await this.auth.identity(auth.sub);
    if (!identity) throw ApiException.forbidden('This admin account is not active');

    return identity;
  }

  /**
   * Completes a forced password change with the still-live login challenge.
   * `@Public()` by necessity — no session exists yet — and allowlisted as
   * such in the route-walk spec. The challenge (not a bearer) is the only
   * authority accepted; `verify` left it unconsumed for exactly this call.
   */
  @Public()
  @Post('password/complete')
  @HttpCode(HttpStatus.OK)
  completePassword(
    @ZodBody(adminCompletePasswordChangeSchema) body: AdminCompletePasswordChange,
    @Req() request: AuthedRequest,
  ) {
    return this.auth.completePasswordChange(body, sessionContextFrom(request));
  }

  /**
   * TOTP self-service (W2): every route acts on the CALLER's own account —
   * there is no `:id`, so one admin can never enrol for another. Spelled as
   * all four sub-roles (like `me`) rather than left undecorated, per the
   * route-walk rule. Writes sit in the `money` bucket: enrol+confirm+recovery
   * is three requests inside one flow, which would starve on the 5/min `auth`
   * budget shared with login.
   */
  @Post('2fa/enroll')
  @Roles('super_admin', 'operations', 'support', 'finance')
  @ThrottleBucket('money')
  @HttpCode(HttpStatus.OK)
  totpEnroll(@Req() request: AuthedRequest) {
    return this.auth.totpEnroll(adminId(request), sessionContextFrom(request));
  }

  @Post('2fa/confirm')
  @Roles('super_admin', 'operations', 'support', 'finance')
  @ThrottleBucket('money')
  @HttpCode(HttpStatus.OK)
  totpConfirm(@ZodBody(adminTotpConfirmSchema) body: AdminTotpConfirm, @Req() request: AuthedRequest) {
    return this.auth.totpConfirm(adminId(request), body, sessionContextFrom(request));
  }

  @Post('2fa/disable')
  @Roles('super_admin', 'operations', 'support', 'finance')
  @ThrottleBucket('money')
  @HttpCode(HttpStatus.OK)
  totpDisable(@ZodBody(adminTotpDisableSchema) body: AdminTotpDisable, @Req() request: AuthedRequest) {
    return this.auth.totpDisable(adminId(request), body.reason, sessionContextFrom(request));
  }

  @Post('2fa/recovery-codes')
  @Roles('super_admin', 'operations', 'support', 'finance')
  @ThrottleBucket('money')
  @HttpCode(HttpStatus.OK)
  totpRecoveryCodes(@Req() request: AuthedRequest) {
    return this.auth.totpRecoveryCodes(adminId(request), sessionContextFrom(request));
  }
}

function adminId(request: AuthedRequest): string {
  const auth = request.auth;
  if (!auth) throw ApiException.unauthorized();
  return auth.sub;
}
