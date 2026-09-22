import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, lt, notInArray, or, sql } from 'drizzle-orm';
import type {
  DriverJobHistoryItem,
  DriverJobHistoryQuery,
  DriverJobHistoryResponse,
  DriverProfile,
} from '@towing/api-contracts';
import { ApiException } from '../../common/errors/api-exception';
import { DB, type Database } from '../../db/db.module';
import { bookings } from '../../db/schema/bookings';
import { drivers } from '../../db/schema/drivers';
import { fleets } from '../../db/schema/fleets';
import { fleetTrucks } from '../../db/schema/trucks';
import { projectEarnings } from '../money/settlement';
import { decodeCursor, encodeCursor } from '../jobs/jobs.cursor';
import { JobExecutionRepo } from './job-execution.repo';

/**
 * The driver's own card and their job history — the two reads the driver app's
 * Home, Jobs tab, Profile and Personal Information screens need and which had
 * no route before this service existed.
 *
 * Both reads are scoped to the caller's driver id; nothing here takes a driver
 * id from the request.
 */
@Injectable()
export class DriverJobsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly repo: JobExecutionRepo,
  ) {}

  async profile(driverId: string): Promise<DriverProfile> {
    const [row] = await this.db
      .select({
        id: drivers.id,
        name: drivers.name,
        mobile: drivers.mobile,
        photoUrl: drivers.photoUrl,
        rating: drivers.rating,
        totalTrips: drivers.totalTrips,
        acceptanceRate: drivers.acceptanceRate,
        completionRate: drivers.completionRate,
        level: drivers.level,
        kycStatus: drivers.kycStatus,
        createdAt: drivers.createdAt,
        fleetId: fleets.id,
        fleetName: fleets.businessName,
        truckPlate: fleetTrucks.plate,
        truckMake: fleetTrucks.make,
        truckModel: fleetTrucks.model,
        truckClass: fleetTrucks.type,
      })
      .from(drivers)
      .leftJoin(fleets, eq(drivers.fleetId, fleets.id))
      .leftJoin(fleetTrucks, eq(drivers.assignedTruckId, fleetTrucks.id))
      .where(eq(drivers.id, driverId))
      .limit(1);

    if (!row) throw ApiException.notFound('Driver not found');

    return {
      id: row.id,
      name: row.name,
      mobile: row.mobile,
      photoUrl: row.photoUrl,
      rating: row.rating === null ? null : Number(row.rating),
      totalTrips: row.totalTrips,
      acceptanceRatePct: row.acceptanceRate === null ? null : Number(row.acceptanceRate),
      completionRatePct: row.completionRate === null ? null : Number(row.completionRate),
      level: row.level,
      kycStatus: row.kycStatus,
      memberSince: row.createdAt.toISOString(),
      fleet:
        row.fleetId && row.fleetName
          ? { id: row.fleetId, name: row.fleetName }
          : null,
      truck:
        row.truckPlate && row.truckClass
          ? {
              plate: row.truckPlate,
              make: row.truckMake,
              model: row.truckModel,
              vehicleClass: row.truckClass,
            }
          : null,
    };
  }

  async history(
    driverId: string,
    query: DriverJobHistoryQuery,
  ): Promise<DriverJobHistoryResponse> {
    const conditions = [eq(bookings.driverId, driverId)];

    if (query.status === 'completed') {
      conditions.push(inArray(bookings.status, ['completed', 'paid']));
    } else if (query.status === 'cancelled') {
      conditions.push(eq(bookings.status, 'cancelled'));
    } else {
      conditions.push(notInArray(bookings.status, ['searching', 'no_drivers_found']));
    }

    if (query.cursor) {
      const cursor = decodeCursor(query.cursor);
      conditions.push(
        or(
          lt(bookings.createdAt, cursor.createdAt),
          and(eq(bookings.createdAt, cursor.createdAt), lt(bookings.id, cursor.id)),
        )!,
      );
    }

    const rows = await this.db
      .select({
        id: bookings.id,
        status: bookings.status,
        serviceType: bookings.serviceType,
        vehicleClass: bookings.vehicleClass,
        pickupAddress: bookings.pickupAddress,
        dropAddress: bookings.dropAddress,
        distanceKm: bookings.distanceKm,
        total: bookings.total,
        taxAmount: bookings.taxAmount,
        commissionBand: bookings.commissionBand,
        commissionPct: bookings.commissionPct,
        paymentMethod: bookings.paymentMethod,
        createdAt: bookings.createdAt,
        completedAt: bookings.completedAt,
      })
      .from(bookings)
      .where(and(...conditions))
      .orderBy(desc(bookings.createdAt), desc(bookings.id))
      .limit(query.limit + 1);

    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;
    const last = page[page.length - 1];

    const items: DriverJobHistoryItem[] = page.map((b) => ({
      bookingId: b.id,
      reference: `TW-${b.id.slice(0, 8).toUpperCase()}`,
      status: b.status,
      serviceType: b.serviceType,
      vehicleClass: b.vehicleClass,
      pickupAddress: b.pickupAddress,
      dropAddress: b.dropAddress,
      distanceKm: b.distanceKm === null ? null : Number(b.distanceKm),
      earnings: projectEarnings({
        totalRupees: b.total,
        taxRupees: b.taxAmount,
        band: b.commissionBand,
        commissionPct: b.commissionPct,
      }),
      paymentMethod:
        b.paymentMethod === null
          ? null
          : b.paymentMethod === 'cash'
            ? 'cash'
            : 'online',
      createdAt: b.createdAt.toISOString(),
      completedAt: b.completedAt ? b.completedAt.toISOString() : null,
    }));

    return {
      items,
      nextCursor:
        hasMore && last ? encodeCursor({ createdAt: last.createdAt, id: last.id }) : null,
    };
  }

  async detail(driverId: string, bookingId: string) {
    const [row] = await this.db
      .select({ id: bookings.id })
      .from(bookings)
      .where(and(eq(bookings.id, bookingId), eq(bookings.driverId, driverId)))
      .limit(1);

    if (!row) throw ApiException.notFound('Booking not found');

    const job = await this.repo.endedJob(bookingId);
    if (!job) throw ApiException.notFound('Booking not found');
    return job;
  }
}
