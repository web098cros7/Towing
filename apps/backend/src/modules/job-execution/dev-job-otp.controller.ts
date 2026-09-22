import { Controller, Get, Inject, Req, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { ApiException } from '../../common/errors/api-exception';
import { ZodParam } from '../../common/validation/zod.decorators';
import { ENV, type Env } from '../../config/env';
import { DB, type Database } from '../../db/db.module';
import type { AuthedRequest } from '../auth/auth.types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { KycApprovedGuard } from '../auth/kyc-approved.guard';
import { Realms } from '../auth/realm.decorator';
import { BookingOtpService } from '../bookings/booking-otp.service';
import { driverId } from '../driver-kyc/driver-kyc.controller';
import { JobExecutionRepo } from './job-execution.repo';

/**
 * Dev-only mirror of `GET /v1/bookings/:id/otp`, for the driver side.
 *
 * Exists so a single phone can run a booking end to end against a dev backend
 * without a second handset to read the start code aloud. Gated on
 * `AUTH_DEV_OTP_ECHO` — the same flag `auth/dev/otp` uses — and 404s when it is
 * off, so the route is indistinguishable from a typo. Production refuses the
 * flag at boot, so this cannot be reached there.
 */
@Controller('dev/jobs')
@UseGuards(JwtAuthGuard, KycApprovedGuard)
@Realms('driver')
export class DevJobOtpController {
  constructor(
    private readonly jobs: JobExecutionRepo,
    private readonly otp: BookingOtpService,
    @Inject(DB) private readonly db: Database,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @Get(':id/start-code')
  async startCode(
    @ZodParam(z.uuid(), 'id') bookingId: string,
    @Req() request: AuthedRequest,
  ): Promise<{ code: string; expiresAt: string }> {
    if (!this.env.AUTH_DEV_OTP_ECHO) throw ApiException.notFound('Not found');

    const job = await this.jobs.job(bookingId);
    if (!job || job.driverId !== driverId(request)) throw ApiException.notFound('Not found');

    const issued = await this.otp.issue(this.db, bookingId);
    return { code: issued.code, expiresAt: issued.expiresAt.toISOString() };
  }
}
