import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import {
  driverJobHistoryQuerySchema,
  type DriverJobHistoryQuery,
  type DriverJobHistoryResponse,
  type DriverProfile,
  type DriverTruck,
} from '@towing/api-contracts';
import { z } from 'zod';
import { ZodParam, ZodQuery } from '../../common/validation/zod.decorators';
import type { AuthedRequest } from '../auth/auth.types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Realms } from '../auth/realm.decorator';
import { driverId } from '../driver-kyc/driver-kyc.controller';
import { DriverJobsService } from './driver-jobs.service';

/**
 * The driver's own card and job history.
 *
 * NOT behind `KycApprovedGuard`: a driver whose KYC is still pending must be
 * able to see their own profile (Home greeting, Personal Information) — the
 * guard exists to gate job execution, not identity. The truck route is here
 * for the same reason `me` is — identity, not job execution — and so it is
 * likewise not behind `KycApprovedGuard`.
 *
 * The detail route is `job-history/:id`, deliberately NOT `jobs/:id`:
 * `driver/jobs/current` already exists and a param route on the same prefix
 * would shadow it.
 */
@Controller('driver')
@UseGuards(JwtAuthGuard)
@Realms('driver')
export class DriverJobsController {
  constructor(private readonly jobs: DriverJobsService) {}

  @Get('me')
  async me(@Req() request: AuthedRequest): Promise<DriverProfile> {
    return this.jobs.profile(driverId(request));
  }

  @Get('truck')
  async truck(@Req() request: AuthedRequest): Promise<DriverTruck> {
    return this.jobs.truck(driverId(request));
  }

  @Get('job-history')
  async history(
    @ZodQuery(driverJobHistoryQuerySchema) query: DriverJobHistoryQuery,
    @Req() request: AuthedRequest,
  ): Promise<DriverJobHistoryResponse> {
    return this.jobs.history(driverId(request), query);
  }

  @Get('job-history/:id')
  async detail(
    @ZodParam(z.uuid(), 'id') bookingId: string,
    @Req() request: AuthedRequest,
  ) {
    return this.jobs.detail(driverId(request), bookingId);
  }
}
