import { Controller, Get, HttpCode, HttpStatus, Put, Req, UseGuards } from '@nestjs/common';
import {
  adminContentPagesQuerySchema,
  adminContentUpsertBodySchema,
  type AdminContentPage,
  type AdminContentPagesQuery,
  type AdminContentPagesResponse,
  type AdminContentUpsertBody,
} from '@towing/api-contracts';
import { z } from 'zod';
import { ApiException } from '../../common/errors/api-exception';
import { ThrottleBucket } from '../../common/throttling/throttler.config';
import { ZodBody, ZodParam, ZodQuery } from '../../common/validation/zod.decorators';
import type { AuthedRequest } from '../auth/auth.types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Permissions, Realms } from '../auth/realm.decorator';
import { sessionContextFrom } from '../auth/token.service';
import { ContentService } from './content.service';

/**
 * `/v1/admin/content` (`content.edit`, W15). There is no `content.read`
 * permission in the §4.2 map and no separate reader role: the people who can
 * see the drafts are the people who write them.
 */
@Controller('admin/content')
@UseGuards(JwtAuthGuard)
@Realms('admin')
@Permissions('content.edit')
export class AdminContentController {
  constructor(private readonly content: ContentService) {}

  @Get()
  list(
    @ZodQuery(adminContentPagesQuerySchema) query: AdminContentPagesQuery,
  ): Promise<AdminContentPagesResponse> {
    return this.content.adminList(query);
  }

  @Get(':slug')
  detail(@ZodParam(z.string().min(1).max(80), 'slug') slug: string): Promise<AdminContentPage> {
    return this.content.adminGet(slug);
  }

  /** An upsert: creating a page and editing one are the same action on a slug. */
  @Put(':slug')
  @ThrottleBucket('money')
  @HttpCode(HttpStatus.OK)
  upsert(
    @ZodParam(z.string().min(1).max(80), 'slug') slug: string,
    @ZodBody(adminContentUpsertBodySchema) body: AdminContentUpsertBody,
    @Req() request: AuthedRequest,
  ): Promise<AdminContentPage> {
    return this.content.upsert(adminId(request), slug, body, sessionContextFrom(request));
  }
}

// Local to each admin controller, matching `admin-config.controller.ts`.
function adminId(request: AuthedRequest): string {
  const auth = request.auth;
  if (!auth) throw ApiException.unauthorized();
  return auth.sub;
}
