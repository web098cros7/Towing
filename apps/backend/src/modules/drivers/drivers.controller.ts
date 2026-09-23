import { Controller, Get, HttpCode, HttpStatus, Post, Put, UseGuards } from '@nestjs/common';
import {
  assignTruckSchema,
  driverInviteSchema,
  driversListQuerySchema,
  fleetDriverShareUpdateSchema,
  type FleetDriverShareUpdate,
  type AssignTruckRequest,
  type DriverInviteRequest,
  type FleetId,
  type PageQuery,
} from '@towing/api-contracts';
import { z } from 'zod';
import { CurrentFleet } from '../../common/tenancy/current-fleet.decorator';
import { FleetScopeGuard } from '../../common/tenancy/fleet-scope.guard';
import { ZodBody, ZodParam, ZodQuery } from '../../common/validation/zod.decorators';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { DriversService } from './drivers.service';

@Controller('fleet/drivers')
@UseGuards(JwtAuthGuard, FleetScopeGuard)
export class DriversController {
  constructor(private readonly drivers: DriversService) {}

  @Get()
  list(@CurrentFleet() fleetId: FleetId, @ZodQuery(driversListQuerySchema) query: PageQuery) {
    return this.drivers.list(fleetId, query);
  }

  @Post()
  invite(@CurrentFleet() fleetId: FleetId, @ZodBody(driverInviteSchema) body: DriverInviteRequest) {
    return this.drivers.invite(fleetId, body);
  }

  /** ADM-23: the per-driver performance panel. Another fleet's driver is a 404. */
  @Get(':id/performance')
  performance(@CurrentFleet() fleetId: FleetId, @ZodParam(z.uuid(), 'id') driverId: string) {
    return this.drivers.performance(fleetId, driverId);
  }

  /**
   * 0042: one driver's share of each job under the fleet's `share` model, or
   * null to follow the fleet's default again. Another fleet's driver is a 404.
   */
  @Put(':id/share')
  updateShare(
    @CurrentFleet() fleetId: FleetId,
    @ZodParam(z.uuid(), 'id') driverId: string,
    @ZodBody(fleetDriverShareUpdateSchema) body: FleetDriverShareUpdate,
  ) {
    return this.drivers.updateShare(fleetId, driverId, body.driverSharePct);
  }

  @Post(':id/assign-truck')
  @HttpCode(HttpStatus.OK)
  assignTruck(
    @CurrentFleet() fleetId: FleetId,
    @ZodParam(z.uuid(), 'id') driverId: string,
    @ZodBody(assignTruckSchema) body: AssignTruckRequest,
  ) {
    return this.drivers.assignTruck(fleetId, driverId, body);
  }
}
