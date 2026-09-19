import { Module } from '@nestjs/common';
import { AdminAuthModule } from '../admin-auth/admin-auth.module';
import { AuthModule } from '../auth/auth.module';
import { DriverPresenceModule } from '../driver-presence/driver-presence.module';
import { PricingModule } from '../pricing/pricing.module';
import { AdminZonesController } from './admin-zones.controller';
import { AdminZonesService } from './admin-zones.service';
import { ZoneReconcileService } from './zone-reconcile.service';

/**
 * W13's zone editor.
 *
 * `PricingModule` for `ZoneResolverService` — the resolver IS the definition of
 * "which zone is this point in", and the reconcile has to ask the same question
 * the fare engine will ask a second later. `DriverPresenceModule` for
 * `PresenceStore` and `DriverPresenceRepo`, the two caches a reshape has to
 * update. `AdminAuthModule` for the audit writer.
 */
@Module({
  imports: [AuthModule, AdminAuthModule, PricingModule, DriverPresenceModule],
  controllers: [AdminZonesController],
  providers: [AdminZonesService, ZoneReconcileService],
})
export class AdminZonesModule {}
