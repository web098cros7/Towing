import { Inject, Logger, UseFilters } from '@nestjs/common';
import {
  MessageBody,
  ConnectedSocket,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import {
  DRIVER_EVENT,
  DRIVER_NAMESPACE,
  driverLocationPingSchema,
  driverRoom,
  type BookingMessage,
  type DriverConfigUpdateEvent,
  type DriverLocationAccepted,
  type JobOfferEvent,
  type JobPaymentEvent,
  type JobRevokedEvent,
} from '@towing/api-contracts';
import { SkipThrottling } from '../../common/throttling/throttler.config';
import { ENV, type Env } from '../../config/env';
import type { DriverNamespaceType, DriverSocket } from '../../realtime/realtime.types';
import { WsExceptionFilter } from '../../realtime/ws-exception.filter';
import { WsTicketService } from '../../realtime/ws-ticket.service';
import { DriverPresenceService } from './driver-presence.service';
import { LocationIngestService } from './location-ingest.service';

/**
 * The `/driver` namespace (§16.6) — Phase 16.
 *
 * LIVES WITH ITS FEATURE, NOT IN `realtime/` BESIDE `FleetGateway`. The fleet
 * gateway sits there because its consumers do — the positions relay and the
 * metrics broadcaster are realtime infrastructure with no feature module of
 * their own. This gateway is a second door onto the presence pipeline and needs
 * `LocationIngestService` and `DriverPresenceService`, so putting it in
 * `RealtimeModule` would have made `RealtimeModule` and `DriverPresenceModule`
 * import each other. A `forwardRef` would compile; this arrangement means there
 * is no cycle to work around.
 *
 * THIS IS THE FIRST GATEWAY IN THE CODEBASE THAT ACCEPTS INPUT, and the reason
 * it is a second namespace rather than two more events on `/fleet`. `/fleet`'s
 * guarantee is that its `ClientToServerEvents` is empty, so nothing a browser
 * sends can influence a room; widening it here would spend that guarantee on
 * the console's behalf to buy the driver app a message it can equally well have
 * on its own namespace.
 *
 * The property that replaces it here: `handleLocationUpdate` reads its driver
 * from `socket.data`, which was written once at handshake from a redeemed
 * server-side ticket. `DriverLocationPing` carries no driver id at all, so there
 * is nothing in the message for a handler to be tempted by — the same shape
 * `RealtimeRelayService`'s tenancy warning asks for on the ingestion path.
 *
 * `@SkipThrottling` for the reason `FleetGateway` documents: `ThrottlerGuard` is
 * a global `APP_GUARD` whose `getRequestResponse` yields the socket on a WS
 * context, so every `@SubscribeMessage` would throttle under one garbage key —
 * and unlike `/fleet`, this namespace actually HAS a message handler, so the bug
 * would be live rather than theoretical. Ping-rate abuse is bounded by the
 * `seq` compare-and-set (a flood of stale numbers is discarded in one Redis
 * round trip) and by the ticket being single-use.
 */
@SkipThrottling()
@UseFilters(WsExceptionFilter)
@WebSocketGateway({ namespace: DRIVER_NAMESPACE })
export class DriverGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(DriverGateway.name);

  @WebSocketServer()
  private readonly namespace!: DriverNamespaceType;

  constructor(
    private readonly tickets: WsTicketService,
    private readonly presence: DriverPresenceService,
    private readonly ingest: LocationIngestService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  afterInit(namespace: DriverNamespaceType): void {
    namespace.use((socket, next) => {
      void this.authenticate(socket as DriverSocket)
        .then(() => next())
        .catch((err: unknown) => next(err instanceof Error ? err : new Error('unauthorized')));
    });
  }

  /**
   * The ONLY place a socket's driver is decided. It comes from a redeemed
   * single-use ticket, never from a query param or a message body.
   */
  private async authenticate(socket: DriverSocket): Promise<void> {
    if (!this.env.REALTIME_ENABLED) {
      // §19.2 kill switch. The driver app must fall to REST ingress rather than
      // burn its reconnect budget on a socket that will never be accepted — and
      // REST is the path that keeps working, so refusing cleanly here costs no
      // location data at all.
      throw new Error('realtime_unavailable');
    }

    const auth = socket.handshake.auth as { ticket?: unknown } | undefined;
    const claims = await this.tickets.consume(auth?.ticket);
    if (claims === null) throw new Error('unauthorized');

    // A fleet ticket carries a `fleet_users.id`. Accepting it here would put a
    // console user in `driver:{their own user id}` — a room Phase 17 delivers
    // job offers to.
    if (claims.realm !== 'driver') throw new Error('unauthorized');

    socket.data.driverId = claims.subjectId;
  }

  handleConnection(socket: DriverSocket): void {
    const driverId = socket.data.driverId;
    if (!driverId) {
      // Belt and braces: middleware rejection should make this unreachable, but
      // a socket with no subject must never sit in the namespace unroomed.
      socket.disconnect(true);
      return;
    }

    void socket.join(driverRoom(driverId));
    socket.emit(DRIVER_EVENT.READY, {
      driverId,
      serverTime: new Date().toISOString(),
    });

    // The cadence is pushed immediately rather than waiting for a state change:
    // a handset that reconnected mid-shift would otherwise keep whatever
    // interval it had before the drop, which may be the offline one.
    void this.pushConfig(driverId);
    this.logger.debug(`socket ${socket.id} joined ${driverRoom(driverId)}`);
  }

  handleDisconnect(socket: DriverSocket): void {
    // DISCONNECT IS NOT GOING OFFLINE. §6.1's liveness is ping freshness, so a
    // driver who loses their socket in a lift is still dispatchable for as long
    // as their last fix is fresh, and will resume over REST without any state
    // having changed. Evicting here would make availability depend on TCP.
    this.logger.debug(`socket ${socket.id} disconnected`);
  }

  /**
   * §16.6 `location:update` — the fast path.
   *
   * Acknowledged rather than fire-and-forget, because the handset has to know
   * which pings to drop from its buffer and where its sequence now stands. A
   * socket write with no ack would leave it guessing, and a handset that guesses
   * wrong either re-sends the whole buffer forever or discards fixes the server
   * never got.
   */
  @SubscribeMessage('location:update')
  async handleLocationUpdate(
    @MessageBody() body: unknown,
    @ConnectedSocket() socket: DriverSocket,
  ): Promise<DriverLocationAccepted> {
    const driverId = socket.data.driverId;
    if (!driverId) throw new Error('unauthorized');

    // Parsed here and not by a pipe: `JSON.parse` off the wire is `any`, and a
    // malformed frame must be one rejected message rather than a disconnected
    // driver.
    const parsed = driverLocationPingSchema.safeParse(body);
    if (!parsed.success) throw new Error('invalid_ping');

    return this.ingest.ingest(driverId, [parsed.data]);
  }

  /** Pushes the current cadence to every socket this driver has open. */
  async pushConfig(driverId: string): Promise<void> {
    try {
      const config = await this.presence.configFor(driverId);
      this.emitConfig(driverId, config);
    } catch (err) {
      this.logger.warn(
        `config push failed for ${driverId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * CROSS-NODE, unlike `FleetGateway.relayLocal`.
   *
   * The distinction is which side of the Redis hop the message starts on. Phase
   * 5's location relay fans out a message every node ALREADY holds (they all
   * subscribe to the same channel), so a non-local emit would deliver N copies.
   * This one originates on whichever task served the driver's REST call, and the
   * driver's socket is very likely attached to a different task — so it has to
   * travel, and the socket.io Redis adapter is what carries it. This is the
   * first real user of the adapter `RedisIoAdapter` has been installing since
   * Phase 5 for exactly this purpose.
   */
  emitConfig(driverId: string, config: DriverConfigUpdateEvent): void {
    this.namespace.to(driverRoom(driverId)).emit(DRIVER_EVENT.CONFIG_UPDATE, config);
  }

  /**
   * §6.3's offer (Phase 17).
   *
   * Cross-node, like `emitConfig` and for the same reason: the wave ran on
   * whichever worker picked the job up, and the driver's socket is very likely
   * attached to a different task. This is the delivery the whole `driver:{id}`
   * room was built for one phase early.
   *
   * FIRE AND FORGET, DELIBERATELY. The offer is also being pushed over FCM in
   * the same breath, because a backgrounded handset in Doze has no socket at
   * all — and the twenty-second window is far too short to spend waiting for a
   * delivery receipt this transport does not provide.
   */
  emitJobOffer(driverId: string, offer: JobOfferEvent): void {
    this.namespace.to(driverRoom(driverId)).emit(DRIVER_EVENT.JOB_OFFER, offer);
  }

  /**
   * The offer is gone — someone else took it, it expired, or the zone paused.
   *
   * Sent rather than left to the client's own countdown, because the countdown
   * is not the only way an offer dies. A takeover screen that sat there until
   * its timer ran out would let a driver tap Accept on a job that has been gone
   * for fifteen seconds and collect a 409 for it.
   */
  emitJobRevoked(driverId: string, bookingId: string, reason: JobRevokedEvent['reason']): void {
    this.namespace.to(driverRoom(driverId)).emit(DRIVER_EVENT.JOB_REVOKED, {
      bookingId,
      reason,
      at: new Date().toISOString(),
    });
  }

  /** Figma 24 — one chat message, to the driver's room (cross-node, like `emitJobOffer`). */
  emitChatMessage(driverId: string, message: BookingMessage): void {
    this.namespace.to(driverRoom(driverId)).emit(DRIVER_EVENT.CHAT_MESSAGE, message);
  }

  /**
   * The customer chose cash, switched to online, or the job was paid.
   *
   * Cross-node, like `emitChatMessage` and for the same reason: the payment
   * route ran on whichever worker served the customer's REST call, and the
   * driver's socket is very likely attached to a different task.
   */
  emitJobPayment(driverId: string, frame: JobPaymentEvent): void {
    this.namespace.to(driverRoom(driverId)).emit(DRIVER_EVENT.JOB_PAYMENT, frame);
  }

  /** How many sockets this driver has attached to THIS node. */
  localRoomSize(driverId: string): number {
    return this.namespace.adapter.rooms.get(driverRoom(driverId))?.size ?? 0;
  }
}
