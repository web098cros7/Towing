import { Inject, Injectable } from '@nestjs/common';
import type { FleetId } from '@towing/api-contracts';
import { and, asc, count, eq, gte, inArray, sql } from 'drizzle-orm';
import { DB, type Database } from '../../db/db.module';
import { drivers, fleetTrucks, wallets, walletTransactions } from '../../db/schema';

export type DriverRow = typeof drivers.$inferSelect;

@Injectable()
export class DriversRepo {
  constructor(@Inject(DB) private readonly db: Database) {}

  async listPage(
    fleetId: FleetId,
    params: { page: number; limit: number },
  ): Promise<{ rows: DriverRow[]; total: number }> {
    const where = eq(drivers.fleetId, fleetId);
    const [rows, [totalRow]] = await Promise.all([
      this.db
        .select()
        .from(drivers)
        .where(where)
        .orderBy(asc(drivers.name))
        .limit(params.limit)
        .offset((params.page - 1) * params.limit),
      this.db.select({ total: count() }).from(drivers).where(where),
    ]);
    return { rows, total: totalRow?.total ?? 0 };
  }

  /** Batched: plates for the page's assigned trucks in one query. */
  async platesFor(truckIds: string[]): Promise<Map<string, string>> {
    if (truckIds.length === 0) return new Map();
    const rows = await this.db
      .select({ id: fleetTrucks.id, plate: fleetTrucks.plate })
      .from(fleetTrucks)
      .where(inArray(fleetTrucks.id, truckIds));
    return new Map(rows.map((r) => [r.id, r.plate]));
  }

  /**
   * Batched: month-to-date net per driver — SUM(driver_share_credit) since the
   * IST month start, grouped by wallet owner. Returns rupee-string sums.
   */
  async monthNetFor(driverIds: string[], monthStart: Date): Promise<Map<string, string>> {
    if (driverIds.length === 0) return new Map();
    const rows = await this.db
      .select({
        driverId: wallets.ownerId,
        total: sql<string>`coalesce(sum(${walletTransactions.amount}), 0)`,
      })
      .from(walletTransactions)
      .innerJoin(wallets, eq(wallets.id, walletTransactions.walletId))
      .where(
        and(
          eq(wallets.ownerType, 'driver'),
          inArray(wallets.ownerId, driverIds),
          eq(walletTransactions.type, 'driver_share_credit'),
          gte(walletTransactions.createdAt, monthStart),
        ),
      )
      .groupBy(wallets.ownerId);
    return new Map(rows.map((r) => [r.driverId, r.total]));
  }

  async findById(fleetId: FleetId, driverId: string): Promise<DriverRow | undefined> {
    const [row] = await this.db
      .select()
      .from(drivers)
      .where(and(eq(drivers.fleetId, fleetId), eq(drivers.id, driverId)))
      .limit(1);
    return row;
  }

  async invite(
    fleetId: FleetId,
    data: { name: string; mobile: string; vehicleClass?: DriverRow['vehicleClass'] },
  ): Promise<DriverRow> {
    const [row] = await this.db
      .insert(drivers)
      .values({
        fleetId,
        name: data.name,
        mobile: data.mobile,
        vehicleClass: data.vehicleClass ?? null,
        kycStatus: 'incomplete',
      })
      .returning();
    return row!;
  }

