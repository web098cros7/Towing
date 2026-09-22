import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  adminZoneCreateSchema,
  adminZonePreviewRequestSchema,
  adminZoneUpdateSchema,
  type AdminZone,
  type AdminZoneCreate,
  type AdminZonePreview,
  type AdminZonePreviewRequest,
  type AdminZoneUpdate,
  type AdminZoneVersion,
  type AdminZonesResponse,
} from '@towing/api-contracts';
import { ThrottleBucket } from '../../common/throttling/throttler.config';
import { ZodBody } from '../../common/validation/zod.decorators';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Permissions, Realms } from '../auth/realm.decorator';
import type { AuthedRequest } from '../auth/auth.types';
import { sessionContextFrom } from '../auth/token.service';
import { AdminZonesService } from './admin-zones.service';

/**
 * W13 — §9.4.8's zone editor, `zone.edit` (super admin + operations), the same
 * pair that owns the dispatch ladders: a zone's shape decides the ladder, the
 * surge band and who can go online where, so it is the same authority.
 *
 * WRITES ARE `money`-BUCKETED. Nothing here moves money directly; a zone
 * changes what every future fare in it costs, which is close enough.
 */
@Controller('admin/zones')
@UseGuards(JwtAuthGuard)
@Realms('admin')
export class AdminZonesController {
  constructor(private readonly zones: AdminZonesService) {}

  @Get()
  @Permissions('zone.edit')
  list(): Promise<AdminZonesResponse> {
    return this.zones.list();
  }

  /** The dry run — `POST` because a polygon in a query string is a URL nobody can read. */
  @Post('preview')
  @Permissions('zone.edit')
  @HttpCode(HttpStatus.OK)
  preview(
    @ZodBody(adminZonePreviewRequestSchema) body: AdminZonePreviewRequest,
  ): Promise<AdminZonePreview> {
    return this.zones.preview(body);
  }

  @Post()
  @Permissions('zone.edit')
  @ThrottleBucket('money')
  @HttpCode(HttpStatus.OK)
  create(
    @ZodBody(adminZoneCreateSchema) body: AdminZoneCreate,
    @Req() request: AuthedRequest,
  ): Promise<AdminZone> {
    return this.zones.create(adminId(request), body, sessionContextFrom(request));
  }

  @Get(':id/versions')
  @Permissions('zone.edit')
  versions(@Param('id', ParseUUIDPipe) id: string): Promise<AdminZoneVersion[]> {
    return this.zones.versions(id);
  }

  @Put(':id')
  @Permissions('zone.edit')
  @ThrottleBucket('money')
  @HttpCode(HttpStatus.OK)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @ZodBody(adminZoneUpdateSchema) body: AdminZoneUpdate,
    @Req() request: AuthedRequest,
  ): Promise<AdminZone> {
    return this.zones.update(adminId(request), id, body, sessionContextFrom(request));
  }

  @Post(':id/activate')
  @Permissions('zone.edit')
  @ThrottleBucket('money')
  @HttpCode(HttpStatus.OK)
  activate(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() request: AuthedRequest,
  ): Promise<AdminZone> {
    return this.zones.setActive(adminId(request), id, true, undefined, sessionContextFrom(request));
  }

  /**
   * DEACTIVATION DOES TWO THINGS: the resolver stops seeing the zone (new
   * bookings there fail with the existing out-of-area error, go-online is
   * refused) and the reconcile evicts whoever is standing inside it now.
   */
  @Post(':id/deactivate')
  @Permissions('zone.edit')
  @ThrottleBucket('money')
  @HttpCode(HttpStatus.OK)
  deactivate(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() request: AuthedRequest,
  ): Promise<AdminZone> {
    return this.zones.setActive(
      adminId(request),
      id,
      false,
      undefined,
      sessionContextFrom(request),
    );
  }

  /** Restore = apply an old snapshot as a NEW version; history stays append-only. */
  @Post(':id/versions/:versionId/restore')
  @Permissions('zone.edit')
  @ThrottleBucket('money')
  @HttpCode(HttpStatus.OK)
  restore(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('versionId', ParseUUIDPipe) versionId: string,
    @Req() request: AuthedRequest,
  ): Promise<AdminZone> {
    return this.zones.restore(
      adminId(request),
      id,
      versionId,
      undefined,
      sessionContextFrom(request),
    );
  }
}

function adminId(request: AuthedRequest): string {
  const auth = request.auth;
  if (!auth) throw new Error('unauthenticated');
  return auth.sub;
}
