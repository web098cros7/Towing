import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import {
  ADMIN_REALTIME_EVENT,
  opsEventSchema,
  adminBookingRoom,
  adminOpsRoom,
  adminZoneRoom,
} from '@towing/api-contracts';
import { ADMIN_REVOKE_CHANNEL, OPS_EVENTS_CHANNEL } from '../redis/redis.constants';
import { AdminGateway } from './admin.gateway';
import { RealtimeSubscriberService } from './realtime-subscriber.service';

/**
 * Redis → `/admin` bridges that are not positions (W1, §3.4).
 *
 * `ops:events` (A18) already carries every booking status change platform-wide;
 * this turns each one into a `booking:status` frame on the UNION of
 * `admin:ops`, `admin:zone:{zoneId}` and `admin:booking:{bookingId}` — one copy
 * per socket however many of those it is in (socket.io's chained `.to()` is a
 * union).
 *
 * `admin:revoke` (W2's demote/deactivate) is consumed HERE rather than in the
 * gateway so the gateway owns only its namespace. Every node consumes the
 * channel — Redis delivers to all subscribers — so each node dropping its own
 * sockets in `admin:user:{id}` IS the cluster-wide disconnect, without an
 * adapter-specific cross-node call.
 */
@Injectable()
export class AdminBridgeService implements OnModuleInit {
  private readonly logger = new Logger(AdminBridgeService.name);
  private malformed = 0;

  constructor(
    private readonly subscriber: RealtimeSubscriberService,
    private readonly gateway: AdminGateway,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.subscriber.subscribe(OPS_EVENTS_CHANNEL, (payload) => this.onOpsEvent(payload));
    await this.subscriber.subscribe(ADMIN_REVOKE_CHANNEL, (payload) => this.onAdminRevoke(payload));
  }

  private onOpsEvent(payload: unknown): void {
    const parsed = opsEventSchema.safeParse(payload);
    if (!parsed.success) {
      this.malformed += 1;
      if (this.malformed % 100 === 1) {
        this.logger.warn(`discarded ${this.malformed} malformed ops event(s)`);
      }
      return;
    }

    // `booking_created` has no frame yet: nothing in W1 renders it (the
    // activity feed is W3). Emitting a frame no client parses would be noise.
    if (parsed.data.kind !== 'booking_status') return;

    const event = parsed.data;
    const rooms = [
      adminOpsRoom(),
      ...(event.zoneId ? [adminZoneRoom(event.zoneId)] : []),
      adminBookingRoom(event.bookingId),
    ];

    this.gateway.emitRooms(rooms, ADMIN_REALTIME_EVENT.BOOKING_STATUS, {
      bookingId: event.bookingId,
      status: event.to,
      zoneId: event.zoneId,
      driverId: event.driverId,
      at: event.at,
    });
  }

  private onAdminRevoke(payload: unknown): void {
    if (typeof payload !== 'object' || payload === null) return;
    const adminId = (payload as { adminId?: unknown }).adminId;
    if (typeof adminId !== 'string' || adminId.length === 0) return;

    const dropped = this.gateway.dropLocalAdmin(adminId);
    if (dropped > 0) {
      this.logger.log(`admin:revoke — dropped ${dropped} socket(s) of admin ${adminId} on this node`);
    }
  }
}