  /** Truck lookup scoped to the fleet — cross-tenant truck ids read as absent. */
  async truckInFleet(fleetId: FleetId, truckId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ id: fleetTrucks.id })
      .from(fleetTrucks)
      .where(and(eq(fleetTrucks.fleetId, fleetId), eq(fleetTrucks.id, truckId)))
      .limit(1);
    return row !== undefined;
  }

  async setAssignedTruck(
    fleetId: FleetId,
    driverId: string,
    truckId: string | null,
  ): Promise<DriverRow | undefined> {
    const [row] = await this.db
      .update(drivers)
      .set({ assignedTruckId: truckId, updatedAt: new Date() })
      .where(and(eq(drivers.fleetId, fleetId), eq(drivers.id, driverId)))
      .returning();
    return row;
  }

  /**
   * ADM-23: one driver's performance, or null when the driver is not in this
   * fleet. Tenancy is the WHERE clause on every read: jobs and earnings are
   * this fleet's jobs for this driver, so a driver who moved fleets shows only
   * what they did here.
   */
  async performance(fleetId: FleetId, driverId: string, windowDays: number) {
    const [driver] = (await this.db.execute(sql`
      select id, name, rating::text as rating,
             acceptance_rate::text as acceptance_rate,
             completion_rate::text as completion_rate
        from drivers where id = ${driverId}::uuid and fleet_id = ${fleetId}::uuid
    `)) as unknown as Array<{
      id: string;
      name: string;
      rating: string | null;
      acceptance_rate: string | null;
      completion_rate: string | null;
    }>;
    if (!driver) return null;

    const since = sql`now() - make_interval(days => ${windowDays})`;

    const [trips] = (await this.db.execute(sql`
      select count(*) filter (where status in ('completed', 'paid', 'refunded'))::int as completed,
             count(*) filter (where status = 'cancelled')::int as cancelled,
             count(*) filter (where unable_reason is not null)::int as unable
        from bookings
       where driver_id = ${driverId}::uuid and fleet_id = ${fleetId}::uuid
         and created_at >= ${since}
    `)) as unknown as Array<{ completed: number; cancelled: number; unable: number }>;

    const [ratings] = (await this.db.execute(sql`
      select count(*)::int as n from ratings
       where driver_id = ${driverId}::uuid and direction = 'customer_to_driver'
    `)) as unknown as Array<{ n: number }>;

    // Net of clawbacks: settlement credits plus the (negative) refund legs,
    // on this fleet's bookings for this driver inside the window.
    const earnings = (await this.db.execute(sql`
      select w.owner_type, coalesce(sum(t.amount), 0)::text as net
        from wallet_transactions t
        join wallets w on w.id = t.wallet_id
        join bookings b on b.id = t.ref_id
       where b.driver_id = ${driverId}::uuid and b.fleet_id = ${fleetId}::uuid
         and b.created_at >= ${since}
         and w.owner_type in ('fleet', 'driver')
         and t.type in ('fleet_share_credit', 'driver_share_credit', 'fare_credit', 'refund_debit')
       group by w.owner_type
    `)) as unknown as Array<{ owner_type: string; net: string }>;

    const recent = (await this.db.execute(sql`
      select id, status, total::text as total, created_at
        from bookings
       where driver_id = ${driverId}::uuid and fleet_id = ${fleetId}::uuid
       order by created_at desc
       limit 10
    `)) as unknown as Array<{ id: string; status: string; total: string; created_at: Date | string }>;

    return { driver, trips: trips!, ratingsCount: ratings?.n ?? 0, earnings, recent };
  }

  /** 0042: the fleet's pay model and default, and this driver's override. */
  async payTerms(
    fleetId: FleetId,
    driverId: string,
  ): Promise<{ model: 'share' | 'salary'; fleetDefaultPct: number; overridePct: number | null }> {
    const [row] = (await this.db.execute(sql`
      select f.driver_pay_model, f.driver_share_pct::text as fleet_pct,
             fds.driver_share::text as override_pct
        from fleets f
        left join fleet_driver_shares fds
               on fds.fleet_id = f.id and fds.driver_id = ${driverId}::uuid
       where f.id = ${fleetId}::uuid
    `)) as unknown as Array<{
      driver_pay_model: 'share' | 'salary';
      fleet_pct: string;
      override_pct: string | null;
    }>;
    return {
      model: row?.driver_pay_model ?? 'share',
      fleetDefaultPct: Number(row?.fleet_pct ?? 80),
      overridePct: row?.override_pct == null ? null : Number(row.override_pct),
    };
  }

  async belongsToFleet(fleetId: FleetId, driverId: string): Promise<boolean> {
    const [row] = (await this.db.execute(sql`
      select 1 from drivers where id = ${driverId}::uuid and fleet_id = ${fleetId}::uuid
    `)) as unknown as Array<unknown>;
    return row !== undefined;
  }

  /** Upsert or clear a driver's share (the fleet keeps the rest). */
  async setShare(fleetId: FleetId, driverId: string, driverSharePct: number | null): Promise<void> {
    if (driverSharePct === null) {
      await this.db.execute(sql`
        delete from fleet_driver_shares
         where fleet_id = ${fleetId}::uuid and driver_id = ${driverId}::uuid
      `);
      return;
    }
    const driverShare = driverSharePct.toFixed(2);
    const fleetShare = (100 - driverSharePct).toFixed(2);
    const updated = (await this.db.execute(sql`
      update fleet_driver_shares
         set driver_share = ${driverShare}::numeric, fleet_share = ${fleetShare}::numeric,
             updated_at = now()
       where fleet_id = ${fleetId}::uuid and driver_id = ${driverId}::uuid
       returning id
    `)) as unknown as Array<unknown>;
    if (updated.length === 0) {
      await this.db.execute(sql`
        insert into fleet_driver_shares (fleet_id, driver_id, driver_share, fleet_share)
        values (${fleetId}::uuid, ${driverId}::uuid, ${driverShare}::numeric, ${fleetShare}::numeric)
      `);
    }
  }
}
