import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq, isNotNull, sql } from 'drizzle-orm';
import { DB, type Database } from '../../db/db.module';
import { drivers } from '../../db/schema';
import { PresenceStore } from '../driver-presence/presence-store';
import { DriverPresenceRepo } from '../driver-presence/driver-presence.repo';
import { ZoneResolverService } from '../pricing/zone-resolver.service';

/**
 * W13 — the pass that makes a reshape REAL for drivers who are already online.
 *
 * THE PROBLEM IT EXISTS FOR. A driver's zone is cached twice: on the Redis hash
 * at go-online (what the dispatch matcher's GEO sets are keyed by) and on
 * `drivers.current_zone_id`. Neither is a view over the polygon — so a reshape
 * or a deactivation leaves drivers standing in a zone that no longer exists,
 * quietly receiving no work and reporting no error. Nothing in the system
 * notices, because nothing is wrong from any single component's point of view.
 *
 * THREE OUTCOMES PER AFFECTED DRIVER:
 *   • still covered by another active zone → RE-HOME (driver row + hash; the
 *     next ping re-adds them to the new zone's GEO set within a cadence);
 *   • covered by nothing at all → EVICT: force offline, and the app's next
 *     position call fails honestly rather than silently;
 *   • no cached fix → treat as stranded. A driver whose hash expired is not
 *     dispatchable anyway, and leaving them "online" in a dead zone is the bug
 *     this pass exists to remove.
 *
 * RUN ON EVERY RESHAPE AND DEACTIVATION, from the write path — not a cron. A
 * boundary that moved an hour ago and a marketplace that agrees with it now is
 * the property the feature needs.
 */
@Injectable()
export class ZoneReconcileService {
  private readonly logger = new Logger(ZoneReconcileService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly presence: PresenceStore,
    private readonly driversRepo: DriverPresenceRepo,
    private readonly resolver: ZoneResolverService,
  ) {}

  async reconcileZone(zoneId: string): Promise<{ rehomed: number; evicted: number }> {
    const affected = await this.db
      .select({
        id: drivers.id,
        fleetId: drivers.fleetId,
        truckId: drivers.assignedTruckId,
        vehicleClass: drivers.vehicleClass,
      })
      .from(drivers)
      .where(and(eq(drivers.isOnline, true), eq(drivers.currentZoneId, zoneId)));

    let rehomed = 0;
    let evicted = 0;

    for (const driver of affected) {
      const fix = await this.presence.lastFix(driver.id);
      const resolved = fix ? await this.resolver.resolve({ lat: fix.lat, lng: fix.lng }) : null;

      if (resolved && resolved.id !== zoneId) {
        await this.db
          .update(drivers)
          .set({ currentZoneId: resolved.id, updatedAt: new Date() })
          .where(eq(drivers.id, driver.id));

        // Order matters: evict clears the OLD zone's GEO membership and the
        // hash; putIdentity writes the new zone onto the hash, and the driver's
        // next ping re-adds them to the new zone's set.
        await this.presence.evict(driver.id, zoneId);
        await this.presence.putIdentity(driver.id, {
          zoneId: resolved.id,
          fleetId: driver.fleetId,
          truckId: driver.truckId,
          vehicleClass: driver.vehicleClass ?? null,
          longDistance: false,
        });
        rehomed += 1;
        continue;
      }

      if (!resolved) {
        await this.presence.evict(driver.id, await this.presence.zoneOf(driver.id));
        await this.driversRepo.goOffline(driver.id);
        evicted += 1;
      }
      // `resolved.id === zoneId` — the driver is still inside the (reshaped)
      // zone and nothing about their world changed.
    }

    if (rehomed > 0 || evicted > 0) {
      this.logger.log(
        `zone ${zoneId} reconciled: ${rehomed} re-homed, ${evicted} evicted and forced offline`,
      );
    }
    return { rehomed, evicted };
  }

  /**
   * The preview's membership question — "who is standing inside this shape
   * right now", against positions Redis holds because the driver row does not
   * carry lng/lat.
   *
   * ONE QUERY PER ONLINE DRIVER, which is acceptable for a deliberate action on
   * a screen (and is why the endpoint is a preview rather than a list read).
   */
  async onlineDriversInShape(shape: unknown): Promise<{ inside: number; stranded: number }> {
    const online = await this.db
      .select({ id: drivers.id })
      .from(drivers)
      .where(and(eq(drivers.isOnline, true), isNotNull(drivers.lastPingAt)));

    let inside = 0;
    let stranded = 0;

    for (const driver of online) {
      const fix = await this.presence.lastFix(driver.id);
      if (!fix) continue;

      const rows = await this.db.execute(sql`
        SELECT ST_Covers(${shape}::geography,
                         ST_SetSRID(ST_MakePoint(${fix.lng}, ${fix.lat}), 4326)::geography) AS covered
      `);
      const covered = (rows as unknown as Array<{ covered: boolean }>)[0]?.covered === true;
      if (!covered) continue;

      inside += 1;
      const resolved = await this.resolver.resolve({ lat: fix.lat, lng: fix.lng });
      // `null` would mean the candidate is not reaching an ACTIVE zone either —
      // which is exactly the stranded case when the candidate IS the saved shape.
      if (!resolved) stranded += 1;
    }

    return { inside, stranded };
  }
}
