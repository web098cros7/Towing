import { Inject, Injectable } from '@nestjs/common';
import type {
  ComplianceUpsertRequest,
  FleetId,
  TruckCreateRequest,
  TruckDto,
  TruckUpdateRequest,
  TrucksListQuery,
  TrucksListResponse,
} from '@towing/api-contracts';
import { ErrorCodes } from '@towing/api-contracts';
import { HttpStatus } from '@nestjs/common';
import { ApiException } from '../../common/errors/api-exception';
import { isUniqueViolation } from '../../common/errors/pg-errors';
import { FleetEventsService } from '../../common/events/fleet-events.service';
import { STORAGE, type StoragePort } from '../../common/storage/storage.port';
import { docStatusFromExpiry, toTruckDto } from './trucks.mapper';
import { TrucksRepo } from './trucks.repo';

@Injectable()
export class TrucksService {
  constructor(
    private readonly repo: TrucksRepo,
    private readonly events: FleetEventsService,
    @Inject(STORAGE) private readonly storage: StoragePort,
  ) {}

  async list(fleetId: FleetId, query: TrucksListQuery): Promise<TrucksListResponse> {
    const { rows, total } = await this.repo.listPage(fleetId, query);
    const truckIds = rows.map((t) => t.id);

    const [docs, assignments] = await Promise.all([
      this.repo.docsFor(fleetId, truckIds),
      this.repo.assignedDriversFor(fleetId, truckIds),
    ]);
    const driverByTruck = new Map(assignments.map((a) => [a.truckId, a.name]));

    return {
      items: rows.map((t) => toTruckDto(t, docs, driverByTruck.get(t.id) ?? null)),
      page: query.page,
      limit: query.limit,
      total,
    };
  }

  async create(fleetId: FleetId, body: TruckCreateRequest): Promise<TruckDto> {
    try {
      const row = await this.repo.create(fleetId, {
        plate: body.plate.toUpperCase(),
        type: body.type,
        capacity: `${body.capacityTons}t`,
        make: body.make || null,
        model: body.model || null,
      });
      await this.events.emit(fleetId, { kind: 'truck_changed', truckId: row.id });
      return toTruckDto(row, [], null);
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ApiException(
          HttpStatus.CONFLICT,
          ErrorCodes.DUPLICATE_PLATE,
          'A truck with this plate already exists in your fleet',
        );
      }
      throw err;
    }
  }

  async update(fleetId: FleetId, truckId: string, body: TruckUpdateRequest): Promise<TruckDto> {
    const patch: Parameters<TrucksRepo['update']>[2] = {};
    if (body.plate !== undefined) patch.plate = body.plate.toUpperCase();
    if (body.type !== undefined) patch.type = body.type;
    if (body.capacityTons !== undefined) patch.capacity = `${body.capacityTons}t`;
    // An empty string or null clears it (the customer's card then shows no make or model).
    if (body.make !== undefined) patch.make = body.make || null;
    if (body.model !== undefined) patch.model = body.model || null;
    if (body.status !== undefined) patch.status = body.status;

    let row;
    try {
      row = await this.repo.update(fleetId, truckId, patch);
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ApiException(
          HttpStatus.CONFLICT,
          ErrorCodes.DUPLICATE_PLATE,
          'A truck with this plate already exists in your fleet',
        );
      }
      throw err;
    }
    if (!row) throw ApiException.notFound('Truck not found');

    await this.events.emit(fleetId, { kind: 'truck_changed', truckId });
    const [docs, assignments] = await Promise.all([
      this.repo.docsFor(fleetId, [truckId]),
      this.repo.assignedDriversFor(fleetId, [truckId]),
    ]);
    return toTruckDto(row, docs, assignments[0]?.name ?? null);
  }

  async upsertCompliance(
    fleetId: FleetId,
    truckId: string,
    body: ComplianceUpsertRequest,
    file?: { buffer: Buffer; mimetype: string; originalname: string },
  ): Promise<{ truckStatus: string }> {
    let fileUrl: string | null = null;
    if (file) {
      const stored = await this.storage.put({
        buffer: file.buffer,
        mimeType: file.mimetype,
        keyPrefix: `compliance/${truckId}`,
        originalName: file.originalname,
      });
      fileUrl = stored.fileUrl;
    }

    const result = await this.repo.upsertComplianceDoc(fleetId, truckId, {
      docType: body.docType,
      issuedAt: body.issuedAt ?? null,
      expiresAt: body.expiresAt ?? null,
      status: docStatusFromExpiry(body.expiresAt ?? null),
      fileUrl,
    });
    if (!result) throw ApiException.notFound('Truck not found');

    // Compliance can flip a truck between `active` and `non_compliant`, which
    // moves `activeTrucks` and therefore `utilizationPct`'s denominator.
    await this.events.emit(fleetId, { kind: 'truck_changed', truckId });
    return result;
  }
}
