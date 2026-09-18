import { Controller, Get, HttpCode, HttpStatus, Post, Put, Req, UseGuards } from '@nestjs/common';
import {
  adminAdminsQuerySchema,
  adminCreateAdminSchema,
  adminDeactivateAdminSchema,
  adminUpdateAdminSchema,
  type AdminAdminsQuery,
  type AdminCreateAdmin,
  type AdminDeactivateAdmin,
  type AdminUpdateAdmin,
} from '@towing/api-contracts';
import { z } from 'zod';
import { ApiException } from '../../common/errors/api-exception';
import { ThrottleBucket } from '../../common/throttling/throttler.config';
import { ZodBody, ZodParam, ZodQuery } from '../../common/validation/zod.decorators';
import type { AuthedRequest } from '../auth/auth.types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Permissions, Realms } from '../auth/realm.decorator';
import { sessionContextFrom } from '../auth/token.service';
import { AdminUsersService } from './admin-users.service';

/**
 * Admin user management (W2, spec §4.2 "Manage admins & roles").
 *
 * Class-level `@Permissions('admin.manage')` — super_admin only, per the
 * §4.2 matrix (no other sub-role holds it). Writes sit in the `money`
 * bucket, the house convention for every config/state mutation.
 */
@Controller('admin/admins')
@UseGuards(JwtAuthGuard)
@Realms('admin')
@Permissions('admin.manage')
export class AdminUsersController {
  constructor(private readonly admins: AdminUsersService) {}

  @Get()
  list(@ZodQuery(adminAdminsQuerySchema) query: AdminAdminsQuery) {
    return this.admins.list(query);
  }

  @Get(':id')
  detail(@ZodParam(z.uuid(), 'id') adminId: string) {
    return this.admins.get(adminId);
  }

  @Post()
  @ThrottleBucket('money')
  @HttpCode(HttpStatus.OK)
  create(@ZodBody(adminCreateAdminSchema) body: AdminCreateAdmin, @Req() request: AuthedRequest) {
    return this.admins.create(selfId(request), body, sessionContextFrom(request));
  }

  @Put(':id')
  @ThrottleBucket('money')
  update(
    @ZodParam(z.uuid(), 'id') adminId: string,
    @ZodBody(adminUpdateAdminSchema) body: AdminUpdateAdmin,
    @Req() request: AuthedRequest,
  ) {
    return this.admins.update(selfId(request), adminId, body, sessionContextFrom(request));
  }

  @Post(':id/deactivate')
  @ThrottleBucket('money')
  @HttpCode(HttpStatus.OK)
  deactivate(
    @ZodParam(z.uuid(), 'id') adminId: string,
    @ZodBody(adminDeactivateAdminSchema) body: AdminDeactivateAdmin,
    @Req() request: AuthedRequest,
  ) {
    return this.admins.deactivate(selfId(request), adminId, body, sessionContextFrom(request));
  }

  @Post(':id/reactivate')
  @ThrottleBucket('money')
  @HttpCode(HttpStatus.OK)
  reactivate(
    @ZodParam(z.uuid(), 'id') adminId: string,
    @ZodBody(adminDeactivateAdminSchema) body: AdminDeactivateAdmin,
    @Req() request: AuthedRequest,
  ) {
    return this.admins.reactivate(selfId(request), adminId, body, sessionContextFrom(request));
  }

  @Post(':id/reset-password')
  @ThrottleBucket('money')
  @HttpCode(HttpStatus.OK)
  resetPassword(@ZodParam(z.uuid(), 'id') adminId: string, @Req() request: AuthedRequest) {
    return this.admins.resetPassword(selfId(request), adminId, sessionContextFrom(request));
  }
}

function selfId(request: AuthedRequest): string {
  const auth = request.auth;
  if (!auth) throw ApiException.unauthorized();
  return auth.sub;
}
