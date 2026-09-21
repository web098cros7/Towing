import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import {
  ADMIN_REALTIME_EVENT,
  driverLocationEventSchema,
  type AdminDriverPosition,
} from '@towing/api-contracts';
import { ENV, type Env } from '../config/env';
import { DRIVER_LOCATION_CHANNEL } from '../redis/redis.constants';
import { AdminGateway } from './admin.gateway';
import { RealtimeSubscriberService } from './realtime-subscriber.service';

/** The guide's ceiling: one frame carries at most this many positions. */
const CHUNK_SIZE = 500;

/**
 * `location:driver` → `location:update` on `/admin` (W1, §3.4).
 *
 * Three properties the guide names, all of which are here rather than in the
 * gateway:
 *
 *  - **Batched** on the existing flush interval — one frame per driver per
 *    window, so 2,000 drivers pinging every 3 s cost ~1 frame/second per node,
 *    not ~670 messages/second.
 *  - **Room-gated with a skip**: a node whose `admin:ops` room is empty clears
 *    its buffer and does no serialisation at all. At scale most nodes have no
 *    operator attached, and this is what makes that free.
 *  - **Chunked** at 500 positions per frame, so one flush after a cold start
 *    cannot build a multi-megabyte packet.
 *
 * W4 adds zone routing: when an operator filters the map to zones, their
 * socket joins those `admin:zone:{id}` rooms and leaves the broadcast (the
 * gateway marks it in `ZONE_FILTERED_ROOM`); this relay then emits each zone's
 * group to its room and the full batch to everyone else — so the filter
 * reduces what is SENT, and no socket receives any position twice (groups go
 * to zone rooms only, the broadcast excludes filtering sockets). When nobody
 * filters, the original single-frame path is kept.
 */
@Injectable()
export class AdminLocationRelay implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AdminLocationRelay.name);
  /** driverId → newest position seen this window. */
  private readonly pending = new Map<string, AdminDriverPosition>();
  private timer?: NodeJS.Timeout;
  private destroyed = false;
  private malformed = 0;

  constructor(
    private readonly subscriber: RealtimeSubscriberService,
    private readonly gateway: AdminGateway,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async onModuleInit(): Promise<void> {
    if (!this.env.REALTIME_ENABLED) {
      this.logger.warn('REALTIME_ENABLED=false — admin location relay not installed');
      return;
    }

    await this.subscriber.subscribe(DRIVER_LOCATION_CHANNEL, (payload) =>
      this.onDriverPing(payload),
    );
    // unref: a stray interval must never keep a test worker or a draining ECS
    // task alive.
    this.timer = setInterval(() => this.flush(), this.env.REALTIME_FLUSH_MS);
    this.timer.unref();
  }

  private onDriverPing(payload: unknown): void {
    const parsed = driverLocationEventSchema.safeParse(payload);
    if (!parsed.success) {
      this.malformed += 1;
      if (this.malformed % 100 === 1) {
        this.logger.warn(`discarded ${this.malformed} malformed driver ping(s)`);
      }
      return;
    }

    const event = parsed.data;
    const next: AdminDriverPosition = {
      driverId: event.driverId,
      zoneId: event.zoneId,
      lat: event.lat,
      lng: event.lng,
      headingDeg: event.headingDeg,
      speedKph: event.speedKph,
      at: event.at,
    };

    const existing = this.pending.get(event.driverId);
    // Out-of-order pings are discarded server-side (§11.3): a delayed packet
    // arriving after a newer one reads to the operator as the driver reversing.
    if (existing && Date.parse(existing.at) > Date.parse(next.at)) return;

    this.pending.set(event.driverId, next);
  }

  private flush(): void {
    if (this.destroyed) return;

    try {
      // NOBODY WATCHING THIS NODE ⇒ NO WORK. Not even serialisation: the buffer
      // is dropped wholesale and rebuilt from the next ping onward.
      if (this.gateway.localOpsSize() === 0) {
        this.pending.clear();
        return;
      }
      if (this.pending.size === 0) return;

      const positions = [...this.pending.values()];
      this.pending.clear();

      const emittedAt = new Date().toISOString();

      // Fast path: no operator is filtering by zone, so the zone split below
      // would only buy grouping work with nothing to route to. This is W1's
      // single-batch behaviour, byte for byte.
      if (this.gateway.localFilteredSize() === 0) {
        for (let offset = 0; offset < positions.length; offset += CHUNK_SIZE) {
          this.gateway.emitOps(ADMIN_REALTIME_EVENT.LOCATION_UPDATE, {
            positions: positions.slice(offset, offset + CHUNK_SIZE),
            emittedAt,
          });
        }
        return;
      }

      // W4 zone routing. Exactly-once delivery, by construction:
      //  - a zone group goes to `admin:zone:{id}` — only sockets that joined
      //    that room (and only that room carries the group);
      //  - the full batch goes to `admin:ops` EXCEPT the filtered sockets, so
      //    a filtering operator never sees it and an unfiltered one sees it
      //    once;
      //  - a position with no zone belongs to no zone room and reaches only
      //    the broadcast. The driver channel's schema currently requires a
      //    zone (the position type is nullable for the snapshot's benefit), so
      //    this branch is defence, not a state the producer emits today.
      const byZone = new Map<string, AdminDriverPosition[]>();
      for (const position of positions) {
        if (!position.zoneId) continue;
        const group = byZone.get(position.zoneId);
        if (group) group.push(position);
        else byZone.set(position.zoneId, [position]);
      }

      for (const [zoneId, group] of byZone) {
        for (let offset = 0; offset < group.length; offset += CHUNK_SIZE) {
          this.gateway.emitZone(zoneId, ADMIN_REALTIME_EVENT.LOCATION_UPDATE, {
            positions: group.slice(offset, offset + CHUNK_SIZE),
            emittedAt,
          });
        }
      }

      for (let offset = 0; offset < positions.length; offset += CHUNK_SIZE) {
        this.gateway.emitOpsUnfiltered(ADMIN_REALTIME_EVENT.LOCATION_UPDATE, {
          positions: positions.slice(offset, offset + CHUNK_SIZE),
          emittedAt,
        });
      }
    } catch (err) {
      // Never rethrow from a timer: an unhandled rejection here takes down the
      // process (and, in vitest, fails an unrelated suite).
      this.logger.error(`admin flush failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  onModuleDestroy(): void {
    this.destroyed = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }
}
