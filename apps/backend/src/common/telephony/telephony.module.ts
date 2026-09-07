import { Global, Logger, Module } from '@nestjs/common';
import { ENV, type Env } from '../../config/env';
import { DirectDialAdapter } from './direct-dial.adapter';
import { ExotelAdapter } from './exotel.adapter';
import { TELEPHONY, type MaskCallParams, type MaskedCall, type TelephonyPort } from './telephony.port';

/**
 * The `money.module.ts` `PAYOUT_PROVIDER` idiom — a `useFactory` picking an
 * adapter by env — wrapped in the `RoutingModule` degradation the payout port
 * does not have.
 *
 * WHY BOTH. The env switch is the deployment decision ("we have an Exotel
 * account"). The degradation is the runtime one ("Exotel is down right now"),
 * and §19.2's ladder applies here as much as anywhere: a customer standing
 * beside a broken vehicle who cannot reach the driver looking for them is a
 * worse outcome than a disclosed phone number. So a provider failure falls
 * through to a direct dial with `masked: false`, which the apps are required to
 * warn about — the honest degradation, visibly labelled, rather than a dead
 * button.
 *
 * `@Global()` because the consumers are already three and will be four: the
 * driver's active-job screen, the customer's tracking screen, and Phase 20's SOS
 * and support paths, which need to reach a person urgently and by definition
 * cannot depend on an import edge somebody remembered to add.
 *
 * Both adapters are instantiated whichever way `TELEPHONY_PROVIDER` is set —
 * which is why neither constructor validates a credential. `ExotelAdapter` warns
 * in `onModuleInit`, guarded on the switch; `assertProductionSafety` refuses the
 * misconfiguration outright.
 */
class TelephonyRouter implements TelephonyPort {
  private readonly logger = new Logger(TelephonyRouter.name);

  constructor(
    private readonly env: Env,
    private readonly exotel: ExotelAdapter,
    private readonly direct: DirectDialAdapter,
  ) {}

  async maskedNumber(params: MaskCallParams): Promise<MaskedCall> {
    if (this.env.TELEPHONY_PROVIDER !== 'exotel') {
      return this.direct.maskedNumber(params);
    }

    try {
      return await this.exotel.maskedNumber(params);
    } catch (error) {
      this.logger.warn(
        `Masked calling unavailable (${error instanceof Error ? error.name : 'unknown'}) — falling back to a direct dial`,
      );
      return this.direct.maskedNumber(params);
    }
  }
}

@Global()
@Module({
  providers: [
    DirectDialAdapter,
    ExotelAdapter,
    {
      provide: TELEPHONY,
      inject: [ENV, ExotelAdapter, DirectDialAdapter],
      useFactory: (env: Env, exotel: ExotelAdapter, direct: DirectDialAdapter): TelephonyPort =>
        new TelephonyRouter(env, exotel, direct),
    },
  ],
  exports: [TELEPHONY],
})
export class TelephonyModule {}
