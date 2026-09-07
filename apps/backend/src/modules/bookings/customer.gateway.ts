import { Inject, Logger, UseFilters } from '@nestjs/common';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import {
  CUSTOMER_EVENT,
  CUSTOMER_NAMESPACE,
  bookingRoom,
  type CustomerBookingStatusEvent,
  type CustomerLocationUpdateEvent,
  type EtaUpdateEvent,
  type JobStatus,
  type SearchProgressEvent,
} from '@towing/api-contracts';
import { SkipThrottling } from '../../common/throttling/throttler.config';
import { ENV, type Env } from '../../config/env';
import type { CustomerNamespaceType, CustomerSocket } from '../../realtime/realtime.types';
import { WsExceptionFilter } from '../../realtime/ws-exception.filter';
import { WsTicketService } from '../../realtime/ws-ticket.service';

/**
 * The `/customer` namespace (§16.6) — Phase 17.
 *
 * WHY IT EXISTS NOW AND NOT IN PHASE 18. §9.1.6's acceptance criterion is that
 * "wave transitions reflect the actual engine state (no fake progress)", and the
 * engine advances a wave every twenty seconds. A ten-second REST poll would show
 * the customer roughly every other wave — real state, but a stuttering account
 * of it. More to the point, Phase 18 needs this namespace for live driver
 * position regardless, and building it here means the offer engine has somewhere
 * to publish rather than emitting into a room nobody joins. That is the same
 * argument that had Phase 16 build `driver:{id}` for Phase 17's benefit.
 *
 * ACCEPTS NOTHING, like `/fleet` and unlike `/driver`. The customer has nothing
 * to tell the server over a socket — cancelling is a REST call with an audit
 * trail — so `CustomerClientToServerEvents` is empty and stays empty.
 *
 * THE ROOM IS SCOPED TO ONE BOOKING, AND THE BOOKING ID COMES FROM THE TICKET.
 * `WsTicketService` mints it only after `POST /v1/bookings/:id/realtime/ticket`
 * has proved the caller owns that booking, so ownership is checked once, on a
 * route that already does it, and nothing the socket says afterwards can reach a
 * room name.
 */
@SkipThrottling()
@UseFilters(WsExceptionFilter)
@WebSocketGateway({ namespace: CUSTOMER_NAMESPACE })
export class CustomerGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(CustomerGateway.name);

  @WebSocketServer()
  private readonly namespace!: CustomerNamespaceType;

  constructor(
    private readonly tickets: WsTicketService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  afterInit(namespace: CustomerNamespaceType): void {
    namespace.use((socket, next) => {
      void this.authenticate(socket as CustomerSocket)
        .then(() => next())
        .catch((err: unknown) => next(err instanceof Error ? err : new Error('unauthorized')));
    });
  }

  private async authenticate(socket: CustomerSocket): Promise<void> {
    if (!this.env.REALTIME_ENABLED) {
      // §19.2 kill switch. TowGo already polls `GET /bookings/:id` every ten
      // seconds and the poll carries the same search state, so refusing cleanly
      // costs the customer freshness rather than information.
      throw new Error('realtime_unavailable');
    }

    const claims = await this.tickets.consume(
      (socket.handshake.auth as { ticket?: unknown } | undefined)?.ticket,
    );
    if (claims === null) throw new Error('unauthorized');
    // A fleet or driver ticket carries a different subject entirely; accepting
    // one here would room them against a booking they have no relationship to.
    if (claims.realm !== 'customer') throw new Error('unauthorized');

    socket.data.userId = claims.subjectId;
    socket.data.bookingId = claims.bookingId;
  }

  handleConnection(socket: CustomerSocket): void {
    const bookingId = socket.data.bookingId;
    if (!bookingId) {
      // Belt and braces: middleware rejection should make this unreachable, but
      // a socket with no booking must never sit in the namespace unroomed.
      socket.disconnect(true);
      return;
    }

    void socket.join(bookingRoom(bookingId));
    socket.emit(CUSTOMER_EVENT.READY, {
      bookingId,
      serverTime: new Date().toISOString(),
    });
    this.logger.debug(`socket ${socket.id} joined ${bookingRoom(bookingId)}`);
  }

  handleDisconnect(socket: CustomerSocket): void {
    this.logger.debug(`socket ${socket.id} disconnected`);
  }

  /**
   * §9.1.6's wave progress.
   *
   * CROSS-NODE, like the driver gateway's `config:update` and unlike Phase 5's
   * location relay. The distinction is where the message starts: Phase 5 fans
   * out something every node already holds off a shared Redis channel, so a
   * non-local emit would deliver N copies. This originates on whichever worker
   * ran the wave, and the customer's socket is very likely attached to a
   * different task — so it has to travel, and the socket.io Redis adapter is
   * what carries it.
   */
  emitSearchProgress(bookingId: string, payload: SearchProgressEvent): void {
    this.namespace.to(bookingRoom(bookingId)).emit(CUSTOMER_EVENT.SEARCH_PROGRESS, payload);
  }

  /** §5.1 status changes — the match itself, and every later transition. */
  emitBookingStatus(bookingId: string, status: JobStatus): void {
    const payload: CustomerBookingStatusEvent = {
      bookingId,
      status,
      at: new Date().toISOString(),
    };
    this.namespace.to(bookingRoom(bookingId)).emit(CUSTOMER_EVENT.BOOKING_STATUS, payload);
  }

  /**
   * §11.4's moving truck (Phase 18).
   *
   * `.local`, AND IT IS THE ONLY EMITTER ON THIS GATEWAY THAT IS. Everything
   * else here originates on one worker and has to cross the adapter to reach a
   * socket attached elsewhere. This one is fanned out from `location:driver`, a
   * Redis channel every node is subscribed to and every node already holds the
   * message from — so a cross-node emit would republish through the adapter and
   * each customer would receive N copies, one per task.
   *
   * That is the Phase 5 rule, learned the hard way there and asserted by
   * `multi-instance.e2e.spec.ts`: originates here → `.to()`, fanning out a
   * shared channel → `.local.to()`. `TrackingRelayService` is the only caller,
   * and it gates on `localRoomSize` first so a node with nobody watching does no
   * work at all for the stream.
   */
  emitLocationUpdate(payload: CustomerLocationUpdateEvent): void {
    this.namespace.local
      .to(bookingRoom(payload.bookingId))
      .emit(CUSTOMER_EVENT.LOCATION_UPDATE, payload);
  }

  /**
   * §11.5's smoothed estimate (Phase 18).
   *
   * Cross-node, unlike the position above: a recompute runs on whichever worker
   * handled the trigger, and the customer's socket is very likely somewhere
   * else.
   */
  emitEtaUpdate(payload: EtaUpdateEvent): void {
    this.namespace.to(bookingRoom(payload.bookingId)).emit(CUSTOMER_EVENT.ETA_UPDATE, payload);
  }

  /** How many sockets are watching this booking on THIS node. */
  localRoomSize(bookingId: string): number {
    return this.namespace.adapter.rooms.get(bookingRoom(bookingId))?.size ?? 0;
  }
}
