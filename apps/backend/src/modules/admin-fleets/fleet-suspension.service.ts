import { Inject, Injectable, Logger } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { ApiException } from '../../common/errors/api-exception';
import { DB, type Database } from '../../db/db.module';
import { drivers, fleets } from '../../db/schema';
import { AdminAuditService } from '../admin-auth/admin-audit.service';
import type { SessionContext } from '../auth/token.service';
import { AdminDriversService } from '../admin-drivers/admin-drivers.service';
import { OfferService } from '../dispatch/offer.service';
import { DriverPresenceService } from '../driver-presence/driver-presence.service';
import { PresenceStore } from '../driver-presence/presence-store';

export interface FleetSuspensionResult {
  fleetId: string;
  status: 'pending' | 'active' | 'suspended';
  driverCount: number;
}

/**
 * Suspending a fleet stops its drivers earning (A15) — 18 Sep rules:
 *
 * - the status flip and its audit row commit in ONE transaction;
 * - every outstanding offer to the fleet's drivers is revoked through A12's
 *   no-rate-damage path (scoped per driver, so other fleets' offers on the
 *   same bookings survive);
 * - only drivers with NO live booking are evicted. A driver mid-job stays in
 *   presence and finishes with tracking intact (the A14 rule); eligibility
 *   and the go-online block keep them from getting another job;
 * - sessions and devices are NEVER touched. On a mid-job driver that recreates
 *   the fault A14 exists to fix; on an idle driver the go-online block is
 *   what holds, not the session, and killing push would make reactivation
 *   slow (push stays dead until each driver logs in again). A driver who is
 *   individually a problem gets A14's driver suspension. The fleet OWNER is
 *   already cut off by `FleetRealmPolicy` at the next refresh.
 */
@Injectable()
export class FleetSuspensionService {
  private readonly logger = new Logger(FleetSuspensionService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AdminAuditService,
    private readonly offers: OfferService,
    private readonly presence: DriverPresenceService,
    private readonly store: PresenceStore,
    private readonly adminDrivers: AdminDriversService,
  ) {}

  async suspend(
    adminId: string,
    fleetId: string,
    context: SessionContext = {},
  ): Promise<FleetSuspensionResult> {
    const [fleet] = await this.db
      .select({ id: fleets.id, status: fleets.status, businessName: fleets.businessName })
      .from(fleets)
      .where(eq(fleets.id, fleetId))
      .limit(1);

    if (!fleet) throw ApiException.notFound('Fleet not found');

    const driverIds = await this.driverIdsOf(fleetId);
    if (fleet.status === 'suspended') {
      // Idempotent: re-running eviction is harmless, but a second audit row
      // for a no-op would lie about when the decision happened.
      return { fleetId, status: 'suspended', driverCount: driverIds.length };
    }

    // Outstanding offers die first, through the path that spares acceptance
    // rates — a suspended fleet's drivers must not time out of offers they
    // can no longer take.
    await this.revokeFleetOffers(fleetId, driverIds);

    const before = { status: fleet.status };
    await this.db.transaction(async (tx) => {
      await tx.update(fleets).set({ status: 'suspended' }).where(eq(fleets.id, fleetId));
      await this.audit.record(
        {
          adminId,
          action: 'fleet.suspend',
          subjectType: 'fleet',
          subjectId: fleetId,
          before,
          after: { status: 'suspended', driverCount: driverIds.length },
          reason: null,
          ip: context.ip ?? null,
          userAgent: context.userAgent ?? null,
        },
        { tx },
      );
    });

    // Evict the jobless only. A driver mid-job keeps presence, session and
    // tracking until the job ends; nothing here logs anyone out.
    let evicted = 0;
    for (const driverId of driverIds) {
      if (await this.adminDrivers.hasLiveBooking(driverId)) continue;
      await this.presence.evictRevoked(driverId);
      evicted += 1;
    }

    this.logger.log(`event=fleet_suspended fleet=${fleetId} drivers=${driverIds.length} evicted=${evicted}`);
    return { fleetId, status: 'suspended', driverCount: driverIds.length };
  }

  async reactivate(
    adminId: string,
    fleetId: string,
    context: SessionContext = {},
  ): Promise<FleetSuspensionResult> {
    const [fleet] = await this.db
      .select({ id: fleets.id, status: fleets.status })
      .from(fleets)
      .where(eq(fleets.id, fleetId))
      .limit(1);

    if (!fleet) throw ApiException.notFound('Fleet not found');
    if (fleet.status !== 'suspended') {
      return { fleetId, status: fleet.status, driverCount: 0 };
    }

    const before = { status: fleet.status };
    await this.db.transaction(async (tx) => {
      await tx.update(fleets).set({ status: 'active' }).where(eq(fleets.id, fleetId));
      await this.audit.record(
        {
          adminId,
          action: 'fleet.reactivate',
          subjectType: 'fleet',
          subjectId: fleetId,
          before,
          after: { status: 'active', driverCount: 0 },
          reason: null,
          ip: context.ip ?? null,
          userAgent: context.userAgent ?? null,
        },
        { tx },
      );
    });

    // Reinstating the fleet does NOT put anyone online, because drivers go
    // online themselves.
    return { fleetId, status: 'active', driverCount: 0 };
  }

  /**
   * Every searching booking holding an `offered` attempt for one of the
   * fleet's drivers, revoked driver-scoped so other fleets' offers on the
   * same bookings are untouched.
   */
  private async revokeFleetOffers(fleetId: string, driverIds: string[]): Promise<void> {
    if (driverIds.length === 0) return;
    const rows = (await this.db.execute(sql`
      select distinct dispatch_attempts.booking_id as "bookingId"
        from dispatch_attempts
        join drivers on drivers.id = dispatch_attempts.driver_id
       where dispatch_attempts.outcome = 'offered'
         and drivers.fleet_id = ${fleetId}::uuid
    `)) as unknown as Array<{ bookingId: string }>;
    for (const row of rows) {
      await this.offers.revokeDrivers(row.bookingId, driverIds, 'cancelled');
    }
  }

  private async driverIdsOf(fleetId: string): Promise<string[]> {
    const rows = await this.db
      .select({ id: drivers.id })
      .from(drivers)
      .where(eq(drivers.fleetId, fleetId));
    return rows.map((row) => row.id);
  }
}
