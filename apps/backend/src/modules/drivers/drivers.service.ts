import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import {
  ErrorCodes,
  PERFORMANCE_WINDOW_DAYS,
  rupeeStringToPaise,
  type AssignTruckRequest,
  type DriverInviteRequest,
  type DriversListResponse,
  type FleetDriverDto,
  type FleetDriverPerformance,
  type FleetId,
} from '@towing/api-contracts';
import type { PageQuery } from '@towing/api-contracts';
import { ApiException } from '../../common/errors/api-exception';
import { FleetEventsService } from '../../common/events/fleet-events.service';
import { isUniqueViolation } from '../../common/errors/pg-errors';
import { NotificationService } from '../../common/notifications/notification.service';
import { istMonthStart } from '../../common/time/ist';
import { DriversRepo, type DriverRow } from './drivers.repo';

function toDto(row: DriverRow, plate: string | null, monthNet: string | undefined): FleetDriverDto {
  return {
    id: row.id,
    name: row.name ?? '—',
    phone: row.mobile,
    kycStatus: row.kycStatus,
    isOnline: row.isOnline,
    assignedTruckPlate: plate,
    rating: row.rating === null ? null : Number(row.rating),
    tripsTotal: row.totalTrips,
    monthNetPaise: monthNet ? rupeeStringToPaise(monthNet) : 0,
  };
}

@Injectable()
export class DriversService {
  constructor(
    private readonly repo: DriversRepo,
    private readonly events: FleetEventsService,
    private readonly notifications: NotificationService,
  ) {}

  async list(fleetId: FleetId, query: PageQuery): Promise<DriversListResponse> {
    const { rows, total } = await this.repo.listPage(fleetId, query);

    const truckIds = rows
      .map((d) => d.assignedTruckId)
      .filter((id): id is string => id !== null);
    const [plates, monthNets] = await Promise.all([
      this.repo.platesFor(truckIds),
      this.repo.monthNetFor(
        rows.map((d) => d.id),
        istMonthStart(),
      ),
    ]);

    return {
      items: rows.map((d) =>
        toDto(
          d,
          d.assignedTruckId ? (plates.get(d.assignedTruckId) ?? null) : null,
          monthNets.get(d.id),
        ),
      ),
      page: query.page,
      limit: query.limit,
      total,
    };
  }

  async invite(fleetId: FleetId, body: DriverInviteRequest): Promise<FleetDriverDto> {
    let row: DriverRow;
    try {
      row = await this.repo.invite(fleetId, {
        name: body.name,
        mobile: body.mobile,
        vehicleClass: body.vehicleClass ?? null,
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ApiException(
          HttpStatus.CONFLICT,
          ErrorCodes.DUPLICATE_MOBILE,
          'A driver with this mobile number already exists on the platform',
        );
      }
      throw err;
    }

    // The driver finishes KYC in MiTow Driver; approval stays with platform admin.
    //
    // Emits a domain id, not a phone number: the resolver reads the driver's
    // current mobile at delivery time, so an invite queued behind a slow
    // provider still reaches the number on file rather than a stale copy.
    await this.notifications.emit('fleet.driver_invited', {
      driverId: row.id,
      businessName: body.name,
    });

    return toDto(row, null, undefined);
  }

  async assignTruck(
    fleetId: FleetId,
    driverId: string,
    body: AssignTruckRequest,
  ): Promise<FleetDriverDto> {
    const driver = await this.repo.findById(fleetId, driverId);
    if (!driver) throw ApiException.notFound('Driver not found');

    if (body.truckId !== null && !(await this.repo.truckInFleet(fleetId, body.truckId))) {
      // Cross-tenant truck ids are indistinguishable from unknown ones.
      throw ApiException.notFound('Truck not found');
    }

    let updated: DriverRow | undefined;
    try {
      updated = await this.repo.setAssignedTruck(fleetId, driverId, body.truckId);
    } catch (err) {
      // The partial unique index is the race-safe arbiter of one-driver-per-truck.
      if (isUniqueViolation(err)) {
        throw new ApiException(
          HttpStatus.CONFLICT,
          ErrorCodes.TRUCK_ALREADY_ASSIGNED,
          'This truck is already assigned to another driver',
        );
      }
      throw err;
    }
    if (!updated) throw ApiException.notFound('Driver not found');

    // `utilizationPct` counts DISTINCT drivers.assigned_truck_id on active
    // bookings, so this mutation moves its numerator. Before Phase 5 nothing
    // here invalidated `dash:{fleetId}` and the KPI stayed wrong for up to the
    // 15s TTL — the reason this seam is now a single service.
    // `invite` deliberately does NOT emit: no KPI reads driver count.
    await this.events.emit(fleetId, { kind: 'driver_assignment_changed', driverId });

    const plates = updated.assignedTruckId
      ? await this.repo.platesFor([updated.assignedTruckId])
      : new Map<string, string>();

    return toDto(
      updated,
      updated.assignedTruckId ? (plates.get(updated.assignedTruckId) ?? null) : null,
      undefined,
    );
  }

  /** ADM-23: a driver's performance panel. Another fleet's driver is a 404, like a made-up id. */
  async performance(fleetId: FleetId, driverId: string): Promise<FleetDriverPerformance> {
    const rows = await this.repo.performance(fleetId, driverId, PERFORMANCE_WINDOW_DAYS);
    if (!rows) throw ApiException.notFound('Driver not found');
    const pay = await this.repo.payTerms(fleetId, driverId);

    const net = (ownerType: string): number => {
      const row = rows.earnings.find((entry) => entry.owner_type === ownerType);
      return row ? rupeeStringToPaise(row.net) : 0;
    };
    const pct = (value: string | null): number | null => (value === null ? null : Number(value));

    return {
      driverId: rows.driver.id,
      name: rows.driver.name,
      windowDays: PERFORMANCE_WINDOW_DAYS,
      trips: rows.trips,
      acceptanceRatePct: pct(rows.driver.acceptance_rate),
      completionRatePct: pct(rows.driver.completion_rate),
      rating: pct(rows.driver.rating),
      ratingsCount: rows.ratingsCount,
      earnings: { fleetSharePaise: net('fleet'), driverSharePaise: net('driver') },
      pay,
      recentJobs: rows.recent.map((job) => ({
        id: job.id,
        code: `TW-${job.id.slice(0, 8).toUpperCase()}`,
        status: job.status,
        grossPaise: Math.max(0, rupeeStringToPaise(job.total)),
        createdAt: new Date(job.created_at).toISOString(),
      })),
    };
  }

  /**
   * 0042: set one driver's share, or clear it (null) to follow the fleet's
   * default. Stored as the driver/fleet pair `fleet_driver_shares` has always
   * held, which settlement reads first. Applies to jobs accepted from now on.
   */
  async updateShare(
    fleetId: FleetId,
    driverId: string,
    driverSharePct: number | null,
  ): Promise<{ driverId: string; driverSharePct: number | null }> {
    if (!(await this.repo.belongsToFleet(fleetId, driverId))) {
      throw ApiException.notFound('Driver not found');
    }
    await this.repo.setShare(fleetId, driverId, driverSharePct);
    return { driverId, driverSharePct };
  }
}
