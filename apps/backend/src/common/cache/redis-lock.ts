import { Inject, Injectable, Logger } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS } from '../../redis/redis.constants';

/**
 * A `SET NX PX` mutex, general enough for any module to use.
 *
 * WHY THIS EXISTS AT ALL. Two `SET NX PX` locks already ship —
 * `PresenceStore.takeOfferLock` and `takeSearchLock` — but both live on the
 * DRIVER-PRESENCE store, which is §6.1's candidate index and belongs to
 * dispatch. Phase 19 needs to serialise payment settlement, and money taking a
 * dependency on the presence store to do it would couple the two subsystems for
 * no reason beyond "there was already a Redis client over there".
 *
 * THE RETURN VALUE IS THE WHOLE CONTRACT, and it is the `takeSearchLock` shape:
 * `null` means somebody else holds the lock, and the caller must then do
 * NOTHING — not wait, not retry, not queue. The holder is running the very work
 * this caller wanted to run, so waiting for it would only produce a second
 * worker with a stale read of a job that is already done.
 *
 * THE TTL IS THE SAFETY PROPERTY, as `driverOfferLockKey`'s docstring says of
 * its own: a lock released only by code is a lock a crashed worker holds
 * forever. Expiry bounds the damage to one duplicated attempt, which the
 * database-level defences then absorb.
 */
@Injectable()
export class RedisLock {
  private readonly logger = new Logger(RedisLock.name);

  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  /**
   * Runs `fn` while holding `key`, then releases it.
   *
   * `required: false` is for a path that must survive Redis being down. §19.2's
   * ladder never says "Redis degraded" means "payments stop" — so the capture
   * route proceeds unlocked rather than failing, and relies on the defences
   * that are database facts rather than cache facts: the partial unique index
   * on captured payments, the state machine's `FOR UPDATE` legality check, and
   * the ledger's own idempotency keys. That is what makes this lock an
   * OPTIMISATION (it stops wasted vendor calls and log noise) rather than a
   * correctness dependency.
   *
   * `required: true` is for a caller with no external forcing function — the
   * scheduled sweep. If Redis is down it skips the tick entirely; there is
   * another in five minutes, and a sweep is not worth a risk the route would
   * take.
   */
  async withLock<T>(
    key: string,
    ttlMs: number,
    options: { required: boolean },
    fn: () => Promise<T>,
  ): Promise<T | null> {
    let held = false;

    try {
      held = (await this.redis.set(key, '1', 'PX', ttlMs, 'NX')) === 'OK';
    } catch (error) {
      if (options.required) {
        this.logger.warn(`lock ${key} unavailable (${String(error)}) — skipping`);
        return null;
      }
      // Redis is down and this caller said it must not stop. Proceed unlocked.
      this.logger.warn(`lock ${key} unavailable (${String(error)}) — proceeding unlocked`);
      return fn();
    }

    if (!held) {
      // Somebody else is doing exactly this work, right now. Doing nothing is
      // the correct behaviour, not a degraded one.
      return null;
    }

    try {
      return await fn();
    } finally {
      // Best-effort. A failed release is harmless — the TTL is what actually
      // guarantees the lock goes away.
      await this.redis.del(key).catch(() => undefined);
    }
  }
}
