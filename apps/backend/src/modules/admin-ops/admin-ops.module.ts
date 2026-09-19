import { Module } from '@nestjs/common';
import { RealtimeModule } from '../../realtime/realtime.module';
import { AuthModule } from '../auth/auth.module';
import { AdminOpsController } from './admin-ops.controller';
import { AdminOpsRepo } from './admin-ops.repo';
import { AdminOpsService } from './admin-ops.service';

/**
 * W3/W4's Operations dashboard and live map (§9.4.2, §9.4.6).
 *
 * `AuthModule` for the guard's token dependency, same as every admin module.
 * `RealtimeModule` for its exported `PositionsRepo.activeZones()` — the live
 * map draws the same unscoped `service_zones` geography the fleet map draws,
 * and reusing the query is what keeps the two maps from disagreeing about it.
 *
 * `AdminOpsService` is exported for `AdminRealtimeModule`'s broadcaster, which
 * recomputes through the same service the REST endpoints serve — one code
 * path, so the pushed and fetched numbers cannot drift.
 */
@Module({
  imports: [AuthModule, RealtimeModule],
  controllers: [AdminOpsController],
  providers: [AdminOpsRepo, AdminOpsService],
  exports: [AdminOpsService],
})
export class AdminOpsModule {}
