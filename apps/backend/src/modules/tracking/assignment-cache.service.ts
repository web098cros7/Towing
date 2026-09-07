import { Inject, Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { REDIS } from '../../redis/redis.constants';
import { TrackingRepo } from './tracking.repo';

/**
 * "Is this driver on a job, and which one?" — cached.
 *
 * WHY IT IS ITS OWN SERVICE RATHER THAN A PRIVATE METHOD. Two consumers ask the
 * same question of the same ping stream at the same 3-second cadence:
 * `TrackingRelayService`, deciding whether to fan a position out to a customer,
 * and `EnRouteWatcher`, deciding whether the driver has started moving. A
 * private cache on either one means the other pays for a database read, and the
 * two would then also disagree for up to a TTL about what a driver is doing.
 *
 * WITHOUT THE CACHE THIS IS A DATABASE READ EVERY THREE SECONDS PER ONLINE
 * DRIVER, on a query whose answer is constant for the length of a trip.
 *
 * THE NEGATIVE IS CACHED TOO, and that is the half that actually matters. Most
 * online drivers are idle at any moment, so "on no job" is the overwhelmingly
 * common answer — and an uncached negative is the one that would hit Postgres
 * hardest, because it is the one that never gets to stop asking.
 *
 * The TTL is a backstop, not the mechanism: `JobExecutionService` invalidates
 * explicitly at assign, complete, cancel and `unable`, which are the only four
 * moments the answer changes.
 */

export interface DriverAssignment {
  bookingId: string;
  status: string;
}

/** The sentinel for "on no job" — a cached negative, distinct from a cache miss. */
const IDLE = '-';

/**
 * Short, because the invalidations above are what keep this correct and this is
 * only the safety net. Fifteen seconds is also §6.1's staleness window, which
 * keeps the system's two liveness clocks in the same order of magnitude.
 */
const TTL_SECONDS = 15;

@Injectable()
export class AssignmentCacheService {
  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    private readonly repo: TrackingRepo,
  ) {}

  private static key(driverId: string): string {
    return `track:assign:${driverId}`;
  }

  async forDriver(driverId: string): Promise<DriverAssignment | null> {
    const key = AssignmentCacheService.key(driverId);

    try {
      const cached = await this.redis.get(key);
      if (cached === IDLE) return null;
      if (cached) {
        const [bookingId, status] = cached.split('|');
        if (bookingId && status) return { bookingId, status };
      }
    } catch {
      // Redis down: fall through to Postgres. Slower, still correct — and
      // tracking is not the place to fail hard over a cache.
    }

    const row = await this.repo.activeBookingForDriver(driverId);
    const value = row ? `${row.bookingId}|${row.status}` : IDLE;

    try {
      await this.redis.set(key, value, 'EX', TTL_SECONDS);
    } catch {
      /* a cache write failure costs a query, nothing more */
    }

    return row ? { bookingId: row.bookingId, status: row.status } : null;
  }

  /**
   * Called at every §5.2 transition. A stale entry here would keep fanning a
   * completed trip's pings to a room the customer has left, and — worse — would
   * hold the wrong `status`, which is what decides whether the ETA measures to
   * the pickup or to the drop.
   */
  async invalidate(driverId: string): Promise<void> {
    try {
      await this.redis.del(AssignmentCacheService.key(driverId));
    } catch {
      /* the TTL will get it within fifteen seconds */
    }
  }
}
