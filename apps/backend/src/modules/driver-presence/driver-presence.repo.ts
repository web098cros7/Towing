import { Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { DB, type Database } from '../../db/db.module';
import { drivers, serviceZones } from '../../db/schema';
import { ACTIVE_JOB_STATUSES } from '../bookings/booking-state-machine.service';

/**
 * The Postgres half of driver presence.
 *
 * Postgres is the AUTHORITATIVE store and Redis is the hot one — the same order
 * `PositionsRepo` already establishes for trucks. It matters twice here: Redis
 * can be flushed and rebuilt from these rows, and §19.2's degraded path answers
 * `/drivers/nearby` from them when Redis is unreachable.
 */

export interface DriverIdentityRow {
  id: string;
  isOnline: boolean;
  kycStatus: string;
  zoneId: string | null;
  fleetId: string | null;
  truckId: string | null;
  vehicleClass: string | null;
  longDistance: boolean;
  /** A14: set while an admin suspension waits for the live job to end. */
  suspensionPending: boolean;
}

/** One buffered fix, ready for the ~30s batched flush. */
export interface FlushSample {
  driverId: string;
  lat: number;
  lng: number;
  at: Date;
}

/**
 * `ACTIVE_JOB_STATUSES` as an enum-typed SQL list.
 *
 * Interpolating the array directly binds it as ONE parameter, which Postgres
 * reads as a single malformed enum value. The `::booking_status` cast on each
 * literal is what keeps the comparison on the enum — a `status::text in (…)`
 * spelling would work and would silently stop using any index on `status`.
 */
function activeStatusList() {
  return sql.join(
    ACTIVE_JOB_STATUSES.map((status) => sql`${status}::booking_status`),
    sql`, `,
  );
}

@Injectable()
export class DriverPresenceRepo {
  constructor(@Inject(DB) private readonly db: Database) {}

  /**
   * Everything the hot hash caches, in one read.
   *
   * `assigned_truck_id` → `fleet_id` is resolved from the DRIVER row rather than
   * by joining `fleet_trucks`: a driver's `fleet_id` is the tenancy fact, and a
   * truck that belongs to a different fleet than its driver is a data bug the
   * fan-out must not paper over by preferring the truck's owner.
   */
  async identity(driverId: string): Promise<DriverIdentityRow | undefined> {
    const [row] = await this.db
      .select({
        id: drivers.id,
        isOnline: drivers.isOnline,
        kycStatus: drivers.kycStatus,
        zoneId: drivers.currentZoneId,
        fleetId: drivers.fleetId,
        truckId: drivers.assignedTruckId,
        vehicleClass: drivers.vehicleClass,
        longDistance: drivers.longDistanceEnabled,
        suspensionPending: sql<boolean>`${drivers.pendingSuspensionAt} is not null`,
      })
      .from(drivers)
      .where(eq(drivers.id, driverId))
      .limit(1);
    return row as DriverIdentityRow | undefined;
  }

  async goOnline(driverId: string, zoneId: string, point: { lat: number; lng: number }): Promise<void> {
    await this.db
      .update(drivers)
      .set({
        isOnline: true,
        currentZoneId: zoneId,
        currentLocation: point,
        lastPingAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(drivers.id, driverId));
  }

  /**
   * `current_zone_id` is cleared, `current_location` is NOT.
   *
   * The zone is a statement about availability and stops being true the moment
   * the driver goes offline. The last known position is a fact about the world
   * that stays true, and it is what the §19.2 PostGIS path and any "where did
   * this driver end their shift" question read.
   */
  async goOffline(driverId: string): Promise<void> {
    await this.db
      .update(drivers)
      .set({ isOnline: false, currentZoneId: null, updatedAt: new Date() })
      .where(eq(drivers.id, driverId));
  }

  async zoneName(zoneId: string): Promise<string | null> {
    const [row] = await this.db
      .select({ name: serviceZones.name })
      .from(serviceZones)
      .where(eq(serviceZones.id, zoneId))
      .limit(1);
    return row?.name ?? null;
  }

  /**
   * The slow authoritative write: one UPDATE for the whole batch rather than one
   * per driver, so cost scales with the FLUSH interval instead of the ping rate.
   *
   * `at.toISOString()`, never a bare `Date`: raw `sql` params bypass drizzle's
   * column mapping and postgres.js's Bind throws on a Date (engineering note 4).
   */
  async flushPositions(samples: FlushSample[]): Promise<void> {
    if (samples.length === 0) return;

    const values = samples.map(
      (s) =>
        sql`(${s.driverId}::uuid, ${s.lng}::double precision, ${s.lat}::double precision, ${s.at.toISOString()}::timestamptz)`,
    );

    await this.db.execute(sql`
      update drivers as d
      set current_location = ST_SetSRID(ST_MakePoint(v.lng, v.lat), 4326)::geography,
          last_ping_at = v.at,
          updated_at = now()
      from (values ${sql.join(values, sql`, `)}) as v(id, lng, lat, at)
      where d.id = v.id
    `);
  }

  /**
   * §11.2's "only samples and final positions are persisted" — the trip
   * breadcrumb.
   *
   * ONE STATEMENT, NO CACHED BOOKING ID. The active booking is found by the
   * insert's own SELECT, so there is no per-driver "which job is this" cache to
   * keep warm, to invalidate when Phase 17 assigns, or to get wrong when a job
   * completes mid-flush. A driver with no active job simply inserts no rows.
   */
  async sampleBookingPath(samples: FlushSample[]): Promise<void> {
    if (samples.length === 0) return;

    const values = samples.map(
      (s) =>
        sql`(${s.driverId}::uuid, ${s.lat}::double precision, ${s.lng}::double precision, ${s.at.toISOString()}::timestamptz)`,
    );

    await this.db.execute(sql`
      insert into booking_location_path (booking_id, lat, lng, recorded_at)
      select b.id, v.lat, v.lng, v.at
      from (values ${sql.join(values, sql`, `)}) as v(driver_id, lat, lng, at)
      join bookings b
        on b.driver_id = v.driver_id
       and b.status in (${activeStatusList()})
    `);
  }

  /**
   * §19.2's degraded candidate read — Redis is unreachable, so answer from the
   * authoritative store.
   *
   * Backed by `idx_drivers_online_geo`, the partial GIST added in migration
   * 0013. The unfiltered `idx_drivers_geo` from 0002 would make this scan every
   * driver who has ever pinged, including the offline and the un-approved.
   *
   * The freshness bound is `last_ping_at`, so this is only ever as current as
   * the last ~30s flush. That is exactly why the response says `degraded: true`
   * rather than passing the number off as live.
   */
  async candidatesNear(params: {
    lat: number;
    lng: number;
    radiusKm: number;
    stalePingSeconds: number;
    limit: number;
  }): Promise<Array<{ driverId: string; lat: number; lng: number; lastPingAt: string }>> {
    const rows = await this.db.execute<{
      id: string;
      lat: number;
      lng: number;
      last_ping_at: string;
    }>(sql`
      select id,
             ST_Y(current_location::geometry) as lat,
             ST_X(current_location::geometry) as lng,
             last_ping_at
      from drivers
      where is_online
        and kyc_status = 'approved'
        and current_location is not null
        and last_ping_at > now() - make_interval(secs => ${params.stalePingSeconds})
        and ST_DWithin(
              current_location,
              ST_SetSRID(ST_MakePoint(${params.lng}, ${params.lat}), 4326)::geography,
              ${params.radiusKm * 1000}
            )
      -- KNN, so the degraded rung ranks by proximity exactly as the Redis rung
      -- does. Without it the LIMIT would take an arbitrary subset of everyone in
      -- range, and a Redis outage would silently change WHICH drivers get
      -- offered rather than only how fresh their positions are.
      order by current_location <-> ST_SetSRID(ST_MakePoint(${params.lng}, ${params.lat}), 4326)::geography
      limit ${params.limit}
    `);

    return [...rows].map((r) => ({
      driverId: r.id,
      lat: Number(r.lat),
      lng: Number(r.lng),
      lastPingAt: new Date(r.last_ping_at).toISOString(),
    }));
  }

  /** Drivers still flagged online whose approval was revoked — the eviction sweep's input. */
  async onlineButNotApproved(driverIds: string[]): Promise<string[]> {
    if (driverIds.length === 0) return [];
    const rows = await this.db
      .select({ id: drivers.id })
      .from(drivers)
      .where(and(inArray(drivers.id, driverIds), sql`${drivers.kycStatus} <> 'approved'`));
    return rows.map((r) => r.id);
  }
}
