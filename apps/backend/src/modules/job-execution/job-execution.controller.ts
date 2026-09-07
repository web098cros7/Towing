import { Controller, Get, HttpCode, HttpStatus, Post, Req, UseGuards } from '@nestjs/common';
import {
  jobStartSchema,
  jobUnableSchema,
  type CallContact,
  type JobStart,
  type JobTransitionResponse,
  type JobUnable,
  type JobUnableResponse,
} from '@towing/api-contracts';
import { z } from 'zod';
import { ThrottleBucket } from '../../common/throttling/throttler.config';
import { ZodBody, ZodParam } from '../../common/validation/zod.decorators';
import type { AuthedRequest } from '../auth/auth.types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { KycApprovedGuard } from '../auth/kyc-approved.guard';
import { Realms } from '../auth/realm.decorator';
import { driverId } from '../driver-kyc/driver-kyc.controller';
import { JobExecutionService } from './job-execution.service';

/**
 * §5.2's driver routes — thin, over `JobExecutionService` where every semantic
 * lives. The same shape `DispatchController` has, deliberately: these four sit
 * beside `accept`/`reject` and a driver moves between them without noticing a
 * boundary.
 *
 * `KycApprovedGuard` on the whole controller, matching `DispatchController` and
 * `DriverPresenceController`. A driver suspended mid-job is refused here before
 * a transaction opens — and the job machine re-checks nothing, deliberately:
 * §3.1's gate is about who may RECEIVE work, and a driver who is halfway through
 * a tow with a customer's vehicle on their flatbed must still be able to finish
 * it and mark it complete. Suspending someone is not a reason to strand the
 * person they are currently helping.
 *
 * NO `Idempotency-Key` ON ANY OF THEM, for the reason `accept` states: the
 * mechanism the header provides is weaker here than the one these routes
 * already have. The state machine's `FOR UPDATE` + legal-transition guard means
 * a double-tapped `Complete` finds the booking already `completed`, which is an
 * illegal transition, and takes a graceful 409 — the correct answer to "did my
 * first tap work?" whether the second was an accident or a retry. An idempotency
 * key would replay a cached 200 for the same key and change nothing for a
 * genuine double-tap, which sends two.
 */
@Controller()
@UseGuards(JwtAuthGuard, KycApprovedGuard)
@Realms('driver')
export class JobExecutionController {
  constructor(private readonly jobs: JobExecutionService) {}

  /**
   * §5.2's `arrived` — and the moment §7.4's waiting grace starts running.
   *
   * `money` bucket. It does not move money today, but it starts the clock that
   * `complete` bills from, which is the same reasoning that put `accept` there.
   */
  @Post('jobs/:id/arrived')
  @ThrottleBucket('money')
  @HttpCode(HttpStatus.OK)
  async arrived(
    @ZodParam(z.uuid(), 'id') bookingId: string,
    @Req() request: AuthedRequest,
  ): Promise<JobTransitionResponse> {
    return { job: await this.jobs.arrived(bookingId, driverId(request)) };
  }

  /**
   * §9.2.3's "job cannot start without a valid OTP".
   *
   * `money` bucket, and here the reason is not economics but the attempt cap:
   * this route is the only place a six-digit code can be guessed, and the 20/min
   * bucket is a second ceiling under `OTP_MAX_ATTEMPTS` that survives a client
   * cycling bookings to get a fresh counter.
   */
  @Post('jobs/:id/start')
  @ThrottleBucket('money')
  @HttpCode(HttpStatus.OK)
  async start(
    @ZodParam(z.uuid(), 'id') bookingId: string,
    @ZodBody(jobStartSchema) body: JobStart,
    @Req() request: AuthedRequest,
  ): Promise<JobTransitionResponse> {
    return { job: await this.jobs.start(bookingId, driverId(request), body.otp) };
  }

  /** §5.2's `completed` — finalizes the fare including §7.4 waiting charges. */
  @Post('jobs/:id/complete')
  @ThrottleBucket('money')
  @HttpCode(HttpStatus.OK)
  async complete(
    @ZodParam(z.uuid(), 'id') bookingId: string,
    @Req() request: AuthedRequest,
  ): Promise<JobTransitionResponse> {
    return { job: await this.jobs.complete(bookingId, driverId(request)) };
  }

  /**
   * §9.2.3's unable-to-deliver. Puts the booking back into §6.5's search and
   * never charges the customer (§3.5).
   */
  @Post('jobs/:id/unable')
  @ThrottleBucket('money')
  @HttpCode(HttpStatus.OK)
  async unable(
    @ZodParam(z.uuid(), 'id') bookingId: string,
    @ZodBody(jobUnableSchema) body: JobUnable,
    @Req() request: AuthedRequest,
  ): Promise<JobUnableResponse> {
    return this.jobs.unable(bookingId, driverId(request), body);
  }

  /** §9.2.3's call button. See `TelephonyPort` for why `masked` rides the response. */
  @Get('jobs/:id/contact')
  async contact(
    @ZodParam(z.uuid(), 'id') bookingId: string,
    @Req() request: AuthedRequest,
  ): Promise<CallContact> {
    return this.jobs.driverContact(bookingId, driverId(request));
  }
}
