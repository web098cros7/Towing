import { Inject, Injectable } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import { ENV, type Env } from '../../config/env';
import type { DatabaseExecutor } from '../../db/db.module';
import { bookings } from '../../db/schema';
import { REDIS } from '../../redis/redis.constants';
import { digest, digestsMatch, generateOtp } from '../auth/otp.util';

/**
 * The §5.1 booking OTP — minted at confirm, handed to the driver at pickup.
 *
 * STORED AS A DIGEST, NEVER AS THE CODE. `bookings.booking_otp` was plain
 * `text` holding the live code until migration 0012. Phase 13 declined to route
 * OTPs through the notification spine specifically because writing a live code
 * into a table with no TTL "reverses the hash-at-rest posture
 * `login_challenges.code_hash` has" — a plaintext code sitting on a booking row
 * for the life of the trip was the same mistake, one table over.
 *
 * WHICH CREATES A PROBLEM THIS CLASS EXISTS TO SOLVE. §9.1.7 wants the code
 * shown on the tracking screen, and a digest cannot be un-hashed — so a naive
 * implementation must mint a NEW code on every read. That is wrong in the one
 * moment that matters: the customer reads a code aloud, their screen refetches
 * in the background, and the driver types a code the server has already
 * replaced.
 *
 * So the durable store stays hashed and the readable code lives in Redis for
 * exactly the length of its window. Re-reading inside the window returns the
 * same code; after it, a fresh one with a fresh clock. Redis already holds
 * sessions and idempotency records, the entry expires on its own, and nothing
 * survives in Postgres but the digest.
 *
 * THE 30-MINUTE WINDOW RUNS FROM RETRIEVAL, NOT FROM CONFIRM. §5.1 mints at
 * confirm and §9.1.7 says "one-time, expires 30 min" and "never visible before
 * assignment" — but a search plus a cross-city drive can outrun thirty minutes,
 * and a customer holding a dead code at the handover has no way out except
 * cancelling a booking they still want. Minted at confirm, unreadable until
 * `assigned`, and the first read starts the clock.
 */
@Injectable()
export class BookingOtpService {
  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  /** §9.1.7's "expires 30 min". */
  static readonly WINDOW_MS = 30 * 60 * 1000;

  private static key(bookingId: string): string {
    return `booking:otp:${bookingId}`;
  }

  /**
   * A code for a brand-new booking. Returns the columns to write, never the
   * code — nothing may show it before assignment (§9.1.7), so the caller has no
   * legitimate use for it.
   */
  mintForCreate(): { bookingOtpHash: string; otpExpiresAt: Date; otpAttempts: number } {
    return {
      bookingOtpHash: digest(generateOtp()),
      // Already expired: the code is unreadable until assignment, and the first
      // read is what starts its window.
      otpExpiresAt: new Date(0),
      otpAttempts: 0,
    };
  }

  /**
   * The code for `GET /bookings/:id/otp`.
   *
   * Returns the live code inside its window, or mints and stores a new one.
   * This is the only place a booking OTP is ever readable, and only by the
   * booking's owner.
   */
  async issue(
    db: DatabaseExecutor,
    bookingId: string,
    now = new Date(),
  ): Promise<{ code: string; expiresAt: Date; locked: boolean }> {
    const [row] = await db
      .select({ expiresAt: bookings.otpExpiresAt, attempts: bookings.otpAttempts })
      .from(bookings)
      .where(eq(bookings.id, bookingId))
      .limit(1);

    if (row?.expiresAt && row.expiresAt.getTime() > now.getTime()) {
      const cached = await this.readCached(bookingId);
      // A cache miss inside a live window means Redis was flushed or evicted.
      // Minting a replacement is the recoverable answer; failing the request
      // would strand a customer whose driver is standing in front of them.
      if (cached) {
        return {
          code: cached,
          expiresAt: row.expiresAt,
          // `verify` refuses once the count passes the cap, so the code is dead
          // from the attempt that reaches it.
          locked: row.attempts >= this.env.OTP_MAX_ATTEMPTS,
        };
      }
    }

    return this.mint(db, bookingId, now);
  }

