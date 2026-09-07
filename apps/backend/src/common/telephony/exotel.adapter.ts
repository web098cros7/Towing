import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { ENV, type Env } from '../../config/env';
import { ExternalCallPolicy } from '../http/external-call.policy';
import type { MaskCallParams, MaskedCall, TelephonyPort } from './telephony.port';

/**
 * Exotel connect — the India-typical masked-calling provider, through §19.3's
 * `ExternalCallPolicy`.
 *
 * NEVER EXECUTED. No Exotel account exists (SETUP-CHECKLIST item 13, which has
 * been "start by step 16" since Phase 16 and is now overdue), so this is written
 * against the documented API and exercised only by fakes — the same honest
 * standing as the two Google adapters and Phase 13's four channels.
 *
 * ITS SHAPE IS THE ONE THING WORTH KNOWING IF YOU ARE THE PERSON WIRING THE REAL
 * ACCOUNT. Exotel's connect API places the call from THEIR side: you POST the two
 * numbers and their DID, and they ring the first leg, then bridge the second.
 * That is a different model from "give me a number to dial", which is what this
 * port asks for and what a handset needs — so this adapter uses the DID as the
 * dial target and lets the app's own dialler originate. If the account is
 * provisioned for the connect model instead, this becomes a call placed here and
 * `dialNumber` becomes null with `masked: true`; the port already permits that
 * and the clients already handle a null by disabling the button.
 *
 * `assertProductionSafety` refuses `exotel` with no SID or token, so the
 * misconfiguration is caught at boot rather than at the first call in a
 * roadside emergency.
 */
@Injectable()
export class ExotelAdapter implements TelephonyPort, OnModuleInit {
  readonly vendor = 'exotel';

  private readonly logger = new Logger(ExotelAdapter.name);

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly policy: ExternalCallPolicy,
  ) {}

  onModuleInit(): void {
    // Guarded on the switch: both adapters are instantiated whichever the
    // factory picks, so an unguarded check warns on every direct-dial boot.
    if (this.env.TELEPHONY_PROVIDER !== 'exotel') return;
    if (!this.env.EXOTEL_SID || !this.env.EXOTEL_TOKEN) {
      this.logger.warn('TELEPHONY_PROVIDER=exotel but EXOTEL_SID/EXOTEL_TOKEN are unset');
    }
  }

  async maskedNumber(params: MaskCallParams): Promise<MaskedCall> {
    const { customerMobile, driverMobile } = params;
    if (!customerMobile || !driverMobile) {
      // A binding needs two legs. One-sided is not a provider failure and must
      // not trip the breaker — it is a booking with no contact number.
      return { dialNumber: null, masked: true, reference: null };
    }

    return this.policy.run<MaskedCall>(
      {
        vendor: this.vendor,
        attempts: 2,
        backoffMs: 200,
        timeoutMs: this.env.EXOTEL_TIMEOUT_MS,
      },
      async (signal) => {
        const url = `${this.env.EXOTEL_BASE_URL}/${this.env.EXOTEL_SID}/Calls/connect.json`;
        const body = new URLSearchParams({
          From: params.from === 'driver' ? driverMobile : customerMobile,
          To: params.from === 'driver' ? customerMobile : driverMobile,
          CallerId: this.env.EXOTEL_CALLER_ID ?? '',
          // Exotel's own idempotency handle. Scoped to the booking and the leg so
          // a retried request rebinds the same pair rather than burning a second
          // DID out of a finite pool.
          CustomField: `${params.bookingId}:${params.from}`,
        });

        const response = await fetch(url, {
          signal,
          method: 'POST',
          headers: {
            authorization: `Basic ${Buffer.from(
              `${this.env.EXOTEL_SID}:${this.env.EXOTEL_TOKEN}`,
            ).toString('base64')}`,
            'content-type': 'application/x-www-form-urlencoded',
            accept: 'application/json',
          },
          body,
        });

        if (!response.ok) {
          throw new Error(`Exotel returned ${response.status}`);
        }

        const parsed = (await response.json()) as { Call?: { Sid?: string } };

        return {
          // The DID is what both handsets dial and see. It is account
          // configuration, not a per-call value, which is why it comes from env.
          dialNumber: this.env.EXOTEL_CALLER_ID ?? null,
          masked: true,
          reference: parsed.Call?.Sid ?? null,
        };
      },
    );
  }
}
