import { Module } from '@nestjs/common';
import { AdminAuthModule } from '../admin-auth/admin-auth.module';
import { AdminDriversModule } from '../admin-drivers/admin-drivers.module';
import { DispatchModule } from '../dispatch/dispatch.module';
import { DriverPresenceModule } from '../driver-presence/driver-presence.module';
import { FleetSuspensionService } from './fleet-suspension.service';

/**
 * Fleet suspension (A15) — the fleet counterpart of the driver KYC suspend.
 *
 * No controller yet: suspending a fleet from a screen (directory, dry-run
 * counts, typed confirmation) is W6's `AccountSuspensionService` surface,
 * which absorbs this service. What ships here is the mechanism with e2e
 * driving it directly: outstanding-offer revocation, transactional status
 * flip + audit, and eviction of the jobless only.
 *
 * Import edges point outward only (`AdminDriversModule` and `DispatchModule`
 * import nothing here), so the graph stays acyclic.
 */
@Module({
  imports: [AdminAuthModule, AdminDriversModule, DispatchModule, DriverPresenceModule],
  providers: [FleetSuspensionService],
  exports: [FleetSuspensionService],
})
export class AdminFleetsModule {}
