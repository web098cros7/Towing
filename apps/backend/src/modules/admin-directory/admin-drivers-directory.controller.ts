import { Controller, Get, HttpCode, HttpStatus, Post, Put, Req, UseGuards } from '@nestjs/common';
import {
  adminCan,
  adminDriverBookingsQuerySchema,
  adminDriverSuspendBodySchema,
  adminDriverZonesUpdateSchema,
  adminDriversDirectoryQuerySchema,
  type AdminDriverBookingsQuery,
  type AdminDriverSuspendBody,
  type AdminDriverZonesUpdate,
  type AdminDriversDirectoryQuery,
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
 * W6's drivers directory (§9.4.4): search, detail, trips, the A14 suspend
 * routes and §6.10's zone editor.
 *
 * A SECOND `admin/drivers` CONTROLLER, deliberately. The KYC controller
 * (`admin-drivers` module) keeps `GET pending` and the review routes; these
 * are the directory routes, and they live here because the suspend routes need
 * `AccountSuspensionService` — importing this module from `admin-drivers`
 * would close a module cycle. `GET pending` still wins: Express matches in
 * registration order and `AdminDriversModule` is registered first in
 * `app.module.ts`, which `admin-drivers-directory.e2e.spec.ts` pins.
 *
 * The suspend guard is `user.suspend.request`, not `user.suspend`: the
 * acceptance is "support's attempt 403s AND files a request row", and a guard
 * 403 fires before any handler code. Support passes the guard, the handler
 * files the request and refuses; everyone else performs.
 */
@Controller('admin/drivers')
@UseGuards(JwtAuthGuard)
@Realms('admin')
export class AdminDriversDirectoryController {
  constructor(private readonly directory: AdminDirectoryService) {}

  @Get()
  @Permissions('user.read')
  list(@ZodQuery(adminDriversDirectoryQuerySchema) query: AdminDriversDirectoryQuery) {
    return this.directory.drivers(query);
  }

  @Get(':id')
  @Permissions('user.read')
  detail(@ZodParam(z.uuid(), 'id') driverId: string) {
    return this.directory.driverDetail(driverId);
  }

  @Get(':id/bookings')
  @Permissions('user.read')
  bookings(
    @ZodParam(z.uuid(), 'id') driverId: string,
    @ZodQuery(adminDriverBookingsQuerySchema) query: AdminDriverBookingsQuery,
  ) {
    return this.directory.driverBookings(driverId, query);
  }

  @Post(':id/suspend')
  @Permissions('user.suspend.request')
  @ThrottleBucket('money')
  @HttpCode(HttpStatus.OK)
  suspend(
    @ZodParam(z.uuid(), 'id') driverId: string,
    @ZodBody(adminDriverSuspendBodySchema) body: AdminDriverSuspendBody,
    @Req() request: AuthedRequest,
  ) {
    const auth = requireAdmin(request);
    if (!adminCan(auth.sub_role, 'user.suspend')) {
      return this.directory.refuseAndFileRequest(
        auth.sub,
        'driver',
        driverId,
        body,
        sessionContextFrom(request),
      );
    }
    return this.directory.suspendDriver(auth.sub, driverId, body, sessionContextFrom(request));
  }

  @Post(':id/reactivate')
  @Permissions('user.suspend')
  @ThrottleBucket('money')
  @HttpCode(HttpStatus.OK)
  reactivate(@ZodParam(z.uuid(), 'id') driverId: string, @Req() request: AuthedRequest) {
    const auth = requireAdmin(request);
    return this.directory.reactivateDriver(auth.sub, driverId, sessionContextFrom(request));
  }

  @Put(':id/zones')
  @Permissions('driver.capabilities')
  @ThrottleBucket('money')
  updateZones(
    @ZodParam(z.uuid(), 'id') driverId: string,
    @ZodBody(adminDriverZonesUpdateSchema) body: AdminDriverZonesUpdate,
    @Req() request: AuthedRequest,
  ) {
    const auth = requireAdmin(request);
    return this.directory.updateDriverZones(auth.sub, driverId, body, sessionContextFrom(request));
  }
}

/** Same narrow as the users controller's — see its comment (`auth.role` union). */
function requireAdmin(request: AuthedRequest) {
  const auth = request.auth;
  if (!auth || auth.role !== 'admin') throw ApiException.unauthorized();
  return auth;
}
