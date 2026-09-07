import { Injectable } from '@nestjs/common';
import type { MaskCallParams, MaskedCall, TelephonyPort } from './telephony.port';

/**
 * The no-provider path: hand back the other party's real number and say so.
 *
 * NAMED IN THE PLAN AS THE FALLBACK — the external-dependencies table's row for
 * the masked-calling provider reads "Direct dial with a privacy warning, or ship
 * chat first". This is that, and the warning is the client's half of it.
 *
 * IT IS THE PERMANENT LOCAL PATH, NOT A STUB, in the same sense as
 * `DiskStorageAdapter` and `DevOtpAdapter`: `pnpm backend` has to run the whole
 * §5.2 chain with no vendor account, forever. But it is NOT a §19.2 rung the way
 * `HaversineDirectionsAdapter` is, and the distinction is the reason
 * `assertProductionSafety` refuses it. A straight-line ETA is a worse answer to
 * the same question and degrading to it costs the customer nothing but accuracy.
 * Degrading to this discloses a personal phone number, permanently and
 * irreversibly, to somebody who was never meant to have it — that is not a
 * degraded answer, it is a different one.
 *
 * So: fine in development, fine in staging, refused in production until
 * SETUP-CHECKLIST item 13 is done.
 */
@Injectable()
export class DirectDialAdapter implements TelephonyPort {
  readonly provider = 'direct' as const;

  async maskedNumber(params: MaskCallParams): Promise<MaskedCall> {
    // The dialler wants the OTHER party's number, so the leg inverts.
    const dialNumber = params.from === 'driver' ? params.customerMobile : params.driverMobile;

    return {
      dialNumber: dialNumber ?? null,
      masked: false,
      reference: null,
    };
  }
}
