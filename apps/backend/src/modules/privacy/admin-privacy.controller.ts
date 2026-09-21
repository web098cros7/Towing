import { Controller, Get, HttpCode, HttpStatus, Post, Put, Req, UseGuards } from '@nestjs/common';
import {
  adminDeletionDecisionSchema,
  adminDeletionHoldSchema,
  adminDeletionRequestsQuerySchema,
  adminRetentionUpdateSchema,
  adminUserCorrectionSchema,
  type AdminDeletionDecision,
  type AdminDeletionHold,
  type AdminDeletionRequestsQuery,
  type AdminRetentionUpdate,
  type AdminUserCorrection,
} from '@towing/api-contracts';
import { z } from 'zod';
import { ApiException } from '../../common/errors/api-exception';
import { ThrottleBucket } from '../../common/throttling/throttler.config';
import { ZodBody, ZodParam, ZodQuery } from '../../common/validation/zod.decorators';
import type { AuthedRequest } from '../auth/auth.types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Permissions, Realms } from '../auth/realm.decorator';
import { sessionContextFrom } from '../auth/token.service';
import { AdminPrivacyService } from './admin-privacy.service';

/**
 * W19's privacy console surface (§20.4 DPDP).
 *
 * `@Controller('admin')` hosting two route families — `privacy/*` and the two
 * `users/:id` actions — the same way `admin-config` and `admin-disputes` host
 * several resource families under one prefix. Keeping them here rather than
 * bolting `users/:id/export` onto `AdminDirectoryController` is deliberate:
 * every route in this file is `privacy.handle`, and the directory's routes are
 * `user.read`, so the split is by who may call, not by URL shape.
 *
 * READS ARE `privacy.handle`; the retention EDITOR is `admin.manage` (super
 * only) — shortening everyone's retention window is a compliance decision, not
 * a case action. All writes take the `money` bucket: each one moves a legal
 * obligation, and a compromised session should not be able to approve a
 * hundred erasures a minute.
 */
@Controller('admin')
@UseGuards(JwtAuthGuard)
@Realms('admin')
export class AdminPrivacyController {
  constructor(private readonly privacy: AdminPrivacyService) {}

  @Get('privacy/deletion-requests')
  @Permissions('privacy.handle')
  list(@ZodQuery(adminDeletionRequestsQuerySchema) query: AdminDeletionRequestsQuery) {
    return this.privacy.list(query);
  }

  @Get('privacy/deletion-requests/:id')
  @Permissions('privacy.handle')
  detail(@ZodParam(z.uuid(), 'id') requestId: string) {
    return this.privacy.detail(requestId);
  }

  @Post('privacy/deletion-requests/:id/approve')
  @Permissions('privacy.handle')
  @ThrottleBucket('money')
  @HttpCode(HttpStatus.OK)
  approve(
    @ZodParam(z.uuid(), 'id') requestId: string,
    @ZodBody(adminDeletionDecisionSchema) body: AdminDeletionDecision,
    @Req() request: AuthedRequest,
  ) {
    return this.privacy.decide(
      selfId(request),
      requestId,
      'approved',
      body,
      sessionContextFrom(request),
    );
  }

  @Post('privacy/deletion-requests/:id/reject')
  @Permissions('privacy.handle')
  @ThrottleBucket('money')
  @HttpCode(HttpStatus.OK)
  reject(
    @ZodParam(z.uuid(), 'id') requestId: string,
    @ZodBody(adminDeletionDecisionSchema) body: AdminDeletionDecision,
    @Req() request: AuthedRequest,
  ) {
    return this.privacy.decide(
      selfId(request),
      requestId,
      'rejected',
      body,
      sessionContextFrom(request),
    );
  }

  @Post('privacy/deletion-requests/:id/hold')
  @Permissions('privacy.handle')
  @ThrottleBucket('money')
  @HttpCode(HttpStatus.OK)
  hold(
    @ZodParam(z.uuid(), 'id') requestId: string,
    @ZodBody(adminDeletionHoldSchema) body: AdminDeletionHold,
    @Req() request: AuthedRequest,
  ) {
    return this.privacy.hold(selfId(request), requestId, body, sessionContextFrom(request));
  }

  @Post('privacy/deletion-requests/:id/execute')
  @Permissions('privacy.handle')
  @ThrottleBucket('money')
  @HttpCode(HttpStatus.OK)
  execute(@ZodParam(z.uuid(), 'id') requestId: string, @Req() request: AuthedRequest) {
    return this.privacy.execute(selfId(request), requestId, sessionContextFrom(request));
  }

  @Get('privacy/retention')
  @Permissions('privacy.handle')
  retention() {
    return this.privacy.retention();
  }

  @Put('privacy/retention')
  @Permissions('admin.manage')
  @ThrottleBucket('money')
  updateRetention(
    @ZodBody(adminRetentionUpdateSchema) body: AdminRetentionUpdate,
    @Req() request: AuthedRequest,
  ) {
    return this.privacy.updateRetention(selfId(request), body, sessionContextFrom(request));
  }

  @Get('users/:id/export')
  @Permissions('privacy.handle')
  @ThrottleBucket('reads')
  exportUser(@ZodParam(z.uuid(), 'id') userId: string, @Req() request: AuthedRequest) {
    return this.privacy.exportUser(selfId(request), userId, sessionContextFrom(request));
  }

  @Post('users/:id/correct')
  @Permissions('privacy.handle')
  @ThrottleBucket('money')
  @HttpCode(HttpStatus.OK)
  correctUser(
    @ZodParam(z.uuid(), 'id') userId: string,
    @ZodBody(adminUserCorrectionSchema) body: AdminUserCorrection,
    @Req() request: AuthedRequest,
  ) {
    return this.privacy.correctUser(selfId(request), userId, body, sessionContextFrom(request));
  }
}

function selfId(request: AuthedRequest): string {
  const auth = request.auth;
  if (!auth) throw ApiException.unauthorized();
  return auth.sub;
}
