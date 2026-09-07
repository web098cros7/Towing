import { Module } from '@nestjs/common';
import { AuthModule } from '../modules/auth/auth.module';
import { DashboardModule } from '../modules/dashboard/dashboard.module';
import { FleetGateway } from './fleet.gateway';
import { MetricsBroadcasterService } from './metrics-broadcaster.service';
import { PositionsRepo } from './positions.repo';
import { PositionsService } from './positions.service';
import { RealtimeController } from './realtime.controller';
import { RealtimeRelayService } from './realtime-relay.service';
import { RealtimeSubscriberService } from './realtime-subscriber.service';
import { WsTicketService } from './ws-ticket.service';

/**
 * Realtime transport (§11, §16.6, §18). `AuthModule` is imported for the same
 * reason every other feature module imports it: that is where `JwtAuthGuard` and
 * `FleetScopeGuard` are provided.
 *
 * Redis comes from the `@Global()` RedisModule, so there is nothing to wire.
 */
@Module({
  imports: [AuthModule, DashboardModule],
  controllers: [RealtimeController],
  providers: [
    FleetGateway,
    WsTicketService,
    RealtimeSubscriberService,
    RealtimeRelayService,
    MetricsBroadcasterService,
    PositionsRepo,
    PositionsService,
  ],
  /**
   * `RealtimeSubscriberService` is exported for Phase 18 (`TrackingModule`'s
   * position relay and `JobExecutionModule`'s en-route watcher).
   *
   * IT IS SAFE TO SHARE PRECISELY BECAUSE IT HOLDS A LIST OF HANDLERS PER
   * CHANNEL, not one. That was the Phase 5 bug — a single-handler map, where
   * whichever consumer registered second silently erased the other and
   * `ops:metrics` simply never arrived with no error anywhere. Three consumers
   * now subscribe to overlapping channels, and the list is what makes that a
   * composition rather than a race.
   */
  exports: [FleetGateway, WsTicketService, RealtimeSubscriberService],
})
export class RealtimeModule {}
