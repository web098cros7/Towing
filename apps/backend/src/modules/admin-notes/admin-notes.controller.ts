import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  adminCreateNoteSchema,
  adminNotesQuerySchema,
  adminUpdateNoteSchema,
  type AdminCreateNote,
  type AdminNotesQuery,
  type AdminUpdateNote,
} from '@towing/api-contracts';
import { z } from 'zod';
import { ApiException } from '../../common/errors/api-exception';
import { ThrottleBucket } from '../../common/throttling/throttler.config';
import { ZodBody, ZodParam, ZodQuery } from '../../common/validation/zod.decorators';
import type { AuthedRequest } from '../auth/auth.types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Realms, Roles } from '../auth/realm.decorator';
import { sessionContextFrom } from '../auth/token.service';
import { AdminNotesService, type NotesViewer } from './admin-notes.service';

/**
 * Admin notes on any subject (W21, §9.4.4).
 *
 * `@Roles(...)` rather than a permission: there is no `notes.*` permission in
 * the §4.2 map, and notes are a shared internal tool on subjects the reader
 * can already open — the endpoint-level gate is subject access, enforced in
 * the service (`subject-access.ts`, same map as the audit viewer). Spelled as
 * all four sub-roles per the route-walk rule.
 *
 * No `GET /:id`: the panel always loads a subject's notes in one call, and a
 * second read shape would need its own visibility story for no screen.
 */
@Controller('admin/notes')
@UseGuards(JwtAuthGuard)
@Realms('admin')
@Roles('super_admin', 'operations', 'support', 'finance')
export class AdminNotesController {
  constructor(private readonly notes: AdminNotesService) {}

  @Get()
  list(@ZodQuery(adminNotesQuerySchema) query: AdminNotesQuery, @Req() request: AuthedRequest) {
    return this.notes.list(viewerOf(request), query);
  }

  @Post()
  @ThrottleBucket('money')
  @HttpCode(HttpStatus.OK)
  create(@ZodBody(adminCreateNoteSchema) body: AdminCreateNote, @Req() request: AuthedRequest) {
    return this.notes.create(viewerOf(request), body, sessionContextFrom(request));
  }

  @Put(':id')
  @ThrottleBucket('money')
  update(
    @ZodParam(z.uuid(), 'id') id: string,
    @ZodBody(adminUpdateNoteSchema) body: AdminUpdateNote,
    @Req() request: AuthedRequest,
  ) {
    return this.notes.update(viewerOf(request), id, body, sessionContextFrom(request));
  }

  @Delete(':id')
  @ThrottleBucket('money')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@ZodParam(z.uuid(), 'id') id: string, @Req() request: AuthedRequest): Promise<void> {
    await this.notes.remove(viewerOf(request), id, sessionContextFrom(request));
  }
}

/** Same fail-closed narrowing as the audit viewer: `@Realms('admin')` already guarantees the claim. */
function viewerOf(request: AuthedRequest): NotesViewer {
  const auth = request.auth;
  if (!auth || auth.role !== 'admin') throw ApiException.unauthorized();
  return { id: auth.sub, subRole: auth.sub_role };
}
