import { createHash } from 'node:crypto';
import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import {
  ADMIN_REALTIME_EVENT,
  opsEventSchema,
  adminBookingRoom,
  adminOpsRoom,
  adminZoneRoom,
  type AdminActivityItem,
  type JobStatus,
} from '@towing/api-contracts';
import type { Redis } from 'ioredis';
import {
  ADMIN_REVOKE_CHANNEL,
  OPS_EVENTS_CHANNEL,
  REDIS,
  adminOpsActivityKey,
  adminOpsActivitySeenKey,
} from '../redis/redis.constants';
import { AdminGateway } from './admin.gateway';
import { RealtimeSubscriberService } from './realtime-subscriber.service';

/** The feed's published depth (§W3: "the last 50 `ops:events`"). */
const ACTIVITY_LENGTH = 50;

/**
 * Redis → `/admin` bridges that are not positions (W1, §3.4).
 *
 * W1 turned every `booking_status` into a `booking:status` frame on the UNION
 * of `admin:ops`, `admin:zone:{zoneId}` and `admin:booking:{bookingId}` — one
 * copy per socket however many of those it is in (socket.io's chained `.to()`
 * is a union). W3 widens the fan-out to all four `ops:events` kinds:
 *
 *  - `booking_status` → the frame above, unchanged.
 *  - `booking_created` → the same frame with `status: 'searching'`. Creation is
 *    not a transition (§5.1 has no edge into `searching`), so no synthetic
 *    from/to is invented — the frame says what a consumer needs: a new booking
 *    entered `searching` (the union's own documented trick).
 *  - `ops_metrics` / `ops_badges` → `ops:metrics` / `ops:badges` frames to
 *    `admin:ops`. The broadcaster published them onto the SAME channel, so
 *    every node relays the identical payload with `.local` and no node doubles
 *    the work of computing it.
 *
 * It also APPENDS the two domain kinds to the activity list (newest first,
 * capped at 50) — under an NX marker so the N nodes that all receive the
 * message append it once, not N times.
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
    @Inject(REDIS) private readonly redis: Redis,
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

    const event = parsed.data;
    switch (event.kind) {
      case 'booking_status': {
        this.emitBookingFrame(event.bookingId, event.zoneId, event.driverId, event.to, event.at);
        void this.appendActivity({
          id: `booking_status:${event.bookingId}:${event.at}`,
          kind: 'booking_status',
          at: event.at,
          bookingId: event.bookingId,
          zoneId: event.zoneId,
          status: event.to,
          sosStatus: null,
          scheduledAt: null,
          action: null,
          subjectType: null,
          subjectId: null,
          adminId: null,
        });
        break;
      }
      case 'booking_created': {
        this.emitBookingFrame(event.bookingId, event.zoneId, null, 'searching', event.at);
        void this.appendActivity({
          id: `booking_created:${event.bookingId}:${event.at}`,
          kind: 'booking_created',
          at: event.at,
          bookingId: event.bookingId,
          zoneId: event.zoneId,
          status: 'searching',
          sosStatus: null,
          scheduledAt: event.scheduledAt,
          action: null,
          subjectType: null,
          subjectId: null,
          adminId: null,
        });
        break;
      }
      case 'ops_metrics': {
        this.gateway.emitOps(ADMIN_REALTIME_EVENT.OPS_METRICS, {
          kpis: event.kpis,
          at: event.at,
        });
        break;
      }
      case 'ops_badges': {
        this.gateway.emitOps(ADMIN_REALTIME_EVENT.OPS_BADGES, {
          badges: event.badges,
          at: event.at,
        });
        break;
      }
      case 'sos_alert': {
        // To EVERY admin socket, not a zone-filtered room: a person in
        // trouble outranks whatever map filter an operator has open.
        this.gateway.emitOps(ADMIN_REALTIME_EVENT.SOS_ALERT, {
          alertId: event.alertId,
          subjectType: event.subjectType,
          subjectId: event.subjectId,
          bookingId: event.bookingId,
          lat: event.lat,
          lng: event.lng,
          status: event.status,
          at: event.at,
          duplicate: event.duplicate,
        });
        void this.appendActivity({
          id: `sos_alert:${event.alertId}:${event.at}`,
          kind: 'sos_alert',
          at: event.at,
          bookingId: event.bookingId,
          zoneId: null,
          status: null,
          sosStatus: event.status,
          scheduledAt: null,
          action: 'sos.triggered',
          subjectType: event.subjectType,
          subjectId: event.subjectId,
          adminId: null,
        });
        break;
      }
    }
  }

  /** One frame, union of the three rooms — a socket in two of them still gets one copy. */
  private emitBookingFrame(
    bookingId: string,
    zoneId: string | null,
    driverId: string | null,
    status: JobStatus,
    at: string,
  ): void {
    const rooms = [
      adminOpsRoom(),
      ...(zoneId ? [adminZoneRoom(zoneId)] : []),
      adminBookingRoom(bookingId),
    ];
    this.gateway.emitRooms(rooms, ADMIN_REALTIME_EVENT.BOOKING_STATUS, {
      bookingId,
      status,
      zoneId,
      driverId,
      at,
    });
  }

  /**
   * Append one domain event to the activity list. The NX marker is what makes
   * this exactly-once: Redis pub/sub delivers the message to every node, and
   * the one that wins `SET NX` pushes the row. Failures are debug-logged and
   * swallowed — the feed's REST backfill covers a Redis blip, and a missed feed
   * row must never surface as an error on an unrelated request path.
   */
  private async appendActivity(item: AdminActivityItem): Promise<void> {
    try {
      const hash = createHash('sha1').update(item.id).digest('hex');
      const first = await this.redis.set(adminOpsActivitySeenKey(hash), '1', 'PX', 60_000, 'NX');
      if (first === null) return;

      const pipeline = this.redis.pipeline();
      pipeline.lpush(adminOpsActivityKey, JSON.stringify(item));
      pipeline.ltrim(adminOpsActivityKey, 0, ACTIVITY_LENGTH - 1);
      await pipeline.exec();
    } catch (err) {
      this.logger.debug(
        `activity append failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private onAdminRevoke(payload: unknown): void {
    if (typeof payload !== 'object' || payload === null) return;
    const adminId = (payload as { adminId?: unknown }).adminId;
    if (typeof adminId !== 'string' || adminId.length === 0) return;

    const dropped = this.gateway.dropLocalAdmin(adminId);
    if (dropped > 0) {
      this.logger.log(
        `admin:revoke — dropped ${dropped} socket(s) of admin ${adminId} on this node`,
      );
    }
  }
}
