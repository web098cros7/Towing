import { Inject, Injectable, Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { ApiException } from '../../common/errors/api-exception';
import { DeviceRegistryService } from '../../common/notifications/device-registry.service';
import { DB, type Database } from '../../db/db.module';
import { drivers, fleets } from '../../db/schema';
import { AdminAuditService } from '../admin-auth/admin-audit.service';
import type { SessionContext } from '../auth/token.service';
import { TokenService } from '../auth/token.service';
import { PresenceStore } from '../driver-presence/presence-store';
import { DriverPresenceService } from '../driver-presence/driver-presence.service';

export interface FleetSuspensionResult {
  fleetId: string;
  status: 'pending' | 'active' | 'suspended';
  driversRevoked: number;
}

/**
 * Suspending a fleet stops its drivers earning (A15).
 *
 * The fleet counterpart of the driver KYC suspend chain: the status flip
 * blocks new offers (dispatch eligibility) and go-online (presence gate),
 * while the per-driver revoke chain evicts whoever is already online —
 * sessions, push devices, presence, and held offer locks. Read-side blocks
 * alone would leave online drivers dispatchable until their next ping.
 */
@Injectable()
export class FleetSuspensionService {
  private readonly logger = new Logger(FleetSuspensionService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AdminAuditService,
    private readonly tokens: TokenService,
    private readonly deviceRegistry: DeviceRegistryService,
    private readonly presence: DriverPresenceService,
    private readonly store: PresenceStore,
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
      return { fleetId, status: 'suspended', driversRevoked: driverIds.length };
    }

    const before = { status: fleet.status };
    await this.db.update(fleets).set({ status: 'suspended' }).where(eq(fleets.id, fleetId));

    let revoked = 0;
    for (const driverId of driverIds) {
      await this.tokens.revokeSubject(driverId, 'driver', 'fleet_suspend');
      await this.deviceRegistry.revokeAllForSubject('driver', driverId, 'fleet_suspended');
      await this.presence.evictRevoked(driverId);
      await this.store.releaseOfferLock(driverId);
      revoked += 1;
    }

    await this.audit.record({
      adminId,
      action: 'fleet.suspend',
      subjectType: 'fleet',
      subjectId: fleetId,
      before,
      after: { status: 'suspended', driversRevoked: revoked },
      reason: null,
      ip: context.ip ?? null,
      userAgent: context.userAgent ?? null,
    });

    this.logger.log(`event=fleet_suspended fleet=${fleetId} drivers=${revoked}`);
    return { fleetId, status: 'suspended', driversRevoked: revoked };
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

    const driverIds = await this.driverIdsOf(fleetId);
    if (fleet.status !== 'suspended') {
      return { fleetId, status: fleet.status, driversRevoked: 0 };
    }

    await this.db.update(fleets).set({ status: 'active' }).where(eq(fleets.id, fleetId));

    // Reinstating the fleet does NOT re-admit anyone by itself: sessions stay
    // revoked and drivers go online again explicitly. Same direction as the
    // driver reactivate path, which returns to `pending`, not `approved`.
    await this.audit.record({
      adminId,
      action: 'fleet.reactivate',
      subjectType: 'fleet',
      subjectId: fleetId,
      before: { status: 'suspended' },
      after: { status: 'active', driversRevoked: 0 },
      reason: null,
      ip: context.ip ?? null,
      userAgent: context.userAgent ?? null,
    });

    return { fleetId, status: 'active', driversRevoked: 0 };
  }

  private async driverIdsOf(fleetId: string): Promise<string[]> {
    const rows = await this.db
      .select({ id: drivers.id })
      .from(drivers)
      .where(eq(drivers.fleetId, fleetId));
    return rows.map((row) => row.id);
  }
}
