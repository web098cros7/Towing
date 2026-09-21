import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { adminAuditQuerySchema, type AdminAuditQuery } from '@towing/api-contracts';
import { z } from 'zod';
import { ApiException } from '../../common/errors/api-exception';
import { ThrottleBucket } from '../../common/throttling/throttler.config';
import { ZodParam, ZodQuery } from '../../common/validation/zod.decorators';
import type { AuthedRequest } from '../auth/auth.types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Permissions, Realms } from '../auth/realm.decorator';
import { AdminAuditService, type AuditViewer } from './admin-audit.service';

/**
 * The audit viewer (§3.5, §20.4).
 *
 * `@Permissions('audit.read')` documents intent at the route: every sub-role
 * holds it ("may reach the route"). The actual limitation — own rows plus
 * readable subjects, or everything for a super admin — is enforced in the
 * service, because it depends on each row and each query, not on the route.
 *
 * Class-level `reads` bucket: this is a viewer, and the console polls it per
 * detail screen.
 */
@Controller('admin/audit')
@UseGuards(JwtAuthGuard)
@Realms('admin')
@Permissions('audit.read')
@ThrottleBucket('reads')
export class AdminAuditController {
  constructor(private readonly audit: AdminAuditService) {}

  @Get()
  list(@ZodQuery(adminAuditQuerySchema) query: AdminAuditQuery, @Req() request: AuthedRequest) {
    return this.audit.list(viewerOf(request), query);
  }

  @Get(':id')
  detail(@ZodParam(z.uuid(), 'id') id: string, @Req() request: AuthedRequest) {
    return this.audit.detail(viewerOf(request), id);
  }
}

/**
 * `@Realms('admin')` guarantees the realm, and `JwtAuthGuard` has already
 * verified the token — so a missing `auth` or a non-admin claim here is a
 * programming error, but it fails closed rather than casting.
 */
function viewerOf(request: AuthedRequest): AuditViewer {
  const auth = request.auth;
  if (!auth || auth.role !== 'admin') throw ApiException.unauthorized();
  return { id: auth.sub, subRole: auth.sub_role };
}
