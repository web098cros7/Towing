import { Module } from '@nestjs/common';
import { AdminAuthModule } from '../admin-auth/admin-auth.module';
import { AuthModule } from '../auth/auth.module';
import { DriverPresenceModule } from '../driver-presence/driver-presence.module';
import { PricingModule } from '../pricing/pricing.module';
import { AdminSosController } from './admin-sos.controller';
import { SosController } from './sos.controller';
import { SosRepo } from './sos.repo';
import { SosService } from './sos.service';

/**
 * W14's safety slice (§13).
 *
 * Imports `DriverPresenceModule` for `DriverCandidatesRepo` rather than
 * reaching into the candidate store itself: G12's broadcast must reach exactly
 * the supply the matcher would consider — same liveness rule, same §19.2
 * PostGIS degradation — and a second reader that reimplemented either would be
 * a second answer to "who is available". `PricingModule` supplies the zone
 * resolver the radius search partitions by. `AdminAuthModule` is the exported
 * `AdminAuditService` — every operator step is audited through the sole writer
 * of `admin_actions`. Notifications, telephony and the kill switch are
 * `@Global()`.
 */
@Module({
  imports: [AuthModule, AdminAuthModule, DriverPresenceModule, PricingModule],
  controllers: [SosController, AdminSosController],
  providers: [SosService, SosRepo],
})
export class SosModule {}
