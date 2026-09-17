import { Controller, Get, HttpCode, HttpStatus, Inject, Post, Req, UseGuards } from '@nestjs/common';
import {
  ErrorCodes,
  FLEET_NAMESPACE,
  type FleetId,
  type PositionsSnapshotDto,
  type WsTicketResponse,
} from '@towing/api-contracts';
import { ApiException } from '../common/errors/api-exception';
import { ThrottleBucket } from '../common/throttling/throttler.config';
import { KillSwitchService } from '../common/killswitch/killswitch.service';
import { CurrentFleet } from '../common/tenancy/current-fleet.decorator';
import { FleetScopeGuard } from '../common/tenancy/fleet-scope.guard';
import { ENV, type Env } from '../config/env';
import type { AuthedRequest } from '../modules/auth/auth.types';
import { JwtAuthGuard } from '../modules/auth/jwt-auth.guard';
import { PositionsService } from './positions.service';
import { WsTicketService } from './ws-ticket.service';

@Controller('fleet/realtime')
@UseGuards(JwtAuthGuard, FleetScopeGuard)
export class RealtimeController {
  constructor(
    private readonly tickets: WsTicketService,
    private readonly positions: PositionsService,
    private readonly killSwitch: KillSwitchService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /**
   * Mints the single-use handshake credential. The console reaches this through
   * the BFF proxy, which already injects the bearer from the httpOnly cookie and
   * transparently refreshes it — so an expired access token never surfaces here
   * as a 401 the reconnect loop has to interpret.
   */
  @Post('ticket')
  @HttpCode(HttpStatus.OK)
  @ThrottleBucket('realtime')
  async issueTicket(
    @CurrentFleet() fleetId: FleetId,
    @Req() request: AuthedRequest,
  ): Promise<WsTicketResponse> {
    // `@CurrentFleet()` already proved `request.auth` exists; this narrows it.
    const userId = request.auth?.sub;
    if (!userId) throw ApiException.unauthorized();

    if (!this.env.REALTIME_ENABLED || (await this.killSwitch.isPollingForced())) {
      // §19.2: a specific code, not a generic 500, so the client can go straight
      // to REST polling instead of burning its reconnect budget.
      throw new ApiException(
        HttpStatus.SERVICE_UNAVAILABLE,
        ErrorCodes.REALTIME_UNAVAILABLE,
        'Realtime is disabled; fall back to polling',
      );
    }

    const ticket = await this.tickets.issue({ realm: 'fleet', fleetId, subjectId: userId });
    return {
      ticket,
      expiresInSeconds: this.tickets.ttlSeconds,
      wsUrl: this.env.PUBLIC_WS_URL,
      namespace: FLEET_NAMESPACE,
    };
  }

  /**
   * The §18 resync source: the console refetches this on every (re)connect
   * rather than assuming it saw every socket frame, and polls it every 10s when
   * the socket is unavailable (§19.2).
   *
   * Deliberately NOT `GET /fleet/trucks`: that reads the persisted position,
   * which the ping path only flushes every ~10s by design.
   */
  @Get('positions')
  positionsSnapshot(@CurrentFleet() fleetId: FleetId): Promise<PositionsSnapshotDto> {
    return this.positions.snapshot(fleetId);
  }
}
