import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { driverLocationEventSchema } from '@towing/api-contracts';
import type { Redis } from 'ioredis';
import { ENV, type Env } from '../../config/env';
import { DRIVER_LOCATION_CHANNEL, REDIS } from '../../redis/redis.constants';
import { RealtimeSubscriberService } from '../../realtime/realtime-subscriber.service';
import { haversineMeters } from '../pricing/pricing.math';
import { AssignmentCacheService } from '../tracking/assignment-cache.service';
import { JobExecutionService } from './job-execution.service';

/**
 * §5.1's `assigned → en_route` edge — "driver moves".
 *
 * WHY THIS IS NOT A ROUTE. The four driver endpoints this phase ships are
 * `arrived`, `start`, `complete` and `unable`. There is deliberately no
 * `POST /jobs/:id/en-route`, because a driver does not tap "I have set off" —
 * they set off. Asking them to announce it would mean a status that is wrong
 * whenever somebody forgets, on a screen they are looking at while driving.
 *
 * So the transition is derived from the fact that produces it: the driver's own
 * position moving away from where they accepted. That fact already travels on
 * `location:driver` every three seconds, and this is a third subscriber to it —
 * `RealtimeSubscriberService` holds a LIST of handlers per channel, which is the
 * Phase 5 fix this relies on.
 *
 * WHY A SEPARATE SUBSCRIBER RATHER THAN A HOOK IN `TrackingRelayService`. That
 * relay gates on `localRoomSize` — a node with nobody watching a booking does no
 * work for its ping stream at all, which is what makes it scale. This must NOT
 * be gated that way: a customer who backgrounded the app has no socket, and the
 * status still has to move (it is what their push notification says, and what
 * the §19.2 poll will report). Two consumers with genuinely different gating
 * conditions are two consumers.
 *
 * THE THRESHOLD EXISTS BECAUSE A FIX IS NOT MOVEMENT. A phone on a dashboard
 * drifts tens of metres while parked, and a customer told "your driver is on the
 * way" by GPS jitter then watches a stationary marker — which is worse than
 * being told nothing. `EN_ROUTE_METERS` is comfortably outside that drift and
 * comfortably inside "has pulled out of the yard".
 */

/**
 * How far from the accept position counts as under way.
 *
 * 150 m: larger than any plausible stationary GPS wander (the accuracy halo
 * threshold is 50 m, and drift is bounded by roughly twice that), small enough
 * that a driver two streets away has already tripped it.
 */
const EN_ROUTE_METERS = 150;

@Injectable()
export class EnRouteWatcher implements OnModuleInit {
  private readonly logger = new Logger(EnRouteWatcher.name);

  constructor(
    private readonly subscriber: RealtimeSubscriberService,
    private readonly assignments: AssignmentCacheService,
    private readonly jobs: JobExecutionService,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async onModuleInit(): Promise<void> {
    if (!this.env.REALTIME_ENABLED) {
      // §19.2. Without the ping stream there is no movement to observe, so the
      // booking sits at `assigned` until the driver marks arrival — which is a
      // legitimate, if less informative, run through §5.2. Said out loud rather
      // than left as a silent behaviour difference between two deployments.
      this.logger.warn('REALTIME_ENABLED=false — en_route will not be detected from movement');
      return;
    }

    await this.subscriber.subscribe(DRIVER_LOCATION_CHANNEL, (payload) => {
      void this.onPing(payload);
    });
  }

  private async onPing(raw: unknown): Promise<void> {
    const parsed = driverLocationEventSchema.safeParse(raw);
    if (!parsed.success) return; // counted by the tracking relay; not twice.

    const ping = parsed.data;

    try {
      const assignment = await this.assignments.forDriver(ping.driverId);
      // Only `assigned` can become `en_route`. This is the cheap gate and it
      // rejects the overwhelming majority of pings — every idle driver, and
      // every driver already past this point in a trip.
      if (!assignment || assignment.status !== 'assigned') return;

      const anchor = await this.anchor(assignment.bookingId, ping);
      if (!anchor) return;

      if (haversineMeters({ lat: ping.lat, lng: ping.lng }, anchor) < EN_ROUTE_METERS) return;

      await this.jobs.markEnRoute(assignment.bookingId, ping.driverId);
      await this.clearAnchor(assignment.bookingId);
    } catch (error) {
      this.logger.warn(`en_route detection failed for ${ping.driverId}: ${String(error)}`);
    }
  }

  /**
   * Where the driver was when this booking was assigned to them.
   *
   * REMEMBERED IN REDIS ON FIRST SIGHT, not read from the booking. The booking
   * row has no "position at assignment" column and adding one would be a column
   * written once and read once per trip; the route's own start point is the
   * closest stored equivalent, but a Directions failure legitimately leaves it
   * null and the detector must still work.
   *
   * So the first ping we see for an `assigned` booking BECOMES the anchor. That
   * is very slightly later than the assignment itself — up to three seconds —
   * which if anything makes the detector more conservative, and it needs no
   * schema.
   *
   * Set NX so the anchor is written once per booking and every task agrees on it.
   */
  private async anchor(
    bookingId: string,
    ping: { lat: number; lng: number },
  ): Promise<{ lat: number; lng: number } | null> {
    const key = `enroute:anchor:${bookingId}`;

    try {
      const stored = await this.redis.get(key);
      if (stored) {
        const parts = stored.split(',');
        const lat = Number(parts[0]);
        const lng = Number(parts[1]);
        if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng };
      }

      // First ping for this booking on any task. Two hours is longer than a
      // search-plus-approach and short enough not to accumulate.
      await this.redis.set(key, `${ping.lat},${ping.lng}`, 'EX', 2 * 60 * 60, 'NX');
      return null;
    } catch {
      // Redis down: no anchor, so no detection. Deliberately NOT falling back to
      // Postgres — the booking row has no assignment position, and the nearest
      // stand-in (the route's first vertex) is null exactly when Directions also
      // failed. The consequence of doing nothing is that the customer sees
      // `assigned` until the driver marks arrival, which is a less informative
      // but entirely correct run through §5.2. Inventing an anchor would be
      // worse: a wrong one fires `en_route` on the first ping.
      return null;
    }
  }

  private async clearAnchor(bookingId: string): Promise<void> {
    try {
      await this.redis.del(`enroute:anchor:${bookingId}`);
    } catch {
      /* the TTL will get it */
    }
  }
}
