import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  adminBookingCancelBodySchema,
  adminBookingReassignBodySchema,
  adminBookingTransitionBodySchema,
  adminBookingsQuerySchema,
  type AdminBookingCancelBody,
  type AdminBookingReassignBody,
  type AdminBookingTransitionBody,
  type AdminBookingsQuery,
  type AdminSubRole,
} from '@towing/api-contracts';
import type { Response } from 'express';
import { z } from 'zod';
import { ApiException } from '../../common/errors/api-exception';
import { ThrottleBucket } from '../../common/throttling/throttler.config';
import { ZodBody, ZodParam, ZodQuery } from '../../common/validation/zod.decorators';
import type { AuthedRequest } from '../auth/auth.types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Permissions, Realms } from '../auth/realm.decorator';
import { sessionContextFrom } from '../auth/token.service';
import { AdminBookingsService } from './admin-bookings.service';

/**
 * W8's bookings console (§9.4.7).
 *
 * Permission shape, edge by edge: `booking.read` for the reads, `booking.cancel`
 * / `booking.reassign` for the two ordinary interventions, `booking.override`
 * for the manual status override (super admin only by the §4.2 matrix — the
 * edge list is money-free BY CONSTRUCTION, so this is an authority over state,
 * not over money), `finance.summary` for the §14.2 unpaid interventions (ops
 * and finance hold it; support does not), and `analytics.export` for the CSV.
 *
 * `@ThrottleBucket('money')` on every write: an operator's burst is capped the
 * same way payout approvals are, because cancel/reassign/override each have
 * side effects a compromised session should not be able to fire in a loop.
 */
@Controller('admin/bookings')
@UseGuards(JwtAuthGuard)
@Realms('admin')
export class AdminBookingsController {
  constructor(private readonly bookings: AdminBookingsService) {}

  @Get()
  @Permissions('booking.read')
  list(@ZodQuery(adminBookingsQuerySchema) query: AdminBookingsQuery) {
    return this.bookings.list(query);
  }

  /** Registered before `:id` so Express never parses "export.csv" as a booking id. */
  @Get('export.csv')
  @Permissions('analytics.export')
  exportCsv(@ZodQuery(adminBookingsQuerySchema) query: AdminBookingsQuery, @Res() res: Response) {
    return this.bookings.exportCsv(query, res);
  }

  @Get(':id')
  @Permissions('booking.read')
  detail(@ZodParam(z.uuid(), 'id') bookingId: string) {
    return this.bookings.detail(bookingId);
  }

  @Get(':id/invoice')
  @Permissions('booking.read')
  invoice(@ZodParam(z.uuid(), 'id') bookingId: string, @Req() request: AuthedRequest) {
    const admin = requireAdmin(request);
    return this.bookings.invoiceLink(admin.id, bookingId, sessionContextFrom(request));
  }

  @Post(':id/cancel')
  @Permissions('booking.cancel')
  @ThrottleBucket('money')
  @HttpCode(HttpStatus.OK)
  cancel(
    @ZodParam(z.uuid(), 'id') bookingId: string,
    @ZodBody(adminBookingCancelBodySchema) body: AdminBookingCancelBody,
    @Req() request: AuthedRequest,
  ) {
    const admin = requireAdmin(request);
    return this.bookings.cancel(admin.id, bookingId, body, sessionContextFrom(request));
  }

  @Post(':id/reassign')
  @Permissions('booking.reassign')
  @ThrottleBucket('money')
  @HttpCode(HttpStatus.OK)
  reassign(
    @ZodParam(z.uuid(), 'id') bookingId: string,
    @ZodBody(adminBookingReassignBodySchema) body: AdminBookingReassignBody,
    @Req() request: AuthedRequest,
  ) {
    const admin = requireAdmin(request);
    return this.bookings.reassign(admin.id, bookingId, body, sessionContextFrom(request));
  }

  @Post(':id/transition')
  @Permissions('booking.override')
  @ThrottleBucket('money')
  @HttpCode(HttpStatus.OK)
  transition(
    @ZodParam(z.uuid(), 'id') bookingId: string,
    @ZodBody(adminBookingTransitionBodySchema) body: AdminBookingTransitionBody,
    @Req() request: AuthedRequest,
  ) {
    const admin = requireAdmin(request);
    return this.bookings.transitionOverride(admin.id, bookingId, body, sessionContextFrom(request));
  }

  @Post(':id/payment/recheck')
  @Permissions('finance.summary')
  @ThrottleBucket('money')
  @HttpCode(HttpStatus.OK)
  recheck(@ZodParam(z.uuid(), 'id') bookingId: string) {
    return this.bookings.recheck(bookingId);
  }

  @Post(':id/payment/remind')
  @Permissions('finance.summary')
  @ThrottleBucket('money')
  @HttpCode(HttpStatus.OK)
  remind(@ZodParam(z.uuid(), 'id') bookingId: string) {
    return this.bookings.remind(bookingId);
  }
}

/** Same fail-closed narrowing as every admin controller: `@Realms('admin')` already guarantees the claim. */
export function requireAdmin(request: AuthedRequest): { id: string; subRole: AdminSubRole } {
  const auth = request.auth;
  if (!auth || auth.role !== 'admin') throw ApiException.unauthorized();
  return { id: auth.sub, subRole: auth.sub_role };
}
