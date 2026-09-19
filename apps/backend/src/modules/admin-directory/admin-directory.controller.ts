import { Controller, Get, HttpCode, HttpStatus, Post, Req, UseGuards } from '@nestjs/common';
import {
  adminCan,
  adminDirectorySuspendBodySchema,
  adminDirectoryUserBookingsQuerySchema,
  adminDirectoryUsersQuerySchema,
  adminSuspensionRequestCreateBodySchema,
  adminSuspensionRequestDecisionBodySchema,
  adminSuspensionRequestsQuerySchema,
  type AdminDirectorySuspendBody,
  type AdminDirectoryUserBookingsQuery,
  type AdminDirectoryUsersQuery,
  type AdminSuspensionRequestCreateBody,
  type AdminSuspensionRequestDecisionBody,
  type AdminSuspensionRequestsQuery,
} from '@towing/api-contracts';
import { z } from 'zod';
import { ApiException } from '../../common/errors/api-exception';
import { ThrottleBucket } from '../../common/throttling/throttler.config';
import { ZodBody, ZodParam, ZodQuery } from '../../common/validation/zod.decorators';
import type { AuthedRequest } from '../auth/auth.types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Permissions, Realms } from '../auth/realm.decorator';
import { sessionContextFrom } from '../auth/token.service';
import { AdminDirectoryService } from './admin-directory.service';

/**
 * W6's directory surface (§9.4.4): `/v1/admin/users*` and the suspension
 * request flow.
 *
 * THE SUSPEND ROUTE'S GUARD IS `user.suspend.request`, NOT `user.suspend`, and
 * that is deliberate: the acceptance is "support's suspend attempt 403s BUT
 * files a request row", and a guard 403 fires before any handler code — there
 * would be nothing left to file the request. So support passes the guard,
 * the handler performs only when `adminCan(subRole, 'user.suspend')` holds,
 * and otherwise files the request and then refuses (the service documents the
 * audit trail). Every other write route keeps the ordinary permission shape.
 *
 * `@ThrottleBucket('money')` on the writes: a suspension moves a person's
 * ability to earn or ride, and the bucket caps a compromised session's burst
 * the same way payout approvals are capped.
 */
@Controller('admin')
@UseGuards(JwtAuthGuard)
@Realms('admin')
export class AdminDirectoryController {
  constructor(private readonly directory: AdminDirectoryService) {}

  @Get('users')
  @Permissions('user.read')
  users(@ZodQuery(adminDirectoryUsersQuerySchema) query: AdminDirectoryUsersQuery) {
    return this.directory.users(query);
  }

  @Get('users/:id')
  @Permissions('user.read')
  user(@ZodParam(z.uuid(), 'id') userId: string) {
    return this.directory.userDetail(userId);
  }

  @Get('users/:id/bookings')
  @Permissions('user.read')
  userBookings(
    @ZodParam(z.uuid(), 'id') userId: string,
    @ZodQuery(adminDirectoryUserBookingsQuerySchema) query: AdminDirectoryUserBookingsQuery,
  ) {
    return this.directory.userBookings(userId, query);
  }

  @Post('users/:id/suspend')
  @Permissions('user.suspend.request')
  @ThrottleBucket('money')
  @HttpCode(HttpStatus.OK)
  suspend(
    @ZodParam(z.uuid(), 'id') userId: string,
    @ZodBody(adminDirectorySuspendBodySchema) body: AdminDirectorySuspendBody,
    @Req() request: AuthedRequest,
  ) {
    const auth = requireAdmin(request);
    if (!adminCan(auth.sub_role, 'user.suspend')) {
      return this.directory.refuseAndFileRequest(
        auth.sub,
        'user',
        userId,
        body,
        sessionContextFrom(request),
      );
    }
    return this.directory.suspendUser(auth.sub, userId, body, sessionContextFrom(request));
  }

  @Post('users/:id/reactivate')
  @Permissions('user.suspend')
  @ThrottleBucket('money')
  @HttpCode(HttpStatus.OK)
  reactivate(@ZodParam(z.uuid(), 'id') userId: string, @Req() request: AuthedRequest) {
    const auth = requireAdmin(request);
    return this.directory.reactivateUser(auth.sub, userId, sessionContextFrom(request));
  }

  @Get('suspension-requests')
  @Permissions('user.suspend.request')
  requests(@ZodQuery(adminSuspensionRequestsQuerySchema) query: AdminSuspensionRequestsQuery) {
    return this.directory.listRequests(query);
  }

  @Post('suspension-requests')
  @Permissions('user.suspend.request')
  @ThrottleBucket('money')
  createRequest(
    @ZodBody(adminSuspensionRequestCreateBodySchema) body: AdminSuspensionRequestCreateBody,
    @Req() request: AuthedRequest,
  ) {
    const auth = requireAdmin(request);
    return this.directory.createRequest(auth.sub, body, sessionContextFrom(request));
  }

  @Post('suspension-requests/:id/approve')
  @Permissions('user.suspend')
  @ThrottleBucket('money')
  @HttpCode(HttpStatus.OK)
  approve(
    @ZodParam(z.uuid(), 'id') requestId: string,
    @ZodBody(adminSuspensionRequestDecisionBodySchema) body: AdminSuspensionRequestDecisionBody,
    @Req() request: AuthedRequest,
  ) {
    const auth = requireAdmin(request);
    return this.directory.approveRequest(auth.sub, requestId, body, sessionContextFrom(request));
  }

  @Post('suspension-requests/:id/reject')
  @Permissions('user.suspend')
  @ThrottleBucket('money')
  @HttpCode(HttpStatus.OK)
  reject(
    @ZodParam(z.uuid(), 'id') requestId: string,
    @ZodBody(adminSuspensionRequestDecisionBodySchema) body: AdminSuspensionRequestDecisionBody,
    @Req() request: AuthedRequest,
  ) {
    const auth = requireAdmin(request);
    return this.directory.rejectRequest(auth.sub, requestId, body, sessionContextFrom(request));
  }
}

/**
 * `@Realms('admin')` guarantees the realm and the guard verified the token, so
 * a missing or non-admin claim here is a programming error — it fails closed
 * instead of casting, and the `role === 'admin'` narrow is what makes
 * `sub_role` visible on the union (the admin-audit controller's viewerOf).
 */
function requireAdmin(request: AuthedRequest) {
  const auth = request.auth;
  if (!auth || auth.role !== 'admin') throw ApiException.unauthorized();
  return auth;
}
