import { Controller, Get, HttpCode, HttpStatus, Post, Req, UseGuards } from '@nestjs/common';
import {
  supportTicketCreateRequestSchema,
  supportTicketMessageCreateSchema,
  supportTicketsQuerySchema,
  type SupportTicketCreateRequest,
  type SupportTicketCreateResponse,
  type SupportTicketDetail,
  type SupportTicketMessageCreate,
  type SupportTicketsQuery,
  type SupportTicketsResponse,
} from '@towing/api-contracts';
import { z } from 'zod';
import { ApiException } from '../../common/errors/api-exception';
import { ZodBody, ZodParam, ZodQuery } from '../../common/validation/zod.decorators';
import type { AuthedRequest } from '../auth/auth.types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Realms } from '../auth/realm.decorator';
import { SupportService } from './support.service';
import type { TicketRequester } from './support.repo';

/**
 * W15's requester rail — `/v1/support/tickets`, for all three requester realms.
 *
 * The identity is DERIVED, never supplied: a customer or driver is the JWT's
 * `sub`, and a fleet is the JWT's `fleet_id` (a fleet-owner token's `sub` is
 * the owner's USER id — using it here would file the ticket against the wrong
 * subject, which is exactly why this comment exists).
 */
@Controller('support/tickets')
@UseGuards(JwtAuthGuard)
@Realms('customer', 'driver', 'fleet')
export class SupportController {
  constructor(private readonly support: SupportService) {}

  @Get()
  list(
    @ZodQuery(supportTicketsQuerySchema) query: SupportTicketsQuery,
    @Req() request: AuthedRequest,
  ): Promise<SupportTicketsResponse> {
    return this.support.listMine(requesterOf(request), query);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(
    @ZodBody(supportTicketCreateRequestSchema) body: SupportTicketCreateRequest,
    @Req() request: AuthedRequest,
  ): Promise<SupportTicketCreateResponse> {
    return this.support.create(requesterOf(request), body);
  }

  @Get(':id')
  detail(
    @ZodParam(z.uuid(), 'id') id: string,
    @Req() request: AuthedRequest,
  ): Promise<SupportTicketDetail> {
    return this.support.myDetail(requesterOf(request), id);
  }

  @Post(':id/messages')
  @HttpCode(HttpStatus.OK)
  reply(
    @ZodParam(z.uuid(), 'id') id: string,
    @ZodBody(supportTicketMessageCreateSchema) body: SupportTicketMessageCreate,
    @Req() request: AuthedRequest,
  ): Promise<SupportTicketDetail> {
    return this.support.reply(requesterOf(request), id, body);
  }
}

function requesterOf(request: AuthedRequest): TicketRequester {
  const auth = request.auth;
  if (!auth) throw ApiException.unauthorized();
  if (auth.role === 'customer') return { requesterType: 'user', requesterId: auth.sub };
  if (auth.role === 'driver') return { requesterType: 'driver', requesterId: auth.sub };
  if (auth.role === 'fleet_owner' && auth.fleetId) {
    return { requesterType: 'fleet', requesterId: auth.fleetId };
  }
  throw ApiException.forbidden();
}
