import { Module } from '@nestjs/common';
import { RoutingModule } from '../../common/routing/routing.module';
import { RealtimeModule } from '../../realtime/realtime.module';
import { AuthModule } from '../auth/auth.module';
import { BookingsModule } from '../bookings/bookings.module';
import { DriverPresenceModule } from '../driver-presence/driver-presence.module';
import { AssignmentCacheService } from './assignment-cache.service';
import { EtaService } from './eta.service';
import { TrackingController, PublicTrackController } from './tracking.controller';
import { TrackingRelayService } from './tracking-relay.service';
import { TrackingRepo } from './tracking.repo';
import { TrackingService } from './tracking.service';

/**
 * §11's live tracking (Phase 18) — position fan-out, the ETA engine, and
 * §11.7's share link.
 *
 * WHAT IT IMPORTS, AND WHY THE EDGES POINT THIS WAY:
 *
 * - `BookingsModule` (15/17) — `CustomerGateway`, which already owns the
 *   `/customer` namespace and whose own docblock says "Phase 18 needs this
 *   namespace for live driver position regardless". This module does NOT get
 *   imported back: `TrackingController` exists as its own class precisely so
 *   `BookingsModule` never needs an edge to here, which is what keeps the
 *   dependency acyclic without `forwardRef`.
 * - `RoutingModule` (14, extended here) — `DIRECTIONS`, the one billable call.
 * - `RealtimeModule` (5) — `RealtimeSubscriberService`, whose channel→handler
 *   LIST is what lets this become the second consumer of `location:driver`
 *   without disturbing the fleet relay.
 * - `DriverPresenceModule` (16) — `PresenceStore.lastFix`, the HOT position. The
 *   §19.2 poll reads it first and falls back to `drivers.current_location`,
 *   which is only written on the ~30 s flush and therefore had nothing to say
 *   for the first half-minute of a trip — exactly when the fallback matters.
 * - `AuthModule` — `JwtAuthGuard`.
 *
 * Telephony, Redis, the DB and metrics are all `@Global()`.
 *
 * Exports `EtaService` for the dispatch engine (one route call at assignment)
 * and the job machine (§11.5's status-change trigger), `TrackingRepo` for the
 * finalizer's share-link expiry, and `AssignmentCacheService` because the job
 * machine has to invalidate it at every transition — a stale entry there keeps
 * fanning a finished trip's pings and, worse, holds the status that decides
 * whether the ETA measures to the pickup or the drop.
 */
@Module({
  imports: [AuthModule, BookingsModule, DriverPresenceModule, RoutingModule, RealtimeModule],
  controllers: [TrackingController, PublicTrackController],
  providers: [
    TrackingRepo,
    TrackingService,
    EtaService,
    AssignmentCacheService,
    TrackingRelayService,
  ],
  exports: [EtaService, TrackingRepo, AssignmentCacheService],
})
export class TrackingModule {}
