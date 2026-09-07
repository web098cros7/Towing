import { Inject, Injectable, Logger } from '@nestjs/common';
import { DRIVER_HASH_TTL_MS, type DriverLocationPing } from '@towing/api-contracts';
import type { Redis } from 'ioredis';
import {
  REDIS,
  bookingSearchLockKey,
  driverGeoKey,
  driverHashKey,
  driverOfferLockKey,
} from '../../redis/redis.constants';

/**
 * The Redis half of §6.1 — the candidate store and the per-driver hot hash.
 *
 * Deliberately free of Nest DI beyond the Redis client, of Postgres, and of any
 * domain rule: what a ping MEANS is `LocationIngestService`'s problem, what it
 * COSTS is this file's. That split is what lets the ordering guarantee below be
 * tested against a real Redis without booting the app.
 */

/** The identity fields cached on the hash at go-online. Empty string ⇒ absent. */
export interface DriverPresenceIdentity {
  zoneId: string;
  /** Null for an independent driver — `drivers.fleet_id` is nullable by design. */
  fleetId: string | null;
  /** Null when the driver operates no fleet truck; then no fleet map can show them. */
  truckId: string | null;
}

export type ApplyPingResult =
  | { status: 'applied'; seq: number; identity: DriverPresenceIdentity }
  /** At or below the stored sequence — a late packet (§11.3). */
  | { status: 'discarded'; seq: number }
  /** No cached identity: never online, or silent for longer than the hash TTL. */
  | { status: 'unknown' };

/**
 * `seq` COMPARE-AND-SET — the pipeline's whole ordering guarantee, in one atom.
 *
 * The obvious implementation is HGET, compare in Node, then HSET. Across N
 * Fargate tasks that is a textbook read-modify-write race: two pings from one
 * handset routinely land on two tasks (a REST post and a socket frame, or just
 * two POSTs over a keep-alive pool), both read the same stored seq, and both
 * write — so the OLDER one can win and the marker jumps backwards. "Late
 * packets discarded server-side" would then hold on one node and not on a
 * cluster, which is the worst kind of guarantee: true in every test and false
 * in production.
 *
 * Everything the write needs happens inside the script, so the accepted path
 * costs exactly one round trip: compare, store the fix, refresh the TTL, GEOADD
 * into the driver's zone set, and hand back the cached identity the fleet
 * fan-out needs.
 *
 * ⚠ THE GEO KEY IS BUILT IN LUA from a prefix, because the zone is read from the
 * hash inside the script and therefore cannot be declared in KEYS. Safe on
 * standalone Redis and on ElastiCache with cluster mode disabled, which is what
 * `Aws/02` specifies. On a real cluster the two keys would need a shared hash
 * tag — recorded here rather than discovered at cutover.
 */
const APPLY_PING_LUA = `
local stored = redis.call('HGET', KEYS[1], 'seq')
local incoming = tonumber(ARGV[1])

if stored and tonumber(stored) >= incoming then
  return {0, stored, '', '', ''}
end

local zoneId = redis.call('HGET', KEYS[1], 'zoneId')
if not zoneId or zoneId == '' then
  return {-1, '', '', '', ''}
end

redis.call('HSET', KEYS[1],
  'seq', ARGV[1],
  'lat', ARGV[2],
  'lng', ARGV[3],
  'at', ARGV[4],
  'headingDeg', ARGV[5],
  'speedKph', ARGV[6],
  'accuracyM', ARGV[7])
redis.call('PEXPIRE', KEYS[1], ARGV[8])
redis.call('GEOADD', ARGV[9] .. zoneId, ARGV[3], ARGV[2], ARGV[10])

local fleetId = redis.call('HGET', KEYS[1], 'fleetId')
local truckId = redis.call('HGET', KEYS[1], 'truckId')
return {1, ARGV[1], fleetId or '', truckId or '', zoneId}
`;

/** What Lua concatenates the zone id onto — `drivers:online:`. */
const GEO_KEY_PREFIX = driverGeoKey('');

type ApplyPingReply = [number, string, string, string, string];

/** ioredis types `defineCommand` additions as `any`; this is the narrow view of ours. */
interface RedisWithApplyPing {
  applyDriverPing: (...args: string[]) => Promise<ApplyPingReply>;
}

@Injectable()
export class PresenceStore {
  private readonly logger = new Logger(PresenceStore.name);

  constructor(@Inject(REDIS) private readonly redis: Redis) {
    // EVALSHA with an automatic EVAL fallback, so the script body crosses the
    // wire once per connection rather than once per ping.
    this.redis.defineCommand('applyDriverPing', { numberOfKeys: 1, lua: APPLY_PING_LUA });
  }

