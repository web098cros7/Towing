import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DB_READER, type DatabaseReader } from '../../db/db.module';
import { settlementLateral } from './settlement-lateral';

/**
 * §9.2.4's earnings, READ STRAIGHT FROM THE LEDGER.
 *
 * WHY NOT `earnings_daily`, which already exists and already aggregates almost
 * exactly this. Two reasons, and the second is decisive:
 *
 *  1. IT STRUCTURALLY CANNOT SERVE AN INDEPENDENT DRIVER. `earnings_daily`'s
 *     primary key is `(fleet_id, day, driver_id)` with `fleet_id` NOT NULL and
 *     an FK to `fleets`; `fleet_id` also leads its only index; and both
 *     `grainKeysSince` and `grainKeysForBookings` filter `b.fleet_id is not
 *     null`. A driver with no fleet has no cell at all. Making one fit needs a
 *     nullable `fleet_id`, and the projector's own docstring already explains
 *     why that fails: NULLs are distinct in a Postgres unique key.
 *
 *  2. §9.2.4's ACCEPTANCE CRITERION IS "earnings derived from ledger", and the
 *     phase's verification is that the driver's displayed earnings reconcile to
 *     the paisa against a direct ledger query. Read the ledger and that is true
 *     by construction. Interpose a projection and the test becomes a test of
 *     the projector — the exact indirection the criterion was written to forbid.
 *
 * There is no scan to avoid, either: a driver's own feed is keyset-paginated at
 * twenty rows over `idx_bookings_driver_feed`, and the rollups aggregate 7–30
 * of them. `earnings_daily` exists for §9.3.8's "report queries hit read paths",
 * which is about a fleet spanning 400 trucks and 90 days. Different question.
 *
 * `DB_READER`: this file must never write, and `sole-writer.spec.ts` fails the
 * build if it does.
 */
@Injectable()
export class DriverEarningsRepo {
  constructor(@Inject(DB_READER) private readonly db: DatabaseReader) {}

