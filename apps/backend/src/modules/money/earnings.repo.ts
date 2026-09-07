import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { FleetId } from '@towing/api-contracts';
import { DB_READER, type DatabaseReader } from '../../db/db.module';
import { settlementLateral } from './settlement-lateral';

/**
 * Every earnings read. Takes `DB_READER`, never `DB` — §9.3.8's AC is "report
 * queries hit read paths (no impact on live ops)", and `sole-writer.spec.ts`
 * fails the build if anything in here starts writing.
 *
 * House rule, unchanged: `fleetId` is the FIRST argument of every method and it
 * comes from the verified JWT via `@CurrentFleet()`, never from the request.
 */
@Injectable()
export class EarningsRepo {
  constructor(@Inject(DB_READER) private readonly db: DatabaseReader) {}

  /** Aggregate totals for a window, straight off the projection. */
  async totals(
    fleetId: FleetId,
    from: string,
    to: string,
  ): Promise<{
    jobs: number;
    gross: string;
    commission: string;
    pool: string;
    driverShare: string;
    fleetShare: string;
  }> {
    const [row] = (await this.db.execute(sql`
      select coalesce(sum(jobs), 0)::int as jobs,
             coalesce(sum(gross), 0)::text as gross,
             coalesce(sum(commission), 0)::text as commission,
             coalesce(sum(pool), 0)::text as pool,
             coalesce(sum(driver_share), 0)::text as driver_share,
             coalesce(sum(fleet_share), 0)::text as fleet_share
        from earnings_daily
       where fleet_id = ${fleetId}::uuid
         and day between ${from}::date and ${to}::date
    `)) as unknown as [
      {
        jobs: number;
        gross: string;
        commission: string;
        pool: string;
        driver_share: string;
        fleet_share: string;
      },
    ];

    return {
      jobs: row.jobs,
      gross: row.gross,
      commission: row.commission,
      pool: row.pool,
      driverShare: row.driver_share,
      fleetShare: row.fleet_share,
    };
  }

  /** Daily trend for the chart. One row per IST day that had activity. */
  async trend(
    fleetId: FleetId,
    from: string,
    to: string,
  ): Promise<Array<{ day: string; gross: string; fleetShare: string }>> {
    const rows = (await this.db.execute(sql`
      select to_char(day, 'YYYY-MM-DD') as day,
             sum(gross)::text as gross,
             sum(fleet_share)::text as fleet_share
        from earnings_daily
       where fleet_id = ${fleetId}::uuid
         and day between ${from}::date and ${to}::date
       group by day
       order by day
    `)) as unknown as Array<{ day: string; gross: string; fleet_share: string }>;

    return rows.map((row) => ({ day: row.day, gross: row.gross, fleetShare: row.fleet_share }));
  }

  /** Cached wallet balance plus the amount already committed to open payouts. */
  async walletPosition(fleetId: FleetId): Promise<{ balance: string; heldInPayouts: string }> {
    const [row] = (await this.db.execute(sql`
      select coalesce((
               select balance from wallets
                where owner_type = 'fleet' and owner_id = ${fleetId}::uuid
             ), 0)::text as balance,
             coalesce((
               select sum(amount) from payouts
                where owner_type = 'fleet' and owner_id = ${fleetId}::uuid
                  and status in ('requested', 'processing')
             ), 0)::text as held
    `)) as unknown as [{ balance: string; held: string }];

    return { balance: row.balance, heldInPayouts: row.held };
  }

  async hasActivePayoutAccount(fleetId: FleetId): Promise<boolean> {
    const [row] = (await this.db.execute(sql`
      select exists(
        select 1 from payout_accounts
         where owner_type = 'fleet' and owner_id = ${fleetId}::uuid and status = 'active'
      ) as linked
    `)) as unknown as [{ linked: boolean }];

    return row.linked;
  }

  /**
   * The per-booking split feed and the monthly statement's row source.
   *
   * Reads the LEDGER, not the projection: the projection serves aggregates,
   * this is the per-job breakdown §9.3.7 asks for ("driver–fleet split
   * breakdown per job").
   *
   * **Anchored on the booking, with the legs pulled in by a lateral.** The
   * obvious alternative — walk the fleet wallet's `fleet_share_credit` rows —
   * is one index scan and is wrong: `fleet_driver_shares` permits a 100/0
   * split, which produces no fleet leg at all, and those bookings would vanish
   * from the fleet's own split table with nothing failing. The lateral is
   * driven by `idx_wallet_transactions_ref`.
   *
   * **Ordered by the booking's `created_at`, matching the jobs feed exactly** —
   * same `idx_bookings_fleet_feed`, same cursor shape, and the two tables sit
   * next to each other in the console, so ordering them differently would be a
   * surprise. `desc nulls last` on both columns because `ORDER BY … DESC`
   * implies NULLS FIRST, which does NOT match the index and makes Postgres
   * re-sort every page (the lesson Phase 4 paid for).
   *
   * The date filter is on SETTLEMENT date, not booking date: §9.3.7's statement
   * is "the money that landed this month".
   */
  async splitFeed(
    fleetId: FleetId,
    filter: { from?: string; to?: string; driverId?: string },
    cursor: { createdAt: Date; id: string } | undefined,
    limit: number,
  ): Promise<
    Array<{
      bookingId: string;
      createdAt: Date;
      settledAt: Date;
      driverId: string | null;
      driverName: string | null;
      total: string;
      commissionBand: 'A' | 'B' | 'C' | null;
      commissionPct: string | null;
      commissionAmount: string;
      driverShare: string;
      fleetShare: string;
    }>
  > {
    const rows = (await this.db.execute(sql`
      select b.id as booking_id,
             b.created_at,
             l.settled_at,
             b.driver_id,
             d.name as driver_name,
             b.total::text as total,
             b.commission_band,
             b.commission_pct::text as commission_pct,
             b.commission_amount::text as commission_amount,
             l.driver_share::text as driver_share,
             l.fleet_share::text as fleet_share
        from bookings b
        ${settlementLateral()}
        left join drivers d on d.id = b.driver_id
       where b.fleet_id = ${fleetId}::uuid
         and l.settled_at is not null
         ${filter.from ? sql`and (l.settled_at at time zone 'Asia/Kolkata')::date >= ${filter.from}::date` : sql``}
         ${filter.to ? sql`and (l.settled_at at time zone 'Asia/Kolkata')::date <= ${filter.to}::date` : sql``}
         ${filter.driverId ? sql`and b.driver_id = ${filter.driverId}::uuid` : sql``}
         ${
           cursor
             ? sql`and (b.created_at, b.id) < (${cursor.createdAt.toISOString()}::timestamptz, ${cursor.id}::uuid)`
             : sql``
         }
       order by b.created_at desc nulls last, b.id desc nulls last
       limit ${limit}
    `)) as unknown as Array<{
      booking_id: string;
      created_at: Date;
      settled_at: Date;
      driver_id: string | null;
      driver_name: string | null;
      total: string;
      commission_band: 'A' | 'B' | 'C' | null;
      commission_pct: string | null;
      commission_amount: string;
      driver_share: string;
      fleet_share: string;
    }>;

    return rows.map((row) => ({
      bookingId: row.booking_id,
      createdAt: new Date(row.created_at),
      settledAt: new Date(row.settled_at),
      driverId: row.driver_id,
      driverName: row.driver_name,
      total: row.total,
      commissionBand: row.commission_band,
      commissionPct: row.commission_pct,
      commissionAmount: row.commission_amount,
      driverShare: row.driver_share,
      fleetShare: row.fleet_share,
    }));
  }
}
