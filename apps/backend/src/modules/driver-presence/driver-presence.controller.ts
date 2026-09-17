import { Controller, HttpCode, HttpStatus, Inject, Post, Req, UseGuards } from '@nestjs/common';
import {
  DRIVER_NAMESPACE,
  ErrorCodes,
  driverGoOnlineSchema,
  driverLocationBatchSchema,
  type DriverGoOnline,
  type DriverLocationAccepted,
  type DriverLocationBatch,
  type DriverPresenceResponse,
  type WsTicketResponse,
} from '@towing/api-contracts';
import { ApiException } from '../../common/errors/api-exception';
import { ThrottleBucket } from '../../common/throttling/throttler.config';
import { KillSwitchService } from '../../common/killswitch/killswitch.service';
import { ZodBody } from '../../common/validation/zod.decorators';
import { ENV, type Env } from '../../config/env';
import { WsTicketService } from '../../realtime/ws-ticket.service';
import type { AuthedRequest } from '../auth/auth.types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { KycApprovedGuard } from '../auth/kyc-approved.guard';
import { Realms } from '../auth/realm.decorator';
import { driverId } from '../driver-kyc/driver-kyc.controller';
import { DriverPresenceService } from './driver-presence.service';
import { DriverGateway } from './driver.gateway';
import { LocationIngestService } from './location-ingest.service';

/**
 * §11.2/§11.8's driver-facing presence and location routes (Phase 16).
 *
 * `KycApprovedGuard` ON THE WHOLE CONTROLLER — this is §3.1 layer 3, the gate
 * `driver-kyc.controller.ts` predicted ("the same way going online will be once
 * Phase 16 ships that route"). It is not only the toggle: a driver suspended
 * mid-shift must stop being dispatchable on their next request, and the guard's
 * fresh DB read is what makes that true for the location stream too, not just
 * for the act of going online.
 *
 * Every route acts on the caller's own driver row, identified from the token
 * (`auth.sub`) via the shared `driverId()` helper — never from a path param.
 */
@Controller('driver')
@UseGuards(JwtAuthGuard, KycApprovedGuard)
@Realms('driver')
export class DriverPresenceController {
  constructor(
    private readonly presence: DriverPresenceService,
    private readonly ingest: LocationIngestService,
    private readonly gateway: DriverGateway,
    private readonly tickets: WsTicketService,
    private readonly killSwitch: KillSwitchService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /**
   * The cadence is pushed from HERE rather than from inside the service, so the
   * service does not have to know a socket exists. That keeps the dependency
   * one-way (controller → gateway → services) instead of needing a `forwardRef`
   * between a service and the gateway that calls it.
   *
   * Fire-and-forget, and NOT awaited: the REST response already carries the same
   * cadence, so this caller is correct whatever happens to the socket. The push
   * exists for the driver's OTHER sockets — a second handset, or the one that
   * reconnected while this request was in flight.
   */
  @Post('online')
  @HttpCode(HttpStatus.OK)
  async goOnline(
    @ZodBody(driverGoOnlineSchema) body: DriverGoOnline,
    @Req() request: AuthedRequest,
  ): Promise<DriverPresenceResponse> {
    const id = driverId(request);
    const presence = await this.presence.goOnline(id, body);
    void this.gateway.pushConfig(id);
    return presence;
  }

  @Post('offline')
  @HttpCode(HttpStatus.OK)
  async goOffline(@Req() request: AuthedRequest): Promise<DriverPresenceResponse> {
    const id = driverId(request);
    const presence = await this.presence.goOffline(id);
    void this.gateway.pushConfig(id);
    return presence;
  }

  /**
   * The REST door onto the pipeline. ALWAYS AVAILABLE, never merely a fallback:
   * the Android foreground-service task and the iOS background handler cannot
   * assume a live socket in Doze, so this is the path that carries a shift's
   * location while the app is not on screen — which is most of it.
   *
   * `realtime` throttle bucket, not `reads`: at the on-job cadence of 3s a
   * single driver legitimately sends 20 requests a minute, which the 300/min
   * `reads` budget would tolerate but which belongs in the bucket named after
   * the traffic shape it is.
   *
   * NO `Idempotency-Key`. §19.4 requires one on mutating booking and money
   * endpoints; a location ping is neither, and it already has a stronger
   * mechanism — `seq` makes a replayed batch a no-op by construction rather than
   * by bookkeeping.
   */
  @Post('location')
  @HttpCode(HttpStatus.OK)
  @ThrottleBucket('realtime')
  ingestLocation(
    @ZodBody(driverLocationBatchSchema) body: DriverLocationBatch,
    @Req() request: AuthedRequest,
  ): Promise<DriverLocationAccepted> {
    return this.ingest.ingest(driverId(request), body.pings);
  }

  /**
   * Mints the `/driver` handshake credential.
   *
   * The driver app holds a real bearer token and could in principle put it on
   * the handshake — but a ticket is used anyway, for two reasons that outlive
   * the browser argument `WsTicketService` was written for: an access token on a
   * socket cannot be rotated for the life of the connection, and this route sits
   * behind `KycApprovedGuard`, so a suspended driver's next reconnect is refused
   * at ticket time rather than being discovered by the gateway.
   */
  @Post('realtime/ticket')
  @HttpCode(HttpStatus.OK)
  @ThrottleBucket('realtime')
  async issueTicket(@Req() request: AuthedRequest): Promise<WsTicketResponse> {
    if (!this.env.REALTIME_ENABLED || (await this.killSwitch.isPollingForced())) {
      // §19.2: a specific code rather than a 500, so the app goes straight to
      // REST ingress instead of retrying a socket that will never be accepted.
      throw new ApiException(
        HttpStatus.SERVICE_UNAVAILABLE,
        ErrorCodes.REALTIME_UNAVAILABLE,
        'Realtime is disabled; use POST /v1/driver/location',
      );
    }

    const ticket = await this.tickets.issue({ realm: 'driver', subjectId: driverId(request) });
    return {
      ticket,
      expiresInSeconds: this.tickets.ttlSeconds,
      wsUrl: this.env.PUBLIC_WS_URL,
      namespace: DRIVER_NAMESPACE,
    };
  }
}