  /**
   * One settled trip per row: gross → commission (band + %) → net.
   *
   * The five §9.2.4 numbers, from the same shared lateral the fleet console's
   * `splitFeed` uses, so a driver and their fleet owner cannot be shown
   * different figures for the same job.
   */
  async perTripFeed(
    driverId: string,
    filter: { from?: string; to?: string },
    cursor: { createdAt: Date; id: string } | undefined,
    limit: number,
  ): Promise<
    Array<{
      bookingId: string;
      createdAt: Date;
      settledAt: Date;
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
             b.total::text as total,
             b.commission_band,
             b.commission_pct::text as commission_pct,
             b.commission_amount::text as commission_amount,
             (l.driver_share + l.refunded)::text as driver_share,
             l.fleet_share::text as fleet_share
        from bookings b
        ${settlementLateral()}
       where b.driver_id = ${driverId}::uuid
         and l.settled_at is not null
         ${filter.from ? sql`and (l.settled_at at time zone 'Asia/Kolkata')::date >= ${filter.from}::date` : sql``}
         ${filter.to ? sql`and (l.settled_at at time zone 'Asia/Kolkata')::date <= ${filter.to}::date` : sql``}
         ${
           cursor
             ? sql`and (b.created_at, b.id) < (${cursor.createdAt.toISOString()}::timestamptz, ${cursor.id}::uuid)`
             : sql``
         }
       -- Matches idx_bookings_driver_feed exactly. A bare DESC implies NULLS
       -- FIRST and would make Postgres re-sort every page.
       order by b.created_at desc nulls last, b.id desc nulls last
       limit ${limit}
    `)) as unknown as Array<Record<string, unknown>>;

    return rows.map((row) => ({
      bookingId: row.booking_id as string,
      createdAt: new Date(row.created_at as string),
      settledAt: new Date(row.settled_at as string),
      total: row.total as string,
      commissionBand: (row.commission_band as 'A' | 'B' | 'C' | null) ?? null,
      commissionPct: (row.commission_pct as string | null) ?? null,
      commissionAmount: row.commission_amount as string,
      driverShare: row.driver_share as string,
      fleetShare: row.fleet_share as string,
    }));
  }

  /** Totals over the same rows the feed pages through. */
  async totals(
    driverId: string,
    from: string,
    to: string,
  ): Promise<{ jobs: number; gross: string; commission: string; net: string }> {
    const [row] = (await this.db.execute(sql`
      select count(*)::int as jobs,
             coalesce(sum(b.total), 0)::text as gross,
             coalesce(sum(b.commission_amount), 0)::text as commission,
             coalesce(sum(l.driver_share + l.refunded), 0)::text as net
        from bookings b
        ${settlementLateral()}
       where b.driver_id = ${driverId}::uuid
         and l.settled_at is not null
         and (l.settled_at at time zone 'Asia/Kolkata')::date between ${from}::date and ${to}::date
    `)) as unknown as [{ jobs: number; gross: string; commission: string; net: string }];

    return row;
  }

  /**
   * The daily chart.
   *
   * IST, not UTC, and the same expression the projection uses
   * (`(created_at at time zone 'Asia/Kolkata')::date`) — otherwise a driver's
   * chart and their fleet's would disagree by five and a half hours about which
   * day a late-evening trip belongs to.
   */
  async dailyTrend(
    driverId: string,
    from: string,
    to: string,
  ): Promise<Array<{ day: string; jobs: number; net: string }>> {
    const rows = (await this.db.execute(sql`
      select (l.settled_at at time zone 'Asia/Kolkata')::date::text as day,
             count(*)::int as jobs,
             coalesce(sum(l.driver_share + l.refunded), 0)::text as net
        from bookings b
        ${settlementLateral()}
       where b.driver_id = ${driverId}::uuid
         and l.settled_at is not null
         and (l.settled_at at time zone 'Asia/Kolkata')::date between ${from}::date and ${to}::date
       group by 1
       order by 1 asc
    `)) as unknown as Array<{ day: string; jobs: number; net: string }>;

    return rows;
  }

  /** ISO weeks in IST, newest first. Serves `/earnings/weekly` and the digest. */
  async weekly(
    driverId: string,
    weeks: number,
  ): Promise<Array<{ weekStart: string; jobs: number; gross: string; commission: string; net: string }>> {
    const rows = (await this.db.execute(sql`
      select date_trunc('week', l.settled_at at time zone 'Asia/Kolkata')::date::text as week_start,
             count(*)::int as jobs,
             coalesce(sum(b.total), 0)::text as gross,
             coalesce(sum(b.commission_amount), 0)::text as commission,
             coalesce(sum(l.driver_share + l.refunded), 0)::text as net
        from bookings b
        ${settlementLateral()}
       where b.driver_id = ${driverId}::uuid
         and l.settled_at is not null
         and l.settled_at >= now() - (${weeks} || ' weeks')::interval
       group by 1
       order by 1 desc
    `)) as unknown as Array<{
      week_start: string;
      jobs: number;
      gross: string;
      commission: string;
      net: string;
    }>;

    return rows.map((row) => ({
      weekStart: row.week_start,
      jobs: row.jobs,
      gross: row.gross,
      commission: row.commission,
      net: row.net,
    }));
  }

  /**
   * Balance and what is actually withdrawable.
   *
   * `available` nets off money already locked in `requested`/`processing`
   * payouts, so the app never has to do that arithmetic and can never disagree
   * with the server's own check about it. The fleet analogue is
   * `EarningsRepo.walletPosition`.
   */
  async walletPosition(driverId: string): Promise<{ balance: string; locked: string }> {
    const [row] = (await this.db.execute(sql`
      select coalesce((
               select w.balance from wallets
               w where w.owner_type = 'driver' and w.owner_id = ${driverId}::uuid
             ), 0)::text as balance,
             coalesce((
               select sum(p.amount) from payouts p
                where p.owner_type = 'driver' and p.owner_id = ${driverId}::uuid
                  and p.status in ('requested', 'processing')
             ), 0)::text as locked
    `)) as unknown as [{ balance: string; locked: string }];

    return row;
  }

  /**
   * The raw ledger feed — every leg, not only settlements.
   *
   * Payouts, cancellation compensation and §14.5 reversals all appear here, and
   * they must: a driver whose balance moved deserves to see the row that moved
   * it. That is also why the driver app's `TransactionKind` had to grow past
   * `job | bonus`.
   */
  async transactions(
    driverId: string,
    cursor: { createdAt: Date; id: string } | undefined,
    limit: number,
  ): Promise<
    Array<{
      id: string;
      amount: string;
      type: string;
      reason: string | null;
      refId: string | null;
      createdAt: Date;
    }>
  > {
    const rows = (await this.db.execute(sql`
      select t.id, t.amount::text as amount, t.type, t.reason, t.ref_id, t.created_at
        from wallet_transactions t
        join wallets w on w.id = t.wallet_id
       where w.owner_type = 'driver' and w.owner_id = ${driverId}::uuid
         ${
           cursor
             ? sql`and (t.created_at, t.id) < (${cursor.createdAt.toISOString()}::timestamptz, ${cursor.id}::uuid)`
             : sql``
         }
       -- idx_wallet_transactions_wallet_feed, added in 0016 for exactly this.
       order by t.created_at desc nulls last, t.id desc nulls last
       limit ${limit}
    `)) as unknown as Array<Record<string, unknown>>;

    return rows.map((row) => ({
      id: row.id as string,
      amount: row.amount as string,
      type: row.type as string,
      reason: (row.reason as string | null) ?? null,
      refId: (row.ref_id as string | null) ?? null,
      createdAt: new Date(row.created_at as string),
    }));
  }

  /** Every driver who earned in the given IST week — the digest's work list. */
  async driversWithEarningsSince(sinceDays: number): Promise<string[]> {
    const rows = (await this.db.execute(sql`
      select distinct b.driver_id
        from bookings b
        join wallet_transactions t on t.ref_id = b.id
       where b.driver_id is not null
         and t.type in ('driver_share_credit', 'fare_credit')
         and t.created_at >= now() - (${sinceDays} || ' days')::interval
    `)) as unknown as Array<{ driver_id: string }>;

    return rows.map((row) => row.driver_id);
  }
}
