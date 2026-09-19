import { Inject, Logger, UseFilters } from '@nestjs/common';
import {
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  type OnGatewayConnection,
  type OnGatewayDisconnect,
  type OnGatewayInit,
} from '@nestjs/websockets';
import {
  ADMIN_NAMESPACE,
  ADMIN_REALTIME_EVENT,
  opsSubscribeSchema,
  adminBookingRoom,
  adminOpsRoom,
  adminUserRoom,
  adminZoneRoom,
  type AdminSubRole,
} from '@towing/api-contracts';
import type { BroadcastOperator } from 'socket.io';
import { SkipThrottling } from '../common/throttling/throttler.config';
import { ENV, type Env } from '../config/env';
import type {
  AdminNamespace,
  AdminServerToClientEvents,
  AdminSocket,
  AdminSocketData,
} from './realtime.types';
import { WsExceptionFilter } from './ws-exception.filter';
import { WsTicketService } from './ws-ticket.service';

/**
 * The `/admin` namespace (W1, §3.4). Handshake auth joins `admin:ops` and
 * `admin:user:{adminId}`; `ops:subscribe` adds filtered zone/booking rooms.
 *
 * THE RELAY RULE (rule 9) APPLIES HERE TOO: events arriving from a shared
 * Redis channel are re-emitted with `.local` — every node holds the same
 * message, and a non-local emit would have each client receive N copies.
 * Locally-originated frames (none today) would use `.to()`.
 */
@SkipThrottling()
@UseFilters(WsExceptionFilter)
@WebSocketGateway({ namespace: ADMIN_NAMESPACE })
export class AdminGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(AdminGateway.name);

  @WebSocketServer()
  private readonly namespace!: AdminNamespace;

  constructor(
    private readonly tickets: WsTicketService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  afterInit(namespace: AdminNamespace): void {
    namespace.use((socket, next) => {
      void this.authenticate(socket as AdminSocket)
        .then(() => next())
        .catch((err: unknown) => next(err instanceof Error ? err : new Error('unauthorized')));
    });
  }

  /** Identity comes from the redeemed ticket and nothing else. */
  private async authenticate(socket: AdminSocket): Promise<void> {
    if (!this.env.REALTIME_ENABLED) {
      // §19.2: refuse cleanly so the console goes to REST polling instead of
      // retrying a socket that will never be accepted.
      throw new Error('realtime_unavailable');
    }

    const auth = socket.handshake.auth as { ticket?: unknown } | undefined;
    const claims = await this.tickets.consume(auth?.ticket);
    if (claims === null) throw new Error('unauthorized');

    // Realm before id, exactly as the fleet gateway does: a driver or fleet
    // ticket carries ids that must never become admin room names.
    if (claims.realm !== 'admin') throw new Error('unauthorized');

    socket.data.adminId = claims.subjectId;
    socket.data.subRole = claims.subRole as AdminSubRole;
  }

  handleConnection(socket: AdminSocket): void {
    const adminId = socket.data.adminId;
    if (!adminId) {
      socket.disconnect(true);
      return;
    }

    void socket.join(adminOpsRoom());
    // The personal room is what `admin:revoke` disconnects (W2's demote and
    // deactivate publish it; the relay lives in `AdminRevokeBridgeService`).
    void socket.join(adminUserRoom(adminId));

    socket.emit(ADMIN_REALTIME_EVENT.READY, {
      adminId,
      subRole: socket.data.subRole,
      serverTime: new Date().toISOString(),
    });
    this.logger.debug(`socket ${socket.id} joined ${adminOpsRoom()}`);
  }

  handleDisconnect(socket: AdminSocket): void {
    this.logger.debug(`socket ${socket.id} disconnected`);
  }

  /**
   * Filter rooms (W4's zone filter, W8's booking drawer). Leaving the previous
   * set first is what keeps a long-lived console socket from accumulating
   * rooms as the operator clicks around.
   */
  @SubscribeMessage('ops:subscribe')
  handleSubscribe(socket: AdminSocket, payload: unknown): { ok: boolean } {
    const parsed = opsSubscribeSchema.safeParse(payload);
    if (!parsed.success) {
      // A malformed frame is not an exception path: the socket stays up, the
      // message is dropped, and the client sees `ok: false` on its ack.
      return { ok: false };
    }

    for (const room of socket.data.filterRooms ?? []) {
      void socket.leave(room);
    }

    const rooms = [
      ...(parsed.data.zoneIds ?? []).map(adminZoneRoom),
      ...(parsed.data.bookingId ? [adminBookingRoom(parsed.data.bookingId)] : []),
    ];
    for (const room of rooms) {
      void socket.join(room);
    }
    socket.data.filterRooms = rooms;

    return { ok: true };
  }

  /** How many operator sockets are attached to THIS node in `admin:ops`. */
  localOpsSize(): number {
    return this.namespace.adapter.rooms.get(adminOpsRoom())?.size ?? 0;
  }

  /** Relay a Redis-sourced frame to this node's `admin:ops` sockets. */
  emitOps<E extends keyof AdminServerToClientEvents>(
    event: E,
    ...payload: Parameters<AdminServerToClientEvents[E]>
  ): void {
    this.localOperator().to(adminOpsRoom()).emit(event, ...payload);
  }

  /**
   * Relay to the UNION of rooms. Socket.io's chained `.to()` is a union, not an
   * intersection, so a socket in both `admin:ops` and `admin:booking:{id}`
   * receives exactly one copy — which is why the booking bridge can fan out
   * without a dedupe pass on the client.
   */
  emitRooms<E extends keyof AdminServerToClientEvents>(
    rooms: readonly string[],
    event: E,
    ...payload: Parameters<AdminServerToClientEvents[E]>
  ): void {
    if (rooms.length === 0) return;

    let operator = this.localOperator().to(rooms[0]!);
    for (const room of rooms.slice(1)) operator = operator.to(room);
    operator.emit(event, ...payload);
  }

  /**
   * Drops every socket of one admin on THIS node. Called by the revoke bridge on
   * every node (Redis delivers the channel to all subscribers), so the union of
   * those local drops is the cluster-wide disconnect — no adapter-specific
   * cross-node disconnect call to get subtly wrong.
   */
  dropLocalAdmin(adminId: string): number {
    const room = adminUserRoom(adminId);
    const size = this.namespace.adapter.rooms.get(room)?.size ?? 0;
    if (size > 0) this.localOperator().in(room).disconnectSockets(true);
    return size;
  }

  private localOperator(): BroadcastOperator<AdminServerToClientEvents, AdminSocketData> {
    return this.namespace.local;
  }
}
