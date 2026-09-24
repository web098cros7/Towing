import { Inject, Injectable } from '@nestjs/common';
import type { FleetId, TruckUpdateRequest } from '@towing/api-contracts';
import { and, asc, count, eq, inArray } from 'drizzle-orm';
import { DB, type Database } from '../../db/db.module';
import { complianceDocuments, drivers, fleetTrucks } from '../../db/schema';

export type TruckRow = typeof fleetTrucks.$inferSelect;
export type ComplianceRow = typeof complianceDocuments.$inferSelect;

export interface TrucksPage {
  rows: TruckRow[];
  total: number;
}

@Injectable()
export class TrucksRepo {
  constructor(@Inject(DB) private readonly db: Database) {}

  async listPage(
    fleetId: FleetId,
    params: { page: number; limit: number; status?: TruckRow['status'] },
  ): Promise<TrucksPage> {
    const where = params.status
      ? and(eq(fleetTrucks.fleetId, fleetId), eq(fleetTrucks.status, params.status))
      : eq(fleetTrucks.fleetId, fleetId);

    const [rows, [totalRow]] = await Promise.all([
      this.db
        .select()
        .from(fleetTrucks)
        .where(where)
        .orderBy(asc(fleetTrucks.plate))
        .limit(params.limit)
        .offset((params.page - 1) * params.limit),
      this.db.select({ total: count() }).from(fleetTrucks).where(where),
    ]);

    return { rows, total: totalRow?.total ?? 0 };
  }

  /** Batched lookup #1: all compliance docs for a page of trucks in one query. */
  async docsFor(fleetId: FleetId, truckIds: string[]): Promise<ComplianceRow[]> {
    if (truckIds.length === 0) return [];
    // truckIds already came from a fleet-scoped query; the join re-asserts it
    // anyway so this method is safe to call with any ids.
    return this.db
      .select({ doc: complianceDocuments })
      .from(complianceDocuments)
      .innerJoin(fleetTrucks, eq(fleetTrucks.id, complianceDocuments.truckId))
      .where(and(eq(fleetTrucks.fleetId, fleetId), inArray(complianceDocuments.truckId, truckIds)))
      .then((rows) => rows.map((r) => r.doc));
  }

  /** Batched lookup #2: assigned driver names for a page of trucks. */
  async assignedDriversFor(
    fleetId: FleetId,
    truckIds: string[],
  ): Promise<Array<{ truckId: string; name: string | null }>> {
    if (truckIds.length === 0) return [];
    const rows = await this.db
      .select({ truckId: drivers.assignedTruckId, name: drivers.name })
      .from(drivers)
      .where(and(eq(drivers.fleetId, fleetId), inArray(drivers.assignedTruckId, truckIds)));
    return rows.filter((r): r is { truckId: string; name: string | null } => r.truckId !== null);
  }

  async findById(fleetId: FleetId, truckId: string): Promise<TruckRow | undefined> {
    const [row] = await this.db
      .select()
      .from(fleetTrucks)
      .where(and(eq(fleetTrucks.fleetId, fleetId), eq(fleetTrucks.id, truckId)))
      .limit(1);
    return row;
  }

  async create(
    fleetId: FleetId,
    data: Pick<TruckRow, 'plate' | 'type' | 'capacity' | 'make' | 'model'>,
  ): Promise<TruckRow> {
    const [row] = await this.db
      .insert(fleetTrucks)
      .values({ fleetId, ...data })
      .returning();
    return row!;
  }

  async update(
    fleetId: FleetId,
    truckId: string,
    patch: Partial<Pick<TruckRow, 'plate' | 'type' | 'capacity' | 'make' | 'model' | 'status'>>,
  ): Promise<TruckRow | undefined> {
    const [row] = await this.db
      .update(fleetTrucks)
      .set({ ...patch, updatedAt: new Date() })
      .where(and(eq(fleetTrucks.fleetId, fleetId), eq(fleetTrucks.id, truckId)))
      .returning();
    return row;
  }

  /**
   * Upsert a compliance doc by (truckId, docType) and recompute the truck's
   * status in the same transaction. Manual `inactive` is sticky — recompute
   * only ever moves `active ↔ non_compliant`.
   */
  async upsertComplianceDoc(
    fleetId: FleetId,
    truckId: string,
    doc: {
      docType: ComplianceRow['docType'];
      issuedAt: Date | null;
      expiresAt: Date | null;
      status: ComplianceRow['status'];
      fileUrl: string | null;
    },
  ): Promise<{ truckStatus: TruckRow['status'] } | undefined> {
    return this.db.transaction(async (tx) => {
      const [truck] = await tx
        .select()
        .from(fleetTrucks)
        .where(and(eq(fleetTrucks.fleetId, fleetId), eq(fleetTrucks.id, truckId)))
        .limit(1);
      if (!truck) return undefined;

      const [existing] = await tx
        .select({ id: complianceDocuments.id, fileUrl: complianceDocuments.fileUrl })
        .from(complianceDocuments)
        .where(
          and(
            eq(complianceDocuments.truckId, truckId),
            eq(complianceDocuments.docType, doc.docType),
          ),
        )
        .limit(1);

      if (existing) {
        await tx
          .update(complianceDocuments)
          .set({
            issuedAt: doc.issuedAt,
            expiresAt: doc.expiresAt,
            status: doc.status,
            // A metadata-only renewal keeps the previously uploaded file.
            fileUrl: doc.fileUrl ?? existing.fileUrl,
            // A renewed doc re-arms the Phase 6 30-day alert.
            alertSent30d: false,
            updatedAt: new Date(),
          })
          .where(eq(complianceDocuments.id, existing.id));
      } else {
        await tx.insert(complianceDocuments).values({
          truckId,
          docType: doc.docType,
          issuedAt: doc.issuedAt,
          expiresAt: doc.expiresAt,
          status: doc.status,
          fileUrl: doc.fileUrl,
        });
      }

      const docs = await tx
        .select({ status: complianceDocuments.status })
        .from(complianceDocuments)
        .where(eq(complianceDocuments.truckId, truckId));
      const anyExpired = docs.some((d) => d.status === 'expired');

      let truckStatus = truck.status;
      if (truck.status === 'active' && anyExpired) truckStatus = 'non_compliant';
      else if (truck.status === 'non_compliant' && !anyExpired) truckStatus = 'active';

      if (truckStatus !== truck.status) {
        await tx
          .update(fleetTrucks)
          .set({ status: truckStatus, updatedAt: new Date() })
          .where(eq(fleetTrucks.id, truckId));
      }

      return { truckStatus };
    });
  }
}
