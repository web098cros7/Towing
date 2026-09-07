import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BookingsModule } from '../bookings/bookings.module';
import { PricingModule } from '../pricing/pricing.module';
import { RealtimeModule } from '../../realtime/realtime.module';
import { DriverCandidatesRepo } from './driver-candidates.repo';
import { DriverGateway } from './driver.gateway';
import { DriverPresenceController } from './driver-presence.controller';
import { DriverPresenceRepo } from './driver-presence.repo';
import { DriverPresenceService } from './driver-presence.service';
import { FleetFanoutAdapter } from './fleet-fanout.adapter';
import { LocationFlushService } from './location-flush.service';
import { LocationIngestService } from './location-ingest.service';
import { PresenceStore } from './presence-store';

/**
 * §6.1's candidate store and §11.3's location pipeline (Phase 16).
 *
 * `PricingModule` for `ZoneResolverService` — the point-in-polygon that decides
 * which zone partition a driver goes into is the SAME one that prices a
 * customer's pickup, and a second implementation would be a second answer to
 * "are we live here". `BookingsModule` for `DispatchConfigRepo`, which owns the
 * §6.7 stale-ping threshold. `RealtimeModule` for `WsTicketService`, so the
 * driver app mints its handshake credential through the one service that knows
 * how. Everything else (DB, cache, Redis, metrics) is `@Global()`.
 *
 * EXPORTS ARE PHASE 17'S SURFACE. `DriverCandidatesRepo` is what the matcher
 * selects from, `PresenceStore` is where its offer lock will sit beside the
 * presence keys, and `DriverPresenceService.evictRevoked` is how an admin
 * suspension reaches the candidate store. They are exported now, with a single
 * consumer each, so the matcher inherits a seam rather than inventing one.
 */
@Module({
  imports: [AuthModule, PricingModule, BookingsModule, RealtimeModule],
  controllers: [DriverPresenceController],
  providers: [
    DriverGateway,
    DriverPresenceService,
    DriverPresenceRepo,
    DriverCandidatesRepo,
    LocationIngestService,
    LocationFlushService,
    FleetFanoutAdapter,
    PresenceStore,
  ],
  exports: [
    DriverCandidatesRepo,
    DriverPresenceService,
    DriverPresenceRepo,
    PresenceStore,
    DriverGateway,
    /**
     * Exported for Phase 18's completion path: §11.2's trip replay wants the
     * last positions, and the flush is otherwise on a ~30 s timer that a driver
     * who finishes a job and immediately goes offline can beat.
     */
    LocationFlushService,
  ],
})
export class DriverPresenceModule {}