  /**
   * Writes the driver's identity onto the hash. Called at go-online and by the
   * rehydrate path — NEVER by the ping path, which must not pay for a join.
   */
  async putIdentity(
    driverId: string,
    identity: DriverPresenceIdentity & { vehicleClass: string | null; longDistance: boolean },
  ): Promise<void> {
    await this.redis
      .multi()
      .hset(driverHashKey(driverId), {
        zoneId: identity.zoneId,
        fleetId: identity.fleetId ?? '',
        truckId: identity.truckId ?? '',
        vehicleClass: identity.vehicleClass ?? '',
        longDistance: identity.longDistance ? '1' : '0',
      })
      .pexpire(driverHashKey(driverId), DRIVER_HASH_TTL_MS)
      .exec();
  }

  async applyPing(driverId: string, ping: DriverLocationPing): Promise<ApplyPingResult> {
    const [status, storedSeq, fleetId, truckId, zoneId] = await (
      this.redis as unknown as RedisWithApplyPing
    ).applyDriverPing(
      driverHashKey(driverId),
      String(ping.seq),
      String(ping.lat),
      String(ping.lng),
      ping.at,
      ping.headingDeg === undefined ? '' : String(ping.headingDeg),
      ping.speedKph === undefined ? '' : String(ping.speedKph),
      ping.accuracyM === undefined ? '' : String(ping.accuracyM),
      String(DRIVER_HASH_TTL_MS),
      GEO_KEY_PREFIX,
      driverId,
    );

    if (status === 1) {
      return {
        status: 'applied',
        seq: ping.seq,
        identity: {
          zoneId,
          fleetId: fleetId === '' ? null : fleetId,
          truckId: truckId === '' ? null : truckId,
        },
      };
    }

    if (status === 0) return { status: 'discarded', seq: Number(storedSeq) };
    return { status: 'unknown' };
  }

