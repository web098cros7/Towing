import { Injectable } from '@nestjs/common';
import {
  paiseToRupeeString,
  type FleetId,
  type JobDetail,
  type JobDto,
  type JobsListResponse,
  type JobsQuery,
} from '@towing/api-contracts';
import type { Response } from 'express';
import { streamCsv } from '../../common/csv/csv';
import { decodeCursor, encodeCursor } from './jobs.cursor';
import { toJobDetail, toJobDto } from './jobs.mapper';
import { ApiException } from '../../common/errors/api-exception';
import { JobsRepo } from './jobs.repo';

const CSV_HEADER = [
  'code',
  'created_at',
  'service',
  'status',
  'driver',
  'truck',
  'pickup',
  'drop',
  'distance_km',
  'gross_rupees',
  'commission_band',
  'commission_pct',
  'commission_rupees',
  'fleet_pool_rupees',
];

const EXPORT_BATCH = 1_000;

@Injectable()
export class JobsService {
  constructor(private readonly repo: JobsRepo) {}

  /** ADM-23: one of this fleet's jobs. Another fleet's id is a 404, like a made-up one. */
  async detail(fleetId: FleetId, bookingId: string): Promise<JobDetail> {
    const rows = await this.repo.detail(fleetId, bookingId);
    if (!rows) throw ApiException.notFound('Job not found');
    return toJobDetail(rows);
  }

  async list(fleetId: FleetId, query: JobsQuery): Promise<JobsListResponse> {
    const cursor = query.cursor ? decodeCursor(query.cursor) : undefined;
    // Fetch one extra row: its presence is the "there is a next page" signal.
    const rows = await this.repo.feedPage(fleetId, query, cursor, query.limit + 1);

    const pageRows = rows.slice(0, query.limit);
    const last = pageRows[pageRows.length - 1];
    const nextCursor =
      rows.length > query.limit && last
        ? encodeCursor({ createdAt: last.booking.createdAt, id: last.booking.id })
        : null;

    return { items: pageRows.map(toJobDto), nextCursor };
  }

  /**
   * Streams the filtered feed as CSV without ever buffering it: a batched
   * keyset loop over the same repo query the list endpoint uses, one
   * `res.write` per batch.
   *
   * The escaping and the streaming mechanics moved to `common/csv` in Phase 7,
   * when earnings statements and reports became the second and third exports —
   * see that file for the `@Res` caveat and the formula-injection rule.
   */
  async exportCsv(fleetId: FleetId, query: JobsQuery, res: Response): Promise<void> {
    let cursor = query.cursor ? decodeCursor(query.cursor) : undefined;
    let done = false;

    await streamCsv(res, { filename: 'towfleet-jobs.csv', header: CSV_HEADER }, async () => {
      if (done) return [];

      const rows = await this.repo.feedPage(fleetId, query, cursor, EXPORT_BATCH);
      if (rows.length < EXPORT_BATCH) {
        done = true;
      } else {
        const last = rows[rows.length - 1]!;
        cursor = { createdAt: last.booking.createdAt, id: last.booking.id };
      }

      return rows.map((row) => toCsvCells(toJobDto(row)));
    });
  }
}

function toCsvCells(job: JobDto): string[] {
  return [
    job.code,
    job.createdAt,
    job.serviceType,
    job.status,
    job.driverName ?? '',
    job.truckPlate ?? '',
    job.pickupArea,
    job.dropArea ?? '',
    String(job.distanceKm),
    paiseToRupeeString(job.grossPaise),
    job.commissionBand ?? '',
    job.commissionPct === null ? '' : String(job.commissionPct),
    paiseToRupeeString(job.commissionPaise),
    paiseToRupeeString(job.poolPaise),
  ];
}
