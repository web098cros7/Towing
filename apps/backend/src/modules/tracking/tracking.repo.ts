import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNotNull, sql } from 'drizzle-orm';
import { DB, type Database, type DatabaseExecutor } from '../../db/db.module';
import { bookings, drivers, fleetTrucks } from '../../db/schema';
import { ACTIVE_JOB_STATUSES } from '../bookings/booking-state-machine.service';

/**
 * The Postgres half of §11's live tracking: who is driving this booking, where
 * the route is, and what the last computed ETA was.
 */

/** The booking as the tracking surfaces see it — no money, ever. */
export interface TrackingBookingRow {
  id: string;
  userId: string;
  status: string;
  driverId: string | null;
  pickupLat: number;
  pickupLng: number;
  dropLat: number | null;
  dropLng: number | null;
  routePolyline: string | null;
  routeDropPolyline: string | null;
  routeSource: string | null;
  etaSeconds: number | null;
  etaUpdatedAt: Date | null;
  shareToken: string | null;
  shareExpiresAt: Date | null;
  arrivedAt: Date | null;
  startedAt: Date | null;
  completedAt: Date | null;
  updatedAt: Date | null;
  driverName: string | null;
  driverPhotoUrl: string | null;
  driverRating: string | null;
  driverTotalTrips: number | null;
  driverMobile: string | null;
  driverVehicleClass: string | null;
  driverLastPingAt: Date | null;
  truckPlate: string | null;
}

/**
 * The last known fix for a driver, read from Postgres.
 *
 * A FALLBACK, NOT THE PRIMARY. The live path is the `location:driver` Redis
 * channel, which carries a fix every 3 s on an active job. This column is
 * refreshed on the ~30 s `LocationFlushService` cadence, so it is the answer for
 * a customer who has just opened the app (nothing has been pushed to them yet)
 * or whose socket is down — the §19.2 rung. `last_ping_at` travels with it so
 * the client can apply §11.6's own staleness thresholds to a value that may be
 * half a minute old, rather than being told it is live.
 */
export interface DriverFixRow {
  lat: number;
  lng: number;
  lastPingAt: Date | null;
}

@Injectable()
export class TrackingRepo {
  constructor(@Inject(DB) private readonly db: Database) {}

  /**
   * One read for every tracking surface — the customer poll, the share page and
   * the ETA engine.
   *
   * The driver join is LEFT: a `searching` booking has no driver, and the
   * tracking route is legitimately called before assignment (the app switches to
   * it the moment the search screen hands over). Returning nothing there would
   * make "not matched yet" indistinguishable from "no such booking".
   */
  async booking(bookingId: string): Promise<TrackingBookingRow | undefined> {
    const [row] = await this.db
      .select({
        id: bookings.id,
        userId: bookings.userId,
        status: bookings.status,
        driverId: bookings.driverId,
        pickupLat: bookings.pickupLat,
        pickupLng: bookings.pickupLng,
        dropLat: bookings.dropLat,
        dropLng: bookings.dropLng,
        routePolyline: bookings.routePolyline,
        routeDropPolyline: bookings.routeDropPolyline,
        routeSource: bookings.routeSource,
        etaSeconds: bookings.etaSeconds,
        etaUpdatedAt: bookings.etaUpdatedAt,
        shareToken: bookings.shareToken,
        shareExpiresAt: bookings.shareExpiresAt,
        arrivedAt: bookings.arrivedAt,
        startedAt: bookings.startedAt,
        completedAt: bookings.completedAt,
        updatedAt: bookings.updatedAt,
        driverName: drivers.name,
        driverPhotoUrl: drivers.photoUrl,
        driverRating: drivers.rating,
        driverTotalTrips: drivers.totalTrips,
        driverMobile: drivers.mobile,
        driverVehicleClass: drivers.vehicleClass,
        driverLastPingAt: drivers.lastPingAt,
        truckPlate: fleetTrucks.plate,
      })
      .from(bookings)
      .leftJoin(drivers, eq(drivers.id, bookings.driverId))
      .leftJoin(fleetTrucks, eq(fleetTrucks.id, bookings.truckId))
      .where(eq(bookings.id, bookingId))
      .limit(1);

    return row as TrackingBookingRow | undefined;
  }

  /** §11.7's public lookup. The token IS the credential, so nothing else is matched on. */
  async bookingByShareToken(shareToken: string): Promise<TrackingBookingRow | undefined> {
    const [found] = await this.db
      .select({ id: bookings.id })
      .from(bookings)
      .where(eq(bookings.shareToken, shareToken))
      .limit(1);

    if (!found) return undefined;
    return this.booking(found.id);
  }

