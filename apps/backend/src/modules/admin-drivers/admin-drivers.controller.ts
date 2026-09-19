import { Controller, Get, HttpCode, HttpStatus, Post, Put, Req, UseGuards } from '@nestjs/common';
import {
  adminCapabilitiesUpdateSchema,
  adminDocumentReviewSchema,
  adminKycBulkRequestSchema,
  adminKycDecisionSchema,
  adminPendingDriversQuerySchema,
  type AdminCapabilitiesUpdate,
  type AdminDocumentReview,
  type AdminKycBulkRequest,
  type AdminKycDecision,
  type AdminPendingDriversQuery,
} from '@towing/api-contracts';
import { z } from 'zod';
import { ApiException } from '../../common/errors/api-exception';
import { ThrottleBucket } from '../../common/throttling/throttler.config';
import { ZodBody, ZodParam, ZodQuery } from '../../common/validation/zod.decorators';
import type { AuthedRequest } from '../auth/auth.types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Permissions, Realms, Roles } from '../auth/realm.decorator';
import { sessionContextFrom } from '../auth/token.service';
import { AdminDriversService } from './admin-drivers.service';

/**
 * The §3.1 KYC queue and per-document review (Phase 11) — built on Phase 10's
 * single `POST :id/kyc` decision route, which lives here now instead of
 * `admin-auth`.
 *
 * `@Roles('super_admin', 'operations')` is the RBAC assertion Phase 10 proved
 * for the decision route and this phase extends: a `support` operator can
 * read the queue (§9.4 — "hold a valid session and still not approve") but
 * every route that WRITES a decision stays restricted.
 */
@Controller('admin/drivers')
@UseGuards(JwtAuthGuard)
@Realms('admin')
export class AdminDriversController {
  constructor(private readonly drivers: AdminDriversService) {}

  @Get('pending')
  @Roles('super_admin', 'operations', 'support')
  pending(@ZodQuery(adminPendingDriversQuerySchema) query: AdminPendingDriversQuery) {
    return this.drivers.pending(query);
  }

  /**
   * W7's bulk decision — `kyc.bulk` is the permission the §4.2 matrix already
   * grants super admin and operations, and nobody else. It sits ABOVE `:id/kyc`
   * so the literal path is matched first, the same rule `pending` follows.
   *
   * The `money` bucket, like the single decision route: fifty decisions in one
   * request is not a read burst, but it is exactly the shape a compromised
   * session would use to mass-approve supply.
   */
  @Post('kyc/bulk')
  @Permissions('kyc.bulk')
  @ThrottleBucket('money')
  @HttpCode(HttpStatus.OK)
  bulkDecide(
    @ZodBody(adminKycBulkRequestSchema) body: AdminKycBulkRequest,
    @Req() request: AuthedRequest,
  ) {
    return this.drivers.bulkDecide(adminId(request), body, sessionContextFrom(request));
  }

  /**
   * W7's document history — every upload of every document for one driver,
   * newest first. `kyc.read` because this is the drawer's own data; support
   * reads the queue and therefore reads this too.
   */
  @Get(':id/document-versions')
  @Permissions('kyc.read')
  documentVersions(@ZodParam(z.uuid(), 'id') driverId: string) {
    return this.drivers.documentVersions(driverId);
  }

  @Post(':id/kyc')
  @Roles('super_admin', 'operations')
  @ThrottleBucket('money')
  @HttpCode(HttpStatus.OK)
  decide(
    @ZodParam(z.uuid(), 'id') driverId: string,
    @ZodBody(adminKycDecisionSchema) body: AdminKycDecision,
    @Req() request: AuthedRequest,
  ) {
    return this.drivers.decide(adminId(request), driverId, body, sessionContextFrom(request));
  }

  @Post(':id/documents/:docId/review')
  @Roles('super_admin', 'operations')
  @HttpCode(HttpStatus.OK)
  reviewDocument(
    @ZodParam(z.uuid(), 'id') driverId: string,
    @ZodParam(z.uuid(), 'docId') documentId: string,
    @ZodBody(adminDocumentReviewSchema) body: AdminDocumentReview,
    @Req() request: AuthedRequest,
  ) {
    return this.drivers.reviewDocument(
      adminId(request),
      driverId,
      documentId,
      body,
      sessionContextFrom(request),
    );
  }

  @Put(':id/capabilities')
  @Roles('super_admin', 'operations')
  updateCapabilities(
    @ZodParam(z.uuid(), 'id') driverId: string,
    @ZodBody(adminCapabilitiesUpdateSchema) body: AdminCapabilitiesUpdate,
    @Req() request: AuthedRequest,
  ) {
    return this.drivers.updateCapabilities(
      adminId(request),
      driverId,
      body,
      sessionContextFrom(request),
    );
  }
}

function adminId(request: AuthedRequest): string {
  const auth = request.auth;
  if (!auth) throw ApiException.unauthorized();
  return auth.sub;
}
