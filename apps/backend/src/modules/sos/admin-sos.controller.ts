import { Controller, Get, HttpCode, HttpStatus, Post, Req, UseGuards } from '@nestjs/common';
import {
  adminSosBroadcastBodySchema,
  adminSosContactBodySchema,
  adminSosCreateBodySchema,
  adminSosNoteBodySchema,
  adminSosQuerySchema,
  adminSosResolveBodySchema,
  type AdminSosActionResponse,
  type AdminSosBroadcastBody,
  type AdminSosBroadcastResponse,
  type AdminSosContactBody,
  type AdminSosContactResponse,
  type AdminSosCreateBody,
  type AdminSosCreateResponse,
  type AdminSosDetail,
  type AdminSosNoteBody,
  type AdminSosQuery,
  type AdminSosResolveBody,
  type AdminSosResponse,
} from '@towing/api-contracts';
import { z } from 'zod';
import { ApiException } from '../../common/errors/api-exception';
import { ThrottleBucket } from '../../common/throttling/throttler.config';
import { ZodBody, ZodParam, ZodQuery } from '../../common/validation/zod.decorators';
import type { AuthedRequest } from '../auth/auth.types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Permissions, Realms } from '../auth/realm.decorator';
import { sessionContextFrom } from '../auth/token.service';
import { SosService } from './sos.service';

/**
 * W14's SOS console surface (§13, §9.4) — `/v1/admin/sos/*`.
 *
 * `@Permissions('sos.handle')`, held by `super_admin`, `operations` and
 * `support` per the §4.2 map — never by `finance`, and the permission matrix
 * spec already asserts that. Every mutation is throttled in the `money` bucket
 * (the house bucket for admin writes) because each one is an audited operator
 * action, not a page read.
 *
 * The queue and the detail are separate reads on purpose: the queue strips the
 * timeline down to a row, the detail carries the contacts, their per-channel
 * delivery outcomes and the full event list — §13's "the whole life is
 * reconstructable" lives in the detail payload.
 */
@Controller('admin/sos')
@UseGuards(JwtAuthGuard)
@Realms('admin')
@Permissions('sos.handle')
export class AdminSosController {
  constructor(private readonly sos: SosService) {}

  @Get()
  list(@ZodQuery(adminSosQuerySchema) query: AdminSosQuery): Promise<AdminSosResponse> {
    return this.sos.list(query);
  }

  @Get(':id')
  detail(@ZodParam(z.uuid(), 'id') id: string): Promise<AdminSosDetail> {
    return this.sos.detail(id);
  }

  /**
   * An alert raised on a caller's behalf (`source: 'ops'`) — how the console
   * stays useful before the mobile SOS button ships.
   */
  @Post()
  @ThrottleBucket('money')
  @HttpCode(HttpStatus.OK)
  create(
    @ZodBody(adminSosCreateBodySchema) body: AdminSosCreateBody,
    @Req() request: AuthedRequest,
  ): Promise<AdminSosCreateResponse> {
    return this.sos.raiseByOps(adminId(request), body, sessionContextFrom(request));
  }

  @Post(':id/acknowledge')
  @ThrottleBucket('money')
  @HttpCode(HttpStatus.OK)
  acknowledge(
    @ZodParam(z.uuid(), 'id') id: string,
    @Req() request: AuthedRequest,
  ): Promise<AdminSosActionResponse> {
    return this.sos.acknowledge(adminId(request), id, sessionContextFrom(request));
  }

  @Post(':id/note')
  @ThrottleBucket('money')
  @HttpCode(HttpStatus.OK)
  note(
    @ZodParam(z.uuid(), 'id') id: string,
    @ZodBody(adminSosNoteBodySchema) body: AdminSosNoteBody,
    @Req() request: AuthedRequest,
  ): Promise<AdminSosActionResponse> {
    return this.sos.note(adminId(request), id, body, sessionContextFrom(request));
  }

  @Post(':id/contact')
  @ThrottleBucket('money')
  @HttpCode(HttpStatus.OK)
  contact(
    @ZodParam(z.uuid(), 'id') id: string,
    @ZodBody(adminSosContactBodySchema) body: AdminSosContactBody,
    @Req() request: AuthedRequest,
  ): Promise<AdminSosContactResponse> {
    return this.sos.contact(adminId(request), id, body, sessionContextFrom(request));
  }

  @Post(':id/resolve')
  @ThrottleBucket('money')
  @HttpCode(HttpStatus.OK)
  resolve(
    @ZodParam(z.uuid(), 'id') id: string,
    @ZodBody(adminSosResolveBodySchema) body: AdminSosResolveBody,
    @Req() request: AuthedRequest,
  ): Promise<AdminSosActionResponse> {
    return this.sos.resolve(adminId(request), id, body, sessionContextFrom(request));
  }

  @Post(':id/broadcast')
  @ThrottleBucket('money')
  @HttpCode(HttpStatus.OK)
  broadcast(
    @ZodParam(z.uuid(), 'id') id: string,
    @ZodBody(adminSosBroadcastBodySchema) body: AdminSosBroadcastBody,
    @Req() request: AuthedRequest,
  ): Promise<AdminSosBroadcastResponse> {
    return this.sos.broadcast(adminId(request), id, body, sessionContextFrom(request));
  }
}

// Local to each admin controller, matching `admin-config.controller.ts`.
function adminId(request: AuthedRequest): string {
  const auth = request.auth;
  if (!auth) throw ApiException.unauthorized();
  return auth.sub;
}