  /**
   * The driver's last hot fix (Phase 18).
   *
   * FROM THE HASH, NOT FROM POSTGRES, and that is why it exists. The database
   * column is refreshed on `LocationFlushService`'s ~30 s cadence, which is a
   * perfectly good answer for a polled tracking screen and a poor one for
   * `EtaService.planRoute`: the route is drawn ONCE, at assignment, from wherever
   * the driver is at that instant, and starting it from a fix half a minute old
   * puts the line — and the first ETA the customer ever sees — a city block
   * behind them.
   *
   * `null` on a miss rather than a throw: the 30-second hash TTL means a driver
   * who went quiet legitimately has no fix, and the caller falls back to the
   * Postgres column or to no route at all.
   */
  async lastFix(
    driverId: string,
  ): Promise<{ lat: number; lng: number; at: string | null } | null> {
    const raw = await this.redis.hmget(driverHashKey(driverId), 'lat', 'lng', 'at');
    const lat = Number(raw[0]);
    const lng = Number(raw[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return { lat, lng, at: raw[2] ?? null };
  }

  /** The stored sequence, so a reconnecting handset can resume above it. */
  async currentSeq(driverId: string): Promise<number> {
    const raw = await this.redis.hget(driverHashKey(driverId), 'seq');
    const seq = Number(raw);
    return Number.isFinite(seq) ? seq : 0;
  }

  /**
   * §6.3's offer lock — take it, or discover someone else already has.
   *
   * `SET NX PX` in one round trip, and the return value is the whole contract:
   * `true` means this caller owns the driver for `ttlMs` and may offer them the
   * job, `false` means another search got there first and this one skips them
   * silently. Anything less atomic — a GET then a SET — lets two searches on two
   * Fargate tasks both read "free" and both offer, handing one driver two
   * countdowns for two customers.
   */
  async takeOfferLock(driverId: string, ttlMs: number): Promise<boolean> {
    const result = await this.redis.set(driverOfferLockKey(driverId), '1', 'PX', ttlMs, 'NX');
    return result === 'OK';
  }

  /**
   * Releases the lock early — on accept, reject, or a revoked offer.
   *
   * Best-effort by design. The TTL is the real guarantee; this only returns the
   * driver to the pool sooner than expiry would have, so a failure costs one
   * driver one offer window rather than correctness. A lock released only by
   * code is a lock a crashed worker holds forever.
   */
  async releaseOfferLock(driverId: string): Promise<void> {
    await this.redis.del(driverOfferLockKey(driverId)).catch(() => undefined);
  }

  /** Which of these drivers already hold an offer. Pipelined — one round trip. */
  async lockedDrivers(driverIds: string[]): Promise<Set<string>> {
    if (driverIds.length === 0) return new Set();

    const pipeline = this.redis.pipeline();
    for (const id of driverIds) pipeline.exists(driverOfferLockKey(id));
    const results = await pipeline.exec();

    const locked = new Set<string>();
    for (const [index, driverId] of driverIds.entries()) {
      const entry = results?.[index];
      if (!entry?.[0] && entry?.[1] === 1) locked.add(driverId);
    }
    return locked;
  }

  /**
   * §6.4's per-booking search lock, so two workers cannot advance one search
   * concurrently and double the offers it makes.
   *
   * Returns `false` rather than waiting: the other holder is running the very
   * wave this caller wanted to run, so queueing behind it would only produce a
   * duplicate wave a moment later.
   */
  async takeSearchLock(bookingId: string, ttlMs: number): Promise<boolean> {
    const result = await this.redis.set(bookingSearchLockKey(bookingId), '1', 'PX', ttlMs, 'NX');
    return result === 'OK';
  }

  async releaseSearchLock(bookingId: string): Promise<void> {
    await this.redis.del(bookingSearchLockKey(bookingId)).catch(() => undefined);
  }

  /**
   * Removes the driver from the candidate store. Both halves matter: dropping
   * the hash alone leaves a GEO member dispatch would still return (members
   * carry no TTL), and dropping the member alone leaves an identity that
   * silently re-admits the driver on their very next ping.
   */
  async evict(driverId: string, zoneId: string | null): Promise<void> {
    const pipeline = this.redis.pipeline();
    if (zoneId) pipeline.zrem(driverGeoKey(zoneId), driverId);
    pipeline.del(driverHashKey(driverId));
    await pipeline.exec();
  }

  /** Only the zone, for an evict whose caller has no driver row in hand. */
  async zoneOf(driverId: string): Promise<string | null> {
    const zoneId = await this.redis.hget(driverHashKey(driverId), 'zoneId');
    return zoneId !== null && zoneId.length > 0 ? zoneId : null;
  }

  /**
   * Candidates within `radiusKm`, nearest first, each with the hash it carries.
   *
   * THE LIVENESS FILTER IS THE CALLER'S. The threshold is admin configuration
   * (`dispatch_config.stale_ping_seconds`, §6.7) and has no business being read
   * — or worse, defaulted — inside a Redis wrapper.
   */
  async searchZone(
    zoneId: string,
    centre: { lat: number; lng: number },
    radiusKm: number,
  ): Promise<Array<{ driverId: string; hash: Record<string, string> }>> {
    const ids = (await this.redis.geosearch(
      driverGeoKey(zoneId),
      'FROMLONLAT',
      centre.lng,
      centre.lat,
      'BYRADIUS',
      radiusKm,
      'km',
      'ASC',
    )) as string[];

    if (ids.length === 0) return [];

    const pipeline = this.redis.pipeline();
    for (const id of ids) pipeline.hgetall(driverHashKey(id));
    const results = await pipeline.exec();

    const out: Array<{ driverId: string; hash: Record<string, string> }> = [];
    const orphans: string[] = [];

    for (const [index, driverId] of ids.entries()) {
      const entry = results?.[index];
      const error = entry?.[0];
      const value = entry?.[1];

      /**
       * A FAILED READ IS NOT AN EXPIRED HASH, and conflating them is a way to
       * delete live supply.
       *
       * This originally treated any non-object as an orphan — including the
       * error case — so a transient Redis failure on one pipelined HGETALL
       * would ZREM that driver out of the candidate store. GEO members carry no
       * TTL and nothing re-adds them until the driver's next ping, so a blip
       * during a busy wave could silently strip drivers from a zone and leave
       * searches finding nobody. Found while investigating a live benchmark run
       * that reported "0 in range" with ten drivers online.
       *
       * An error means "we do not know", and the safe answer to that is to skip
       * the driver for this wave, not to evict them.
       */
      if (error) continue;

      if (typeof value !== 'object' || value === null || Object.keys(value).length === 0) {
        // Member alive, hash genuinely absent: the handset stopped pinging. The
        // same read-repair `PositionsService` performs for trucks, and the only
        // thing that ever prunes a GEO set of a phone that was switched off.
        orphans.push(driverId);
        continue;
      }
      out.push({ driverId, hash: value as Record<string, string> });
    }

    if (orphans.length > 0) void this.readRepair(zoneId, orphans);
    return out;
  }

  private async readRepair(zoneId: string, driverIds: string[]): Promise<void> {
    try {
      await this.redis.zrem(driverGeoKey(zoneId), ...driverIds);
    } catch (err) {
      // Fire and forget: a failure costs one stale candidate the liveness
      // filter drops anyway, never a wrong answer.
      this.logger.debug(`read-repair failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
