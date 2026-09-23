import { Inject, Injectable } from '@nestjs/common';
import { rupeeStringToPaise, type FleetId, type JobsQuery } from '@towing/api-contracts';
import { and, eq, gte, lt, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { DB, type Database } from '../../db/db.module';
import { bookingStatusHistory, bookings, drivers, fleetTrucks } from '../../db/schema';
import type { JobsCursor } from './jobs.cursor';

export interface JobFeedRow {
  booking: typeof bookings.$inferSelect;
  driverName: string | null;
  truckPlate: string | null;
}

export interface JobDetailRows extends JobFeedRow {
  /** The truck the booking recorded as running the job, when it did. */
  jobTruckPlate: string | null;
  history: Array<{ status: string; actor: string; createdAt: Date }>;
  /** Settlement credits and refund clawbacks on this booking, per wallet owner type. */
  ledger: Array<{ ownerType: string; type: string; amountPaise: number }>;
}

const DAY_MS = 86_400_000;

@Injectable()
export class JobsRepo {
  constructor(@Inject(DB) private readonly db: Database) {}

  /**
   * Keyset feed matching `idx_bookings_fleet_feed (fleet_id, created_at DESC,
   * id DESC)`. The row-comparison predicate is what lets Postgres walk the
   * index directly instead of sorting.
   */
  async feedPage(
    fleetId: FleetId,
    filters: Pick<JobsQuery, 'status' | 'from' | 'to'>,
    cursor: JobsCursor | undefined,
    limit: number,
  ): Promise<JobFeedRow[]> {
    const conditions: SQL[] = [eq(bookings.fleetId, fleetId)];

    if (filters.status) conditions.push(eq(bookings.status, filters.status));
    if (filters.from) conditions.push(gte(bookings.createdAt, new Date(filters.from)));
    if (filters.to) {
      // Inclusive date bound: everything before the day AFTER `to`.
      conditions.push(lt(bookings.createdAt, new Date(new Date(filters.to).getTime() + DAY_MS)));
    }
    if (cursor) {
      // toISOString: raw sql params bypass drizzle's Date mapping.
      conditions.push(
        sql`(${bookings.createdAt}, ${bookings.id}) < (${cursor.createdAt.toISOString()}::timestamptz, ${cursor.id}::uuid)`,
      );
    }

    const rows = await this.db
      .select({
        booking: bookings,
        driverName: drivers.name,
        truckPlate: fleetTrucks.plate,
      })
      .from(bookings)
      .leftJoin(drivers, eq(drivers.id, bookings.driverId))
      .leftJoin(fleetTrucks, eq(fleetTrucks.id, drivers.assignedTruckId))
      .where(and(...conditions))
      // NULLS LAST explicitly: drizzle-kit emitted the feed index as
      // `DESC NULLS LAST`, and Postgres matches null-ordering when picking a
      // sortless plan — a bare `DESC` (implicit NULLS FIRST) forces a Sort
      // node even though both columns are NOT NULL.
      .orderBy(
        sql`${bookings.createdAt} desc nulls last`,
        sql`${bookings.id} desc nulls last`,
      )
      .limit(limit);

    return rows;
  }

  /**
   * One job, only if it belongs to `fleetId` (ADM-23).
   *
   * Tenancy is the WHERE clause, not a check after the read: another fleet's
   * booking id returns nothing, exactly as a made-up id does, so the route can
   * answer 404 for both and never confirm that the id exists elsewhere.
   */
  async detail(fleetId: FleetId, bookingId: string): Promise<JobDetailRows | null> {
    const jobTruck = alias(fleetTrucks, 'job_truck');
    const [row] = await this.db
      .select({
        booking: bookings,
        driverName: drivers.name,
        truckPlate: fleetTrucks.plate,
        jobTruckPlate: jobTruck.plate,
      })
      .from(bookings)
      .leftJoin(drivers, eq(drivers.id, bookings.driverId))
      .leftJoin(fleetTrucks, eq(fleetTrucks.id, drivers.assignedTruckId))
      .leftJoin(jobTruck, eq(jobTruck.id, bookings.truckId))
      .where(and(eq(bookings.id, bookingId), eq(bookings.fleetId, fleetId)))
      .limit(1);
    if (!row) return null;

    const history = await this.db
      .select({
        status: bookingStatusHistory.status,
        actor: bookingStatusHistory.actor,
        createdAt: bookingStatusHistory.createdAt,
      })
      .from(bookingStatusHistory)
      .where(eq(bookingStatusHistory.bookingId, bookingId))
      .orderBy(bookingStatusHistory.createdAt);

    // Only the fleet side of the trip: the fleet's and its driver's wallets.
    // The customer's wallet legs on the same booking are not the fleet's
    // business, and a platform leg does not exist as a wallet.
    const ledger = (await this.db.execute(sql`
      select w.owner_type, t.type, t.amount::text as amount
        from wallet_transactions t
        join wallets w on w.id = t.wallet_id
       where t.ref_id = ${bookingId}::uuid
         and w.owner_type in ('fleet', 'driver')
         and t.type in ('fleet_share_credit', 'driver_share_credit', 'fare_credit', 'refund_debit')
    `)) as unknown as Array<{ owner_type: string; type: string; amount: string }>;

    return {
      ...row,
      history,
      ledger: ledger.map((leg) => ({
        ownerType: leg.owner_type,
        type: leg.type,
        amountPaise: rupeeStringToPaise(leg.amount),
      })),
    };
  }
}