  /**
   * The driver's last Postgres-known position.
   *
   * `ST_Y`/`ST_X` rather than reading the geography column through Drizzle: the
   * custom type round-trips WKB, and two functions are cheaper than decoding it
   * for two numbers.
   */
  async driverFix(driverId: string): Promise<DriverFixRow | undefined> {
    const rows = await this.db.execute<{ lat: number; lng: number; last_ping_at: string | null }>(
      sql`select st_y(${drivers.currentLocation}::geometry) as lat,
                 st_x(${drivers.currentLocation}::geometry) as lng,
                 ${drivers.lastPingAt} as last_ping_at
            from ${drivers}
           where ${drivers.id} = ${driverId}
             and ${drivers.currentLocation} is not null
           limit 1`,
    );

    const row = rows[0];
    if (!row) return undefined;
    return {
      lat: Number(row.lat),
      lng: Number(row.lng),
      // A raw `db.execute` bypasses Drizzle's column mappers, so postgres.js
      // hands back a string. Coerce here, in the repo, not downstream.
      lastPingAt: row.last_ping_at ? new Date(row.last_ping_at) : null,
    };
  }

  /**
   * The driver's currently active booking — the join that turns a ping into a
   * room name.
   *
   * `ACTIVE_JOB_STATUSES`, not `OPEN_BOOKING_STATUSES`: `searching` has no
   * driver by definition, so including it would only widen the scan. Backed by
   * `idx_bookings_driver_active` (migration 0013), the same index
   * `sampleBookingPath` relies on.
   */
  async activeBookingForDriver(
    driverId: string,
  ): Promise<{ bookingId: string; status: string; shareToken: string | null } | undefined> {
    const [row] = await this.db
      .select({
        bookingId: bookings.id,
        status: bookings.status,
        shareToken: bookings.shareToken,
      })
      .from(bookings)
      .where(
        and(
          eq(bookings.driverId, driverId),
          sql`${bookings.status} in ('assigned', 'en_route', 'arrived', 'in_progress')`,
        ),
      )
      .limit(1);

    return row;
  }

  /**
   * Persist a computed route. Runs once per booking, at assignment.
   *
   * NOT transaction-aware, unlike `expireShareOnCompletion` below, and
   * deliberately so: this always runs AFTER the assignment has committed. A
   * Directions request inside the accept transaction would hold row locks on a
   * fare-locked booking for up to four seconds of somebody else's network, and a
   * vendor timeout would roll back a driver's assignment.
   */
  async saveRoute(
    bookingId: string,
    route: {
      polyline: string | null;
      dropPolyline: string | null;
      source: string;
      etaSeconds: number | null;
    },
  ): Promise<void> {
    await this.db
      .update(bookings)
      .set({
        routePolyline: route.polyline,
        routeDropPolyline: route.dropPolyline,
        routeSource: route.source,
        etaSeconds: route.etaSeconds,
        etaUpdatedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(bookings.id, bookingId));
  }

  /**
   * Persist a recomputed ETA.
   *
   * SEPARATE FROM `saveRoute` AND DELIBERATELY NARROW. The route is written once;
   * this runs on §11.5's triggers for the life of the trip. Writing the polyline
   * columns again on every recompute would rewrite two text blobs a minute for
   * values that never change.
   */
  async saveEta(bookingId: string, etaSeconds: number, at: Date): Promise<void> {
    await this.db
      .update(bookings)
      .set({ etaSeconds, etaUpdatedAt: at, updatedAt: at })
      .where(eq(bookings.id, bookingId));
  }

  /** §11.7 — mint or replace the share token. */
  async setShareToken(
    bookingId: string,
    shareToken: string | null,
    shareExpiresAt: Date | null,
  ): Promise<void> {
    await this.db
      .update(bookings)
      .set({ shareToken, shareExpiresAt, updatedAt: new Date() })
      .where(eq(bookings.id, bookingId));
  }

  /**
   * §11.7's "expires when the trip completes (+30 min grace)".
   *
   * Only stamps a booking that actually HAS a live link, so a completion does not
   * write to two columns on every trip nobody shared. The `isNotNull` is the
   * whole point of the partial index this rides.
   */
  async expireShareOnCompletion(
    db: DatabaseExecutor,
    bookingId: string,
    expiresAt: Date,
  ): Promise<void> {
    await db
      .update(bookings)
      .set({ shareExpiresAt: expiresAt })
      .where(and(eq(bookings.id, bookingId), isNotNull(bookings.shareToken)));
  }
}

/** Re-exported so the relay and the mappers share one definition of "on a job". */
export { ACTIVE_JOB_STATUSES };
