import { Module } from '@nestjs/common';
import { AdminOpsModule } from '../modules/admin-ops/admin-ops.module';
import { AuthModule } from '../modules/auth/auth.module';
import { AdminBridgeService } from './admin-bridge.service';
import { AdminGateway } from './admin.gateway';
import { AdminLocationRelay } from './admin-location-relay.service';
import { AdminOpsBroadcasterService } from './admin-ops-broadcaster.service';
import { AdminRealtimeController } from './admin-realtime.controller';
import { RealtimeModule } from './realtime.module';

/**
 * The `/admin` socket realm (W1, §3.4).
 *
 * Imports `RealtimeModule` for `WsTicketService` and
 * `RealtimeSubscriberService` — both exported — and `AuthModule` for the guard
 * dependencies, like every other controller module. The new gateway is
 * deliberately its OWN namespace on the SAME socket.io server: one server, one
 * Redis adapter, four realms, and a ticket that opens exactly one of them.
 *
 * W3 adds `AdminOpsModule` — the broadcaster recomputes through the same
 * `AdminOpsService` the REST endpoints serve, and `AdminBridgeService` fans the
 * result out to sockets.
 */
@Module({
  imports: [AuthModule, RealtimeModule, AdminOpsModule],
  controllers: [AdminRealtimeController],
  providers: [AdminGateway, AdminLocationRelay, AdminBridgeService, AdminOpsBroadcasterService],
})
export class AdminRealtimeModule {}
