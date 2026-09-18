import { Module } from '@nestjs/common';
import { AdminAuthModule } from '../admin-auth/admin-auth.module';
import { AuthModule } from '../auth/auth.module';
import { DriverPresenceModule } from '../driver-presence/driver-presence.module';
import { FleetSuspensionService } from './fleet-suspension.service';

/**
 * Fleet suspension (A15) — the fleet counterpart of the driver KYC suspend.
 *
 * No controller yet: suspending a fleet from a screen (directory, dry-run
 * counts, typed confirmation) is W6's `AccountSuspensionService` surface,
 * which absorbs this service. What ships here is the mechanism with e2e
 * driving it directly: status flip, per-driver revoke chain, presence
 * eviction, offer-lock release, and one audit row.
 */
@Module({
  imports: [AuthModule, AdminAuthModule, DriverPresenceModule],
  providers: [FleetSuspensionService],
  exports: [FleetSuspensionService],
})
export class AdminFleetsModule {}
