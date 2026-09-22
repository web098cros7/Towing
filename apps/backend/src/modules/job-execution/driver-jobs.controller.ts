import { Controller, Get, HttpCode, HttpStatus, Post, Put, Req, UseGuards } from '@nestjs/common';
import {
  driverJobHistoryQuerySchema,
  driverPhotoConfirmSchema,
  driverProfileUpdateSchema,
  type DriverJobHistoryQuery,
  type DriverJobHistoryResponse,
  type DriverPhotoConfirm,
  type DriverProfile,
  type DriverProfileUpdate,
  type DriverTruck,
} from '@towing/api-contracts';
import { z } from 'zod';
import { ZodBody, ZodParam, ZodQuery } from '../../common/validation/zod.decorators';
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
 *
 * A driver may change their email and their photo, and nothing else. Their
 * NAME is the one on their driving licence — the identity the platform
 * verified and shows to a customer — so it is set when that licence is
 * checked, not typed in by its owner. The truck and its papers belong to the
 * fleet, and the mobile is the login.
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

  @Put('me')
  async updateProfile(
    @ZodBody(driverProfileUpdateSchema) body: DriverProfileUpdate,
    @Req() request: AuthedRequest,
  ): Promise<DriverProfile> {
    return this.jobs.updateProfile(driverId(request), body);
  }

  @Post('photo/presign')
  @HttpCode(HttpStatus.OK)
  presignPhoto(@Req() request: AuthedRequest) {
    return this.jobs.presignPhoto(driverId(request));
  }

  @Post('photo/confirm')
  @HttpCode(HttpStatus.OK)
  confirmPhoto(
    @ZodBody(driverPhotoConfirmSchema) body: DriverPhotoConfirm,
    @Req() request: AuthedRequest,
  ): Promise<DriverProfile> {
    return this.jobs.confirmPhoto(driverId(request), body.key);
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
