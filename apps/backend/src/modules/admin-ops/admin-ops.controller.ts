import { Controller, Get, UseGuards } from '@nestjs/common';
import {
  adminDispatchInspectorListQuerySchema,
  adminOpsLiveQuerySchema,
  type AdminDispatchInspectorListQuery,
  type AdminOpsLiveQuery,
} from '@towing/api-contracts';
import { z } from 'zod';
import { ZodParam, ZodQuery } from '../../common/validation/zod.decorators';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Permissions, Realms } from '../auth/realm.decorator';
import { AdminOpsService } from './admin-ops.service';

/**
 * W3's Operations dashboard and W4's live snapshot — `/v1/admin/ops/*`
 * (§9.4.2, §9.4.6).
 *
 * `ops.live` is held by super admin, operations and support (Part 6) — the
 * three roles that operate the marketplace; finance is refused by design.
 * Read-only, so no `@ThrottleBucket` tag: the class default `reads` bucket is
 * the correct one, and the three GETs ride the same 10 s cache the broadcaster
 * fills.
 *
 * W5's inspector routes state `ops.dispatch.inspect` at the HANDLER, where the
 * guard's `getAllAndOverride` lets it win over the class default — the
 * permission the guide assigns them, held by the same three roles today but
 * independently revisable.
 */
@Controller('admin/ops')
@UseGuards(JwtAuthGuard)
@Realms('admin')
@Permissions('ops.live')
export class AdminOpsController {
  constructor(private readonly ops: AdminOpsService) {}

  @Get('dashboard')
  dashboard() {
    return this.ops.dashboard();
  }

  @Get('activity')
  activity() {
    return this.ops.activity();
  }

  @Get('badges')
  badges() {
    return this.ops.badges();
  }

  /**
   * W4. Query params are validated here rather than filtered client-side: the
   * zone narrowing is meant to reduce what the socket pushes, so the REST
   * resync and the room join must agree on what "in a zone" means.
   */
  @Get('live')
  live(@ZodQuery(adminOpsLiveQuerySchema) query: AdminOpsLiveQuery) {
    return this.ops.live(query);
  }

  /**
   * W5: the live searches. Declared BEFORE `dispatch/:bookingId` — Express
   * matches in registration order, and the static path must not be read as an
   * id (the params are UUID-validated, so a swap here would 422, not 404).
   */
  @Get('dispatch')
  @Permissions('ops.dispatch.inspect')
  dispatchLive(
    @ZodQuery(adminDispatchInspectorListQuerySchema) query: AdminDispatchInspectorListQuery,
  ) {
    return this.ops.dispatchLiveSearches(query);
  }

  /** W5: one booking's full wave history — the inspector page (§9.4.6). */
  @Get('dispatch/:bookingId')
  @Permissions('ops.dispatch.inspect')
  dispatchInspector(@ZodParam(z.uuid(), 'bookingId') bookingId: string) {
    return this.ops.dispatchInspector(bookingId);
  }
}
