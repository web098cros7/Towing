import { Module } from '@nestjs/common';
import { AdminAuthModule } from '../admin-auth/admin-auth.module';
import { AuthModule } from '../auth/auth.module';
import { DriverPresenceModule } from '../driver-presence/driver-presence.module';
import { AdminDriversController } from './admin-drivers.controller';
import { AdminDriversService } from './admin-drivers.service';

/**
 * The §3.1 KYC queue + per-document review (Phase 11). Imports
 * `AdminAuthModule` for its exported `AdminAuditService` — this stays the
 * sole writer of `admin_actions` rather than gaining a second one here.
 */
/**
 * `DriverPresenceModule` (Phase 16) so a suspension can evict the driver from
 * §6.1's candidate store in the same request that revokes their session —
 * losing authority and losing dispatchability are the same decision, and
 * splitting them across two phases' code would let one of them regress silently.
 */
@Module({
  imports: [AuthModule, AdminAuthModule, DriverPresenceModule],
  controllers: [AdminDriversController],
  providers: [AdminDriversService],
  // A14: job completion, unable-to-deliver and cancellation apply a shelved
  // suspension when the driver's job ends. None of those import this module
  // back, so the edge is acyclic (see each importer's header).
  exports: [AdminDriversService],
})
export class AdminDriversModule {}
