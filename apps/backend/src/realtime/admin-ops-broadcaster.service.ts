import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import type { OpsAdminBadgesEvent, OpsAdminMetricsEvent } from '@towing/api-contracts';
import type { Redis } from 'ioredis';
import { CacheService } from '../common/cache/cache.service';
import { ENV, type Env } from '../config/env';
import { AdminOpsService } from '../modules/admin-ops/admin-ops.service';
import {
  OPS_EVENTS_CHANNEL,
  REDIS,
  adminOpsBadgesCacheKey,
  adminOpsDashboardCacheKey,
  adminOpsMetricsLockKey,
} from '../redis/redis.constants';
import { RealtimeSubscriberService } from './realtime-subscriber.service';

/** The guide's tick: presence changes emit no domain event, so a timer must catch them. */
const TICK_MS = 10_000;

/**
 * The admin metrics/badge broadcaster (W3, §3.4) — the fleet
 * `MetricsBroadcasterService`'s pattern, platform-wide instead of per-fleet.
 *
 * Debounces `ops:events` plus a 10 s tick (an operator approving a driver, or a
 * driver going online, publishes no booking event), guarded by a `SET NX PX`
 * lock so one node recomputes and every node relays the identical payload.
 *
 * The computed payload goes onto `ops:events` itself as `ops_metrics` /
 * `ops_badges` — the guide's producer table lists this service there, and one
 * channel keeps fan-out `AdminBridgeService`'s job rather than giving every
 * node a second subscription to keep in sync. The bridge ignores those two
 * kinds on their way to sockets, so this service must ignore them too, or a
 * publish would schedule the next publish.
 *
 * WHY A PAYLOAD AND NOT AN INVALIDATE-PING: the console patches its cached
 * query with `setQueryData`, and a bare "go refetch" would have to bust the 10 s
 * cache first or the console would refetch and render identical numbers — an
 * update that visibly does nothing (the fleet broadcaster's reasoning, verbatim).
 *
 * WHY THE LOCK IS A COST GUARD, NOT A CORRECTNESS GUARD: every node sees every
 * event, so without it every node recomputes and publishes duplicates.
 * Duplicates are harmless to `setQueryData`, and a node that dies holding the
 * lock costs one skipped push, covered by the console's poll and resync.
 * Nothing here is allowed to *depend* on the lock.
 */
@Injectable()
export class AdminOpsBroadcasterService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AdminOpsBroadcasterService.name);
  private timer?: NodeJS.Timeout;
  private debounce?: NodeJS.Timeout;
  private destroyed = false;

  constructor(
    private readonly subscriber: RealtimeSubscriberService,
    private readonly adminOps: AdminOpsService,
    private readonly cache: CacheService,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async onModuleInit(): Promise<void> {
    if (!this.env.REALTIME_ENABLED) return;
    await this.subscriber.subscribe(OPS_EVENTS_CHANNEL, (payload) => this.onOpsEvent(payload));
    // unref: a stray interval must never keep a test worker or a draining ECS
    // task alive.
    this.timer = setInterval(() => void this.recomputeAndPublish(), TICK_MS);
    this.timer.unref();
  }

  private onOpsEvent(payload: unknown): void {
    if (this.destroyed) return;
    if (typeof payload !== 'object' || payload === null) return;
    const kind = (payload as { kind?: unknown }).kind;
    // Loop guard: our own two kinds are relay traffic, not input.
    if (kind !== 'booking_status' && kind !== 'booking_created') return;

    if (this.debounce) clearTimeout(this.debounce);
    this.debounce = setTimeout(() => {
      this.debounce = undefined;
      void this.recomputeAndPublish();
    }, this.env.REALTIME_METRICS_DEBOUNCE_MS);
    this.debounce.unref();
  }

  private async recomputeAndPublish(): Promise<void> {
    // Re-checked here, not just at schedule time: the app can be torn down
    // during the debounce window, and this callback would then query a closed
    // postgres pool and surface as an unhandled rejection.
    if (this.destroyed) return;

    try {
      const won = await this.redis.set(
        adminOpsMetricsLockKey,
        'held',
        'PX',
        this.env.REALTIME_METRICS_DEBOUNCE_MS,
        'NX',
      );
      if (won === null) return;

      // Invalidate, then recompute THROUGH the cached getters: that both
      // computes fresh numbers and repopulates the keys the REST endpoints
      // read, so the pushed payload and the next fetch cannot disagree.
      await this.cache.invalidate(adminOpsDashboardCacheKey);
      await this.cache.invalidate(adminOpsBadgesCacheKey);

      const dashboard = await this.adminOps.dashboard();
      const badges = await this.adminOps.badges();
      if (this.destroyed) return;

      const metrics: OpsAdminMetricsEvent = {
        kind: 'ops_metrics',
        kpis: dashboard.kpis,
        at: dashboard.at,
      };
      const badgeEvent: OpsAdminBadgesEvent = {
        kind: 'ops_badges',
        badges: badges.badges,
        at: badges.at,
      };
      await this.redis.publish(OPS_EVENTS_CHANNEL, JSON.stringify(metrics));
      await this.redis.publish(OPS_EVENTS_CHANNEL, JSON.stringify(badgeEvent));
    } catch (err) {
      // Debug, not error: during shutdown this legitimately races a closing
      // pool, and it must never rethrow out of a timer callback.
      this.logger.debug(
        `admin ops recompute failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  onModuleDestroy(): void {
    this.destroyed = true;
    if (this.timer) clearInterval(this.timer);
    if (this.debounce) clearTimeout(this.debounce);
    this.timer = undefined;
    this.debounce = undefined;
  }
}
