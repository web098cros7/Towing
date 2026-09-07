import { Module } from '@nestjs/common';
import { RealtimeModule } from '../../realtime/realtime.module';
import { AuthModule } from '../auth/auth.module';
import { BookingsModule } from '../bookings/bookings.module';
import { DispatchModule } from '../dispatch/dispatch.module';
import { DriverPresenceModule } from '../driver-presence/driver-presence.module';
import { TrackingModule } from '../tracking/tracking.module';
import { DriverStatsService } from './driver-stats.service';
import { EnRouteWatcher } from './en-route.watcher';
import { JobExecutionController } from './job-execution.controller';
import { JobExecutionRepo } from './job-execution.repo';
import { JobExecutionService } from './job-execution.service';

/**
 * §5.2's job execution (Phase 18) — the chain that turns an assignment into a
 * finished trip.
 *
 * WHAT IT IMPORTS IS THE PHASE, READ AS A DEPENDENCY LIST:
 *
 * - `BookingsModule` (15) — `BookingStateMachineService`, the only writer of
 *   `bookings.status`; `BookingOtpService`, whose `verify()` was written in
 *   Phase 15 explicitly for this phase to call; and `CustomerGateway`, which
 *   carries every transition to the customer's screen.
 * - `DispatchModule` (17) — `DispatchService.redispatch` for §6.5, and
 *   `DispatchRepo` for the `unable` audit row. This is the export the dispatch
 *   module's own docblock promised and did not have.
 * - `TrackingModule` (18) — `EtaService` for §11.5's status-change trigger,
 *   `TrackingRepo` for the share link's completion expiry, and
 *   `AssignmentCacheService`, which every transition must invalidate.
 * - `DriverPresenceModule` (16) — `LocationFlushService.flushDriver`, so §11.2's
 *   trip replay gets the last positions instead of losing them to a driver who
 *   goes offline before the ~30 s timer.
 * - `AuthModule`/`RealtimeModule` — the guards, and the subscriber the en-route
 *   watcher rides.
 *
 * The order those phases had to land in is the order they are listed. Nothing
 * here could have been built earlier.
 */
@Module({
  imports: [
    AuthModule,
    BookingsModule,
    DispatchModule,
    TrackingModule,
    DriverPresenceModule,
    RealtimeModule,
  ],
  controllers: [JobExecutionController],
  providers: [JobExecutionService, JobExecutionRepo, DriverStatsService, EnRouteWatcher],
  exports: [JobExecutionService],
})
export class JobExecutionModule {}
