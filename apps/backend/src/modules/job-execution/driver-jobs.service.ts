import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, lt, notInArray, or, sql } from 'drizzle-orm';
import type {
  DriverJobHistoryItem,
  DriverJobHistoryQuery,
  DriverJobHistoryResponse,
  DriverPhotoPresignResponse,
  DriverProfile,
  DriverProfileUpdate,
  DriverTruck,
} from '@towing/api-contracts';
import { ApiException } from '../../common/errors/api-exception';
import { keyFromFileUrl } from '../../common/storage/file-url';
import { PresignedUploadService } from '../../common/storage/presigned-upload.helper';
import { STORAGE, type StoragePort } from '../../common/storage/storage.port';
import { DB, type Database } from '../../db/db.module';
import { bookings } from '../../db/schema/bookings';
import { drivers } from '../../db/schema/drivers';
import { fleets } from '../../db/schema/fleets';
import { complianceDocuments, fleetTrucks } from '../../db/schema/trucks';
import { projectEarnings } from '../money/settlement';
import { decodeCursor, encodeCursor } from '../jobs/jobs.cursor';
import { toComplianceDtos } from '../trucks/trucks.mapper';
import { JobExecutionRepo } from './job-execution.repo';

/** Insurance leads: an expired one is what makes the truck `non_compliant` and stops offers. */
const DOC_ORDER = ['insurance', 'rc', 'puc', 'permit'] as const;

export const DRIVER_PHOTO_KEY_PREFIX = 'driver-photos';

/** One day — long enough for a slow client to render the avatar on next launch. */
const PHOTO_GET_TTL_SECONDS = 86_400;

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
    @Inject(STORAGE) private readonly storage: StoragePort,
    private readonly uploads: PresignedUploadService,
    private readonly repo: JobExecutionRepo,
  ) {}

  async profile(driverId: string): Promise<DriverProfile> {
    const [row] = await this.db
      .select({
        id: drivers.id,
        name: drivers.name,
        mobile: drivers.mobile,
        email: drivers.email,
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
      email: row.email,
      photoUrl: await this.readablePhotoUrl(row.photoUrl),
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

  async updateProfile(driverId: string, body: DriverProfileUpdate): Promise<DriverProfile> {
    const [updated] = await this.db
      .update(drivers)
      .set({
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.email !== undefined ? { email: body.email } : {}),
        updatedAt: new Date(),
      })
      .where(eq(drivers.id, driverId))
      .returning({ id: drivers.id });

    if (!updated) throw ApiException.notFound('Driver not found');
    // One shape for the client, and it re-reads the fleet and truck joins the
    // update does not touch.
    return this.profile(driverId);
  }

  /** Mints a slot for the driver's own profile photo. */
  presignPhoto(driverId: string): Promise<DriverPhotoPresignResponse> {
    return this.uploads.presign(DRIVER_PHOTO_KEY_PREFIX, driverId, 'photo');
  }

  /**
   * Records the uploaded photo. The key must be one this service minted for
   * THIS driver — a key from someone else's presign response would otherwise
   * let a driver claim another driver's upload as their avatar.
   */
  async confirmPhoto(driverId: string, key: string): Promise<DriverProfile> {
    if (!this.uploads.isOwnKey(key, DRIVER_PHOTO_KEY_PREFIX, driverId, 'photo')) {
      throw ApiException.forbidden('This key was not issued to you');
    }

    const [updated] = await this.db
      .update(drivers)
      .set({ photoUrl: `local://${key}`, updatedAt: new Date() })
      .where(eq(drivers.id, driverId))
      .returning({ id: drivers.id });

    if (!updated) throw ApiException.notFound('Driver not found');
    return this.profile(driverId);
  }

  /**
   * `photoUrl` is stored as `local://<key>`; the client needs a fetchable URL,
   * so a stored local key is presigned on read. Any other non-null value
   * (an external URL, a future `s3://…`) is passed through untouched.
   */
  private async readablePhotoUrl(photoUrl: string | null): Promise<string | null> {
    if (photoUrl && photoUrl.startsWith('local://')) {
      const presigned = await this.storage.presignGet(
        keyFromFileUrl(photoUrl),
        PHOTO_GET_TTL_SECONDS,
      );
      return presigned.url;
    }
    return photoUrl;
  }

  async truck(driverId: string): Promise<DriverTruck> {
    const [row] = await this.db
      .select({
        truckId: fleetTrucks.id,
        truckPlate: fleetTrucks.plate,
        truckMake: fleetTrucks.make,
        truckModel: fleetTrucks.model,
        truckClass: fleetTrucks.type,
        truckStatus: fleetTrucks.status,
        fleetName: fleets.businessName,
      })
      .from(drivers)
      .leftJoin(fleetTrucks, eq(drivers.assignedTruckId, fleetTrucks.id))
      .leftJoin(fleets, eq(drivers.fleetId, fleets.id))
      .where(eq(drivers.id, driverId))
      .limit(1);

    if (!row) throw ApiException.notFound('Driver not found');

    if (!row.truckId) {
      return { truck: null, fleetName: row.fleetName ?? null, documents: [] };
    }

    const docs = await this.db
      .select()
      .from(complianceDocuments)
      .where(eq(complianceDocuments.truckId, row.truckId));

    const documents = toComplianceDtos(row.truckId, docs).sort(
      (a, b) => DOC_ORDER.indexOf(a.docType) - DOC_ORDER.indexOf(b.docType),
    );

    return {
      truck: {
        id: row.truckId,
        plate: row.truckPlate!,
        make: row.truckMake,
        model: row.truckModel,
        vehicleClass: row.truckClass!,
        status: row.truckStatus!,
      },
      fleetName: row.fleetName ?? null,
      documents,
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
