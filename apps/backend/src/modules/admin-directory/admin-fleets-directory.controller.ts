import { Controller, Get, HttpCode, HttpStatus, Post, Req, UseGuards } from '@nestjs/common';
import {
  adminCan,
  adminFleetSuspendBodySchema,
  adminFleetsQuerySchema,
  earningsQuerySchema,
  pageQuerySchema,
  trucksListQuerySchema,
  type AdminFleetSuspendBody,
  type AdminFleetsQuery,
  type EarningsQuery,
  type PageQuery,
  type TrucksListQuery,
} from '@towing/api-contracts';
import { z } from 'zod';
import { ApiException } from '../../common/errors/api-exception';
import { ThrottleBucket } from '../../common/throttling/throttler.config';
import { ZodBody, ZodParam, ZodQuery } from '../../common/validation/zod.decorators';
import type { AuthedRequest } from '../auth/auth.types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Permissions, Realms } from '../auth/realm.decorator';
import { sessionContextFrom } from '../auth/token.service';
import { AdminDirectoryService } from './admin-directory.service';

/**
 * W6's fleets directory (§9.4.5): search, detail with the suspend dry-run
 * counts, the fleet's trucks/drivers/earnings, and A15's suspend routes.
 *
 * The sub-reads call the FLEET console's own services with an admin-chosen
 * fleet — the guide's "nearly free" — so the two consoles can never disagree
 * about what a truck list is.
 *
 * The suspend guard is `user.suspend.request` and the handler branches, the
 * same shape as the user and driver routes: support passes the guard, files a
 * request and is refused; `fleet.suspend` holders perform. A plain guard 403
 * would fire before any handler code and file nothing.
 */
@Controller('admin/fleets')
@UseGuards(JwtAuthGuard)
@Realms('admin')
export class AdminFleetsDirectoryController {
  constructor(private readonly directory: AdminDirectoryService) {}

  @Get()
  @Permissions('user.read')
  list(@ZodQuery(adminFleetsQuerySchema) query: AdminFleetsQuery) {
    return this.directory.fleets(query);
  }

  @Get(':id')
  @Permissions('user.read')
  detail(@ZodParam(z.uuid(), 'id') fleetId: string) {
    return this.directory.fleetDetail(fleetId);
  }

  @Get(':id/trucks')
  @Permissions('user.read')
  trucks(
    @ZodParam(z.uuid(), 'id') fleetId: string,
    @ZodQuery(trucksListQuerySchema) query: TrucksListQuery,
  ) {
    return this.directory.fleetTrucks(fleetId, query);
  }

  @Get(':id/drivers')
  @Permissions('user.read')
  drivers(
    @ZodParam(z.uuid(), 'id') fleetId: string,
    @ZodQuery(pageQuerySchema) query: PageQuery,
  ) {
    return this.directory.fleetDrivers(fleetId, query);
  }

  @Get(':id/earnings')
  @Permissions('finance.summary')
  earnings(
    @ZodParam(z.uuid(), 'id') fleetId: string,
    @ZodQuery(earningsQuerySchema) query: EarningsQuery,
  ) {
    return this.directory.fleetEarnings(fleetId, query);
  }

  @Post(':id/suspend')
  @Permissions('user.suspend.request')
  @ThrottleBucket('money')
  @HttpCode(HttpStatus.OK)
  suspend(
    @ZodParam(z.uuid(), 'id') fleetId: string,
    @ZodBody(adminFleetSuspendBodySchema) body: AdminFleetSuspendBody,
    @Req() request: AuthedRequest,
  ) {
    const auth = requireAdmin(request);
    if (!adminCan(auth.sub_role, 'fleet.suspend')) {
      return this.directory.refuseAndFileRequest(
        auth.sub,
        'fleet',
        fleetId,
        body,
        sessionContextFrom(request),
      );
    }
    return this.directory.suspendFleet(auth.sub, fleetId, body, sessionContextFrom(request));
  }

  @Post(':id/reactivate')
  @Permissions('fleet.suspend')
  @ThrottleBucket('money')
  @HttpCode(HttpStatus.OK)
  reactivate(@ZodParam(z.uuid(), 'id') fleetId: string, @Req() request: AuthedRequest) {
    const auth = requireAdmin(request);
    return this.directory.reactivateFleet(auth.sub, fleetId, sessionContextFrom(request));
  }
}

/** Same narrow as the users controller's — see its comment (`auth.role` union). */
function requireAdmin(request: AuthedRequest) {
  const auth = request.auth;
  if (!auth || auth.role !== 'admin') throw ApiException.unauthorized();
  return auth;
}