  /**
   * L17: a new code NOW, whatever the window, with its attempts reset.
   *
   * Only the customer reaches this (the controller checks ownership and the
   * renewal cap). That is the whole safety argument: the person guessing at a
   * code is the driver side, and a reset only the customer's phone can ask for
   * is not a way to buy more guesses. Rotating automatically on lock-out would
   * be exactly that.
   */
  renew(db: DatabaseExecutor, bookingId: string, now = new Date()) {
    return this.mint(db, bookingId, now);
  }

  private async mint(
    db: DatabaseExecutor,
    bookingId: string,
    now: Date,
  ): Promise<{ code: string; expiresAt: Date; locked: boolean }> {
    const code = generateOtp();
    const expiresAt = new Date(now.getTime() + BookingOtpService.WINDOW_MS);

    await db
      .update(bookings)
      .set({
        bookingOtpHash: digest(code),
        otpExpiresAt: expiresAt,
        // A new code has had no attempts against it. Carrying the old count
        // would let a customer be locked out of a code they were just given.
        otpAttempts: 0,
        updatedAt: now,
      })
      .where(eq(bookings.id, bookingId));

    await this.cache(bookingId, code);
    return { code, expiresAt, locked: false };
  }

  /**
   * Counts a renewal and says whether it is allowed. `OTP_MAX_RENEWALS` per
   * booking, counted in Redis for a day — far longer than any handover. A
   * Redis failure allows the renewal: stranding a customer at the roadside
   * is worse than one uncounted reset.
   */
  async takeRenewal(bookingId: string): Promise<boolean> {
    try {
      const key = `booking:otp:renewals:${bookingId}`;
      const used = await this.redis.incr(key);
      if (used === 1) await this.redis.expire(key, 24 * 60 * 60);
      return used <= BookingOtpService.MAX_RENEWALS;
    } catch {
      return true;
    }
  }

  /** L17: how many fresh codes a customer can ask for on one trip. */
  static readonly MAX_RENEWALS = 3;

  /**
   * Verify a driver's entry (Phase 18 calls this; it lives beside the mint
   * because a code and its check must not be written by two different people).
   *
   * The increment-and-read is ONE statement, copying `auth-public.service.ts`
   * exactly: reading the count and then writing it lets N concurrent guesses
   * all pass the same cap. Wrong, expired, exhausted and never-minted all
   * return `false` — a caller able to tell them apart would be an oracle.
   */
  async verify(db: DatabaseExecutor, bookingId: string, attempt: string, now = new Date()): Promise<boolean> {
    const [row] = await db
      .update(bookings)
      .set({ otpAttempts: sql`${bookings.otpAttempts} + 1` })
      .where(eq(bookings.id, bookingId))
      .returning({
        hash: bookings.bookingOtpHash,
        expiresAt: bookings.otpExpiresAt,
        attempts: bookings.otpAttempts,
      });

    if (!row?.hash || !row.expiresAt) return false;
    if (row.expiresAt.getTime() <= now.getTime()) return false;
    if (row.attempts > this.env.OTP_MAX_ATTEMPTS) return false;

    return digestsMatch(row.hash, digest(attempt));
  }

  /** Belt and braces — the code dies with its window even if the row outlives it. */
  private async cache(bookingId: string, code: string): Promise<void> {
    try {
      await this.redis.set(
        BookingOtpService.key(bookingId),
        code,
        'PX',
        BookingOtpService.WINDOW_MS,
      );
    } catch {
      // A cache write failure costs a rotation on the next read, nothing more.
    }
  }

  private async readCached(bookingId: string): Promise<string | null> {
    try {
      return await this.redis.get(BookingOtpService.key(bookingId));
    } catch {
      return null;
    }
  }

  /** Called when a booking ends — a finished trip's code has no reason to linger. */
  async forget(bookingId: string): Promise<void> {
    try {
      await this.redis.del(BookingOtpService.key(bookingId));
    } catch {
      /* the TTL will get it */
    }
  }
}
