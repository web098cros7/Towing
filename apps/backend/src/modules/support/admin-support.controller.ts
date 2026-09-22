import { Controller, Get, HttpCode, HttpStatus, Post, Req, UseGuards } from '@nestjs/common';
import {
  adminSupportAssignBodySchema,
  adminSupportLinkBookingBodySchema,
  adminSupportNoteBodySchema,
  adminSupportReplyBodySchema,
  adminSupportStatusBodySchema,
  adminSupportTicketsQuerySchema,
  type AdminSupportAssignBody,
  type AdminSupportLinkBookingBody,
  type AdminSupportNoteBody,
  type AdminSupportReplyBody,
  type AdminSupportStatusBody,
  type AdminSupportTicketDetail,
  type AdminSupportTicketsQuery,
  type AdminSupportTicketsResponse,
} from '@towing/api-contracts';
import { z } from 'zod';
import { ApiException } from '../../common/errors/api-exception';
import { ThrottleBucket } from '../../common/throttling/throttler.config';
import { ZodBody, ZodParam, ZodQuery } from '../../common/validation/zod.decorators';
import type { AuthedRequest } from '../auth/auth.types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Permissions, Realms } from '../auth/realm.decorator';
import { sessionContextFrom } from '../auth/token.service';
import { SupportService } from './support.service';

/**
 * W15's support console — `/v1/admin/support/tickets/*` (§9.4.12).
 *
 * `@Permissions('ticket.handle')` — held by `super_admin`, `operations` and
 * `support` per the §4.2 map, never by `finance`. Writes take the `money`
 * bucket like every other audited admin mutation.
 *
 * `message` and `note` are TWO ROUTES rather than one with a visibility field,
 * because the difference is a different consequence: one notifies the
 * requester and stops the first-response clock, the other is internal and
 * never leaves the console. A single endpoint with a defaulted flag is one
 * forgotten field away from leaking an internal note.
 */
@Controller('admin/support/tickets')
@UseGuards(JwtAuthGuard)
@Realms('admin')
@Permissions('ticket.handle')
export class AdminSupportController {
  constructor(private readonly support: SupportService) {}

  @Get()
  list(
    @ZodQuery(adminSupportTicketsQuerySchema) query: AdminSupportTicketsQuery,
  ): Promise<AdminSupportTicketsResponse> {
    return this.support.listForAdmin(query);
  }

  @Get(':id')
  detail(@ZodParam(z.uuid(), 'id') id: string): Promise<AdminSupportTicketDetail> {
    return this.support.adminDetail(id);
  }

  @Post(':id/assign')
  @ThrottleBucket('money')
  @HttpCode(HttpStatus.OK)
  assign(
    @ZodParam(z.uuid(), 'id') id: string,
    @ZodBody(adminSupportAssignBodySchema) body: AdminSupportAssignBody,
    @Req() request: AuthedRequest,
  ): Promise<AdminSupportTicketDetail> {
    return this.support.assign(adminId(request), id, body, sessionContextFrom(request));
  }

  @Post(':id/status')
  @ThrottleBucket('money')
  @HttpCode(HttpStatus.OK)
  status(
    @ZodParam(z.uuid(), 'id') id: string,
    @ZodBody(adminSupportStatusBodySchema) body: AdminSupportStatusBody,
    @Req() request: AuthedRequest,
  ): Promise<AdminSupportTicketDetail> {
    return this.support.setStatus(adminId(request), id, body, sessionContextFrom(request));
  }

  @Post(':id/message')
  @ThrottleBucket('money')
  @HttpCode(HttpStatus.OK)
  message(
    @ZodParam(z.uuid(), 'id') id: string,
    @ZodBody(adminSupportReplyBodySchema) body: AdminSupportReplyBody,
    @Req() request: AuthedRequest,
  ): Promise<AdminSupportTicketDetail> {
    return this.support.adminReply(adminId(request), id, body, sessionContextFrom(request));
  }

  @Post(':id/note')
  @ThrottleBucket('money')
  @HttpCode(HttpStatus.OK)
  note(
    @ZodParam(z.uuid(), 'id') id: string,
    @ZodBody(adminSupportNoteBodySchema) body: AdminSupportNoteBody,
    @Req() request: AuthedRequest,
  ): Promise<AdminSupportTicketDetail> {
    return this.support.adminNote(adminId(request), id, body, sessionContextFrom(request));
  }

  @Post(':id/link-booking')
  @ThrottleBucket('money')
  @HttpCode(HttpStatus.OK)
  linkBooking(
    @ZodParam(z.uuid(), 'id') id: string,
    @ZodBody(adminSupportLinkBookingBodySchema) body: AdminSupportLinkBookingBody,
    @Req() request: AuthedRequest,
  ): Promise<AdminSupportTicketDetail> {
    return this.support.linkBooking(adminId(request), id, body, sessionContextFrom(request));
  }
}

// Local to each admin controller, matching `admin-config.controller.ts`.
function adminId(request: AuthedRequest): string {
  const auth = request.auth;
  if (!auth) throw ApiException.unauthorized();
  return auth.sub;
}
