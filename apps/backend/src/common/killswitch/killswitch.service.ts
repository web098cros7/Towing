import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';
import {
  KILLSWITCH_FORCE_POLLING,
  KILLSWITCH_LONG_DISTANCE,
  KILLSWITCH_PAUSED_ZONES,
  REDIS,
} from '../../redis/redis.constants';

/**
 * §19.8's kill switches — "no deploy" is the entire requirement.
 *
 * WHAT THEY ARE FOR. Each one turns a specific incident from an outage into a
 * degradation an operator chooses: a zone where drivers cannot physically reach
 * anyone (a flood, a closed highway) is paused rather than left offering jobs
 * nobody can take; long-distance offers are the longest commitment and the first
 * thing to stop when supply is thin; forcing REST polling takes load off the
 * gateway when sockets are the thing that is unwell.
 *
 * REDIS, NOT ENV AND NOT A TABLE. An env var needs a rolling restart — minutes,
 * during exactly the incident where seconds matter. A table needs a migration
 * for each new switch and a cache on the hot path. A key is one round trip,
 * takes effect on the next wave, and the next switch is a new key.
 *
 * FAIL OPEN, DELIBERATELY. Every read below swallows its error and answers
 * "not paused". A Redis blip that silently halted all dispatch would be a far
 * worse outage than the one any of these switches exists to contain — and the
 * candidate store is in the same Redis, so a failure here means the search was
 * already about to degrade to PostGIS rather than to nothing.
 *
 * ⚠ The admin FORMS over these are Phase 20 · B3. What ships here is the
 * mechanism plus the `PUT /v1/admin/dispatch-config` route that writes it, so an
 * operator with API access can already reach every switch.
 */
@Injectable()
export class KillSwitchService {
  private readonly logger = new Logger(KillSwitchService.name);

  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  /** Zones where new searches are paused. A SET, so pausing two zones is two members. */
  async pausedZoneIds(): Promise<Set<string>> {
    try {
      return new Set(await this.redis.smembers(KILLSWITCH_PAUSED_ZONES));
    } catch (err) {
      this.warn('paused-zones', err);
      return new Set();
    }
  }

  async isZonePaused(zoneId: string | null): Promise<boolean> {
    if (!zoneId) return false;
    try {
      return (await this.redis.sismember(KILLSWITCH_PAUSED_ZONES, zoneId)) === 1;
    } catch (err) {
      this.warn('paused-zones', err);
      return false;
    }
  }

  async setPausedZones(zoneIds: string[]): Promise<void> {
    // Replaced wholesale rather than diffed: the admin route sends the complete
    // set, and a partial update would make "unpause everything" impossible to
    // express.
    const pipeline = this.redis.multi().del(KILLSWITCH_PAUSED_ZONES);
    if (zoneIds.length > 0) pipeline.sadd(KILLSWITCH_PAUSED_ZONES, ...zoneIds);
    await pipeline.exec();
  }

  /** §3.2's Band C offers, suppressed platform-wide. */
  async isLongDistanceDisabled(): Promise<boolean> {
    return this.flag(KILLSWITCH_LONG_DISTANCE);
  }

  async setLongDistanceDisabled(disabled: boolean): Promise<void> {
    await this.setFlag(KILLSWITCH_LONG_DISTANCE, disabled);
  }

  /**
   * §19.2's "force REST-polling mode".
   *
   * Read by the three ticket routes — customer (`POST /v1/bookings/:id/realtime/ticket`),
   * fleet (`POST /v1/fleet/realtime/ticket`) and driver
   * (`POST /v1/driver/realtime/ticket`) — which refuse with
   * `realtime_unavailable`, the same code `REALTIME_ENABLED=false` produces, so
   * every client already knows how to respond to it. Existing sockets are left
   * connected: dropping them would produce a reconnect storm at the exact
   * moment the gateway is the thing under strain.
   */
  async isPollingForced(): Promise<boolean> {
    return this.flag(KILLSWITCH_FORCE_POLLING);
  }

  async setPollingForced(forced: boolean): Promise<void> {
    await this.setFlag(KILLSWITCH_FORCE_POLLING, forced);
  }

  private async flag(key: string): Promise<boolean> {
    try {
      return (await this.redis.get(key)) === '1';
    } catch (err) {
      this.warn(key, err);
      return false;
    }
  }

  private async setFlag(key: string, on: boolean): Promise<void> {
    if (on) await this.redis.set(key, '1');
    else await this.redis.del(key);
  }

  private warn(key: string, err: unknown): void {
    this.logger.warn(
      `kill switch ${key} unreadable, failing open: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
