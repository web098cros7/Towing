import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import type Redis from 'ioredis';
import { ENV, type Env } from '../../config/env';
import { ExternalCallPolicy } from '../../common/http/external-call.policy';
import { REDIS } from '../../redis/redis.constants';
import { devOtpKey } from './dev-otp.adapter';
import type { OtpPort, OtpPurpose } from './otp.port';

/**
 * Login codes by SMS through MSG91 (`OTP_PROVIDER=msg91`).
 *
 * WE KEEP THE CODE; MSG91 ONLY DELIVERS IT. The server generates the code and
 * stores only its hash (`login_challenges.code_hash`), exactly as with the dev
 * adapter, so verification, attempt limits and expiry stay ours. MSG91's own
 * OTP product (it generates and verifies) would move all of that to the vendor;
 * instead this sends one SMS with the Flow API (`/api/v5/flow`) and the
 * DLT-approved OTP template, the code in the template's variable
 * (`MSG91_OTP_VAR`, default `otp`: "Your MiTow code is ##otp##").
 *
 * The same vendor call the notification adapter makes (`msg91-sms.adapter.ts`),
 * kept separate so a live code is never written to the notification tables.
 *
 * A failed send THROWS: the login request then fails and the app says "Could not
 * send the code", rather than the customer waiting for an SMS that never comes.
 *
 * With `AUTH_DEV_OTP_ECHO` on (a demo server only; production refuses it) the
 * code is also parked for the on-screen echo, so a demo phone gets both.
 */
@Injectable()
export class Msg91OtpAdapter implements OtpPort, OnModuleInit {
  private readonly logger = new Logger(Msg91OtpAdapter.name);

  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly policy: ExternalCallPolicy,
  ) {}

  onModuleInit(): void {
    if (this.env.OTP_PROVIDER !== 'msg91') return;
    // Production refuses to boot this half-configured (`assertProductionSafety`);
    // elsewhere it is a warning so a half-filled .env is obvious at start.
    if (!this.env.MSG91_AUTH_KEY || !this.env.MSG91_OTP_TEMPLATE_ID) {
      this.logger.warn('OTP_PROVIDER=msg91 but MSG91_AUTH_KEY or MSG91_OTP_TEMPLATE_ID is missing');
    }
  }

  async send(phone: string, code: string, purpose: OtpPurpose): Promise<void> {
    if (!this.env.MSG91_AUTH_KEY || !this.env.MSG91_OTP_TEMPLATE_ID) {
      throw new Error('MSG91 is not configured for login codes');
    }

    if (this.env.AUTH_DEV_OTP_ECHO) {
      await this.redis.set(devOtpKey(phone), code, 'EX', this.env.OTP_TTL_SECONDS);
    }

    const requestId = await this.policy.run<string | null>(
      {
        vendor: 'msg91',
        attempts: 2,
        backoffMs: 500,
        // A rejected template or number fails the same way every time.
        isRetryable: (error) => !(error instanceof Msg91RejectedError),
      },
      async (signal) => {
        const response = await fetch(`${this.env.MSG91_BASE_URL}/api/v5/flow`, {
          method: 'POST',
          signal,
          headers: {
            'content-type': 'application/json',
            accept: 'application/json',
            authkey: this.env.MSG91_AUTH_KEY ?? '',
          },
          body: JSON.stringify({
            template_id: this.env.MSG91_OTP_TEMPLATE_ID,
            short_url: '0',
            recipients: [{ mobiles: phone.replace(/^\+/, ''), [this.env.MSG91_OTP_VAR]: code }],
          }),
        });

        const text = await response.text();
        if (!response.ok) {
          if (response.status < 500) throw new Msg91RejectedError(`${response.status}: ${text}`);
          throw new Error(`MSG91 returned ${response.status}: ${text}`);
        }
        const body = JSON.parse(text) as { type?: string; message?: string; request_id?: string };
        if (body.type === 'error') throw new Msg91RejectedError(body.message ?? 'MSG91 error');
        return body.request_id ?? null;
      },
    );

    // Never the code, never the full number.
    this.logger.log(`${purpose} code sent to ${mask(phone)} (MSG91 ${requestId ?? 'no id'})`);
  }

  async lastIssued(phone: string): Promise<string | null> {
    if (!this.env.AUTH_DEV_OTP_ECHO) return null;
    return this.redis.get(devOtpKey(phone));
  }
}

export class Msg91RejectedError extends Error {}

function mask(phone: string): string {
  return phone.length <= 4 ? '****' : `${'*'.repeat(phone.length - 4)}${phone.slice(-4)}`;
}
