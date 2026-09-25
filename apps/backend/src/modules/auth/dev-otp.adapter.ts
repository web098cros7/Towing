import { Inject, Injectable, Logger } from '@nestjs/common';
import type Redis from 'ioredis';
import { ENV, type Env } from '../../config/env';
import { REDIS } from '../../redis/redis.constants';
import type { OtpPort, OtpPurpose } from './otp.port';

/**
 * Development delivery: the code goes to the application log so a local login
 * can be completed without an SMS gateway.
 */
@Injectable()
export class DevOtpAdapter implements OtpPort {
  private readonly logger = new Logger(DevOtpAdapter.name);

  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  async send(phone: string, code: string, purpose: OtpPurpose): Promise<void> {
    // A production log sink is shipped, indexed and read by more people than the
    // phone's owner, so a live credential must never reach it. Failing loudly
    // here surfaces a misconfigured deployment instead of quietly leaking codes.
    if (this.env.NODE_ENV === 'production') {
      this.logger.error(
        `No SMS provider is wired: the ${purpose} code for ${mask(phone)} was generated but not delivered`,
      );
      return;
    }

    this.logger.warn(`DEV OTP (${purpose}) for ${phone}: ${code}`);

    // Also parked in Redis, so a mocks-off browser test can read it back
    // through the flag-guarded dev endpoint instead of scraping this log. Same
    // TTL as the code itself — nothing outlives its usefulness.
    if (this.env.AUTH_DEV_OTP_ECHO) {
      await this.redis.set(devOtpKey(phone), code, 'EX', this.env.OTP_TTL_SECONDS);
    }
  }

  async lastIssued(phone: string): Promise<string | null> {
    if (!this.env.AUTH_DEV_OTP_ECHO) return null;
    return this.redis.get(devOtpKey(phone));
  }
}

/** Where the on-screen echo reads the latest code (shared with `Msg91OtpAdapter`). */
export function devOtpKey(phone: string): string {
  return `dev:otp:${phone}`;
}

function mask(phone: string): string {
  return phone.length <= 4 ? '****' : `${'*'.repeat(phone.length - 4)}${phone.slice(-4)}`;
}
