import { Controller, HttpCode, HttpStatus, Inject, Post, Req, UseGuards } from '@nestjs/common';
import {
  ADMIN_NAMESPACE,
  ErrorCodes,
  type WsTicketResponse,
} from '@towing/api-contracts';
import { ApiException } from '../common/errors/api-exception';
import { KillSwitchService } from '../common/killswitch/killswitch.service';
import { ThrottleBucket } from '../common/throttling/throttler.config';
import { ENV, type Env } from '../config/env';
import type { AuthedRequest } from '../modules/auth/auth.types';
import { JwtAuthGuard } from '../modules/auth/jwt-auth.guard';
import { Realms, Roles } from '../modules/auth/realm.decorator';
import { WsTicketService } from './ws-ticket.service';

/**
 * `POST /v1/admin/realtime/ticket` (W1, §3.4) — the admin console's handshake
 * credential, through the BFF like every other admin call.
 *
 * Every admin may open the socket (`admin:ops` is "everyone"); what an operator
 * can DO with the console is enforced per route and per frame emission, never
 * by socket membership.
 */
@Controller('admin/realtime')
@UseGuards(JwtAuthGuard)
@Realms('admin')
@Roles('super_admin', 'operations', 'support', 'finance')
export class AdminRealtimeController {
  constructor(
    private readonly tickets: WsTicketService,
    private readonly killSwitch: KillSwitchService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @Post('ticket')
  @HttpCode(HttpStatus.OK)
  @ThrottleBucket('realtime')
  async issueTicket(@Req() request: AuthedRequest): Promise<WsTicketResponse> {
    const auth = request.auth;
    // `@Realms('admin')` + `@Roles(...)` already guarantee an admin claim; this
    // narrows for TypeScript and fails closed if that ever stops being true.
    if (!auth || auth.role !== 'admin') throw ApiException.unauthorized();

    if (!this.env.REALTIME_ENABLED || (await this.killSwitch.isPollingForced())) {
      // §19.2: a specific code so the client goes straight to REST polling
      // instead of burning its reconnect budget.
      throw new ApiException(
        HttpStatus.SERVICE_UNAVAILABLE,
        ErrorCodes.REALTIME_UNAVAILABLE,
        'Realtime is disabled; fall back to polling',
      );
    }

    const ticket = await this.tickets.issue({
      realm: 'admin',
      subjectId: auth.sub,
      subRole: auth.sub_role,
    });

    return {
      ticket,
      expiresInSeconds: this.tickets.ttlSeconds,
      wsUrl: this.env.PUBLIC_WS_URL,
      namespace: ADMIN_NAMESPACE,
    };
  }
}
