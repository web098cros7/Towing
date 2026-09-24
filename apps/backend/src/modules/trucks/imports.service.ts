import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import {
  importErrorCodes,
  type FleetId,
  type ImportRowErrorDto,
  type TruckImportDto,
} from '@towing/api-contracts';
import { and, eq, sql } from 'drizzle-orm';
import { ApiException } from '../../common/errors/api-exception';
import { FleetEventsService } from '../../common/events/fleet-events.service';
import { isUniqueViolation } from '../../common/errors/pg-errors';
import { QUEUE, type QueuePort } from '../../common/queue/queue.port';
import { ENV, type Env } from '../../config/env';
import { DB, type Database } from '../../db/db.module';
import { fleetTrucks, truckImports } from '../../db/schema';
import { failedRowCount, parseTruckCsv, type ParsedImport } from './bulk-import';

type ImportRow = typeof truckImports.$inferSelect;

function toDto(row: ImportRow): TruckImportDto {
  return {
    id: row.id,
    filename: row.filename,
    status: row.status,
    totalRows: row.totalRows,
    importedRows: row.importedRows,
    failedRows: row.failedRows,
    errors: row.errors,
    failureReason: row.failureReason,
    createdAt: row.createdAt.toISOString(),
  };
}

@Injectable()
export class TruckImportsService implements OnModuleInit {
  private readonly logger = new Logger(TruckImportsService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(QUEUE) private readonly queue: QueuePort,
    @Inject(ENV) private readonly env: Env,
    private readonly events: FleetEventsService,
  ) {}

  onModuleInit(): void {
    this.queue.process('trucks.bulk-import', async ({ fleetId, importId }) => {
      await this.runQueued(fleetId as FleetId, importId);
    });
  }

  /**
   * Entry point for an upload.
   *
   * Small files commit inside the request so the operator sees the result
   * immediately; anything over `BULK_IMPORT_SYNC_MAX_ROWS` is handed to the
   * queue, because holding an HTTP connection open through thousands of
   * inserts is how you get a gateway timeout and an import whose outcome
   * nobody knows.
   */
  async start(
    fleetId: FleetId,
    file: { buffer: Buffer; originalname: string },
  ): Promise<TruckImportDto> {
    const csv = file.buffer.toString('utf8');
    const parsed = parseTruckCsv(csv, this.env.BULK_IMPORT_MAX_ROWS);

    if (parsed.fatal) {
      // 422, not 500: the file parsed as bytes but failed the contract, which
      // is exactly what the validation code means (§16).
      throw ApiException.validation(parsed.fatal);
    }

    const [created] = await this.db
      .insert(truckImports)
      .values({
        fleetId,
        filename: file.originalname,
        status: 'processing',
        totalRows: parsed.totalRows,
      })
      .returning();

    const importId = created!.id;

    if (parsed.totalRows > this.env.BULK_IMPORT_SYNC_MAX_ROWS) {
      // The worker runs in another process and cannot see this request's
      // buffer, so the CSV rides in the row and is cleared when the job ends.
      await this.db
        .update(truckImports)
        .set({ payload: csv, status: 'pending', updatedAt: new Date() })
        .where(eq(truckImports.id, importId));

      await this.queue.enqueue(
        'trucks.bulk-import',
        { fleetId, importId },
        // Keyed on the import id so a retried request cannot run it twice.
        { jobId: `import:${importId}` },
      );

      return toDto({ ...created!, status: 'pending', payload: csv });
    }

    const result = await this.commit(fleetId, importId, parsed);
    return result;
  }

  /** The queued path. Failures here mark the import failed rather than vanishing. */
  private async runQueued(fleetId: FleetId, importId: string): Promise<void> {
    const [row] = await this.db
      .select()
      .from(truckImports)
      .where(and(eq(truckImports.id, importId), eq(truckImports.fleetId, fleetId)))
      .limit(1);

    if (!row) {
      this.logger.warn(`import ${importId} vanished before the worker ran`);
      return;
    }
    // Idempotent: a redelivered job must not import every row a second time.
    if (row.status === 'completed' || row.status === 'failed') return;
    if (!row.payload) {
      await this.fail(importId, 'Upload payload was not stored');
      return;
    }

    try {
      const parsed = parseTruckCsv(row.payload, this.env.BULK_IMPORT_MAX_ROWS);
      if (parsed.fatal) {
        await this.fail(importId, parsed.fatal);
        return;
      }
      await this.commit(fleetId, importId, parsed);
    } catch (err) {
      await this.fail(importId, err instanceof Error ? err.message : String(err));
      // Rethrow so BullMQ records the attempt and retries/DLQs it — swallowing
      // here would make the job look successful in the queue.
      throw err;
    }
  }

  /**
   * Inserts the valid rows and records the outcome.
   *
   * Row-at-a-time rather than one big INSERT: a single duplicate plate in a
   * 500-row file must not roll back the other 499. §9.3.4 asks for exactly
   * this — "valid rows commit, invalid rows produce an error report".
   */
  private async commit(
    fleetId: FleetId,
    importId: string,
    parsed: ParsedImport,
  ): Promise<TruckImportDto> {
    const errors: ImportRowErrorDto[] = [...parsed.errors];
    let imported = 0;

    for (const { row, data } of parsed.valid) {
      try {
        await this.db.insert(fleetTrucks).values({
          fleetId,
          plate: data.plate,
          type: data.type,
          capacity: `${data.capacityTons}t`,
          make: data.make || null,
          model: data.model || null,
        });
        imported += 1;
      } catch (err) {
        if (isUniqueViolation(err)) {
          errors.push({
            row,
            field: 'plate',
            code: importErrorCodes.DUPLICATE_PLATE,
            message: `A truck with plate ${data.plate} already exists in your fleet`,
          });
          continue;
        }
        throw err;
      }
    }

    const failed = failedRowCount(parsed) + (parsed.valid.length - imported);

    const [updated] = await this.db
      .update(truckImports)
      .set({
        status: 'completed',
        importedRows: imported,
        failedRows: failed,
        errors,
        // Payload is only needed while the job is queued; keeping every
        // fleet's uploads forever is a data-retention problem, not a feature.
        payload: null,
        updatedAt: new Date(),
      })
      .where(eq(truckImports.id, importId))
      .returning();

    if (imported > 0) {
      // New trucks move `totalTrucks`/`activeTrucks`, so the dashboard is stale.
      await this.events.emit(fleetId, { kind: 'truck_changed' });
    }

    this.logger.log(
      `import ${importId}: ${imported} imported, ${failed} failed of ${parsed.totalRows}`,
    );
    return toDto(updated!);
  }

  private async fail(importId: string, reason: string): Promise<void> {
    await this.db
      .update(truckImports)
      .set({ status: 'failed', failureReason: reason, payload: null, updatedAt: new Date() })
      .where(eq(truckImports.id, importId));
  }

  async get(fleetId: FleetId, importId: string): Promise<TruckImportDto> {
    const [row] = await this.db
      .select()
      .from(truckImports)
      .where(and(eq(truckImports.id, importId), eq(truckImports.fleetId, fleetId)))
      .limit(1);

    // Cross-tenant ids are indistinguishable from unknown ones.
    if (!row) throw ApiException.notFound('Import not found');
    return toDto(row);
  }

  async list(fleetId: FleetId, limit = 20): Promise<TruckImportDto[]> {
    const rows = await this.db
      .select()
      .from(truckImports)
      .where(eq(truckImports.fleetId, fleetId))
      .orderBy(sql`${truckImports.createdAt} desc nulls last`)
      .limit(limit);
    return rows.map(toDto);
  }
}
