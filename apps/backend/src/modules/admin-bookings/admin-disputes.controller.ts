import { Controller, Get, HttpCode, HttpStatus, Post, Req, UseGuards } from '@nestjs/common';
import {
  adminDisputeAssignBodySchema,
  adminDisputeEvidenceConfirmBodySchema,
  adminDisputeNoteBodySchema,
  adminDisputeOpenBodySchema,
  adminDisputeResolveBodySchema,
  adminDisputesQuerySchema,
  type AdminDisputeAssignBody,
  type AdminDisputeEvidenceConfirmBody,
  type AdminDisputeNoteBody,
  type AdminDisputeOpenBody,
  type AdminDisputeResolveBody,
  type AdminDisputesQuery,
} from '@towing/api-contracts';
import { z } from 'zod';
import { ThrottleBucket } from '../../common/throttling/throttler.config';
import { ZodBody, ZodParam, ZodQuery } from '../../common/validation/zod.decorators';
import type { AuthedRequest } from '../auth/auth.types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Permissions, Realms } from '../auth/realm.decorator';
import { sessionContextFrom } from '../auth/token.service';
import { AdminDisputesService } from './admin-disputes.service';
import { requireAdmin } from './admin-bookings.controller';

/**
 * W8's dispute surface — the queue, the lifecycle routes, and the
 * `POST /admin/bookings/:id/dispute` that is the ONLY thing that can reach
 * `DISPUTED` (§9.4.7).
 *
 * Every route sits behind `dispute.handle`: ops and support triage and resolve,
 * finance supplies the money — the §4.2 matrix deliberately keeps the resolution
 * under one permission while `finance.refund` gates the finance console's own
 * refund route. A support operator can resolve `cancel_no_charge` without
 * holding any money permission because that exit moves no money; a `full_refund`
 * exit issues the refund through the refunds service under this same gate,
 * which is what the §4.2 matrix's `dispute.handle` row describes.
 */
@Controller('admin')
@UseGuards(JwtAuthGuard)
@Realms('admin')
export class AdminDisputesController {
  constructor(private readonly disputes: AdminDisputesService) {}

  @Get('disputes')
  @Permissions('dispute.handle')
  list(@ZodQuery(adminDisputesQuerySchema) query: AdminDisputesQuery) {
    return this.disputes.list(query);
  }

  @Get('disputes/:id')
  @Permissions('dispute.handle')
  detail(@ZodParam(z.uuid(), 'id') disputeId: string) {
    return this.disputes.detail(disputeId);
  }

  @Post('bookings/:id/dispute')
  @Permissions('dispute.handle')
  @ThrottleBucket('money')
  @HttpCode(HttpStatus.OK)
  open(
    @ZodParam(z.uuid(), 'id') bookingId: string,
    @ZodBody(adminDisputeOpenBodySchema) body: AdminDisputeOpenBody,
    @Req() request: AuthedRequest,
  ) {
    const admin = requireAdmin(request);
    return this.disputes.open(admin.id, bookingId, body, sessionContextFrom(request));
  }

  @Post('disputes/:id/assign')
  @Permissions('dispute.handle')
  @ThrottleBucket('money')
  @HttpCode(HttpStatus.OK)
  assign(
    @ZodParam(z.uuid(), 'id') disputeId: string,
    @ZodBody(adminDisputeAssignBodySchema) body: AdminDisputeAssignBody,
    @Req() request: AuthedRequest,
  ) {
    const admin = requireAdmin(request);
    return this.disputes.assign(admin.id, disputeId, body, sessionContextFrom(request));
  }

  @Post('disputes/:id/note')
  @Permissions('dispute.handle')
  @ThrottleBucket('money')
  @HttpCode(HttpStatus.OK)
  note(
    @ZodParam(z.uuid(), 'id') disputeId: string,
    @ZodBody(adminDisputeNoteBodySchema) body: AdminDisputeNoteBody,
    @Req() request: AuthedRequest,
  ) {
    const admin = requireAdmin(request);
    return this.disputes.note(
      admin.id,
      admin.subRole,
      disputeId,
      body,
      sessionContextFrom(request),
    );
  }

  @Post('disputes/:id/evidence/presign')
  @Permissions('dispute.handle')
  @ThrottleBucket('money')
  @HttpCode(HttpStatus.OK)
  evidencePresign(@ZodParam(z.uuid(), 'id') disputeId: string) {
    return this.disputes.evidencePresign(disputeId);
  }

  @Post('disputes/:id/evidence')
  @Permissions('dispute.handle')
  @ThrottleBucket('money')
  @HttpCode(HttpStatus.OK)
  evidenceConfirm(
    @ZodParam(z.uuid(), 'id') disputeId: string,
    @ZodBody(adminDisputeEvidenceConfirmBodySchema) body: AdminDisputeEvidenceConfirmBody,
    @Req() request: AuthedRequest,
  ) {
    const admin = requireAdmin(request);
    return this.disputes.evidenceConfirm(admin.id, disputeId, body, sessionContextFrom(request));
  }

  @Post('disputes/:id/resolve')
  @Permissions('dispute.handle')
  @ThrottleBucket('money')
  @HttpCode(HttpStatus.OK)
  resolve(
    @ZodParam(z.uuid(), 'id') disputeId: string,
    @ZodBody(adminDisputeResolveBodySchema) body: AdminDisputeResolveBody,
    @Req() request: AuthedRequest,
  ) {
    const admin = requireAdmin(request);
    return this.disputes.resolve(admin.id, disputeId, body, sessionContextFrom(request));
  }
}
