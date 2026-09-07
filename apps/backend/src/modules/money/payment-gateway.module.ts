import { Module } from '@nestjs/common';
import { ENV, type Env } from '../../config/env';
import { CancellationFeeService } from './cancellation-fee.service';
import { DevPaymentAdapter } from './dev-payment.adapter';
import { PAYMENT_GATEWAY, type PaymentGatewayPort } from './payment-gateway.port';
import { PaymentsRepo } from './payments.repo';
import { RazorpayPaymentsAdapter } from './razorpay-payments.adapter';

/**
 * The payment gateway as INFRASTRUCTURE, split out from `MoneyModule`.
 *
 * WHY IT IS ITS OWN MODULE, and the reason is a genuine dependency cycle rather
 * than tidiness. `MoneyModule` imports `BookingsModule`, because capture is the
 * only writer of the `completed → paid` edge and that edge belongs to the Phase
 * 15 state machine. But §3.5's chargeable cancellation runs the other way:
 * `BookingsService` has to collect a fee before it cancels, which needs the
 * gateway. Two modules importing each other is what `forwardRef` exists to
 * paper over, and papering over it here would hide a real distinction:
 *
 *   · the PORT and the payments TABLE are infrastructure — no domain knowledge,
 *     no state machine, no ledger;
 *   · SETTLEMENT is domain — it credits a ledger and moves a booking.
 *
 * Bookings needs the first and not the second. Splitting them along that line
 * removes the cycle instead of tolerating it.
 */
@Module({
  providers: [
    PaymentsRepo,
    CancellationFeeService,
    // Both adapters are constructed whichever the factory picks, which is
    // exactly why neither constructor may validate credentials or open a
    // connection. `RazorpayPaymentsAdapter` does that in `onModuleInit`.
    DevPaymentAdapter,
    RazorpayPaymentsAdapter,
    {
      provide: PAYMENT_GATEWAY,
      inject: [ENV, DevPaymentAdapter, RazorpayPaymentsAdapter],
      useFactory: (
        env: Env,
        dev: DevPaymentAdapter,
        razorpay: RazorpayPaymentsAdapter,
      ): PaymentGatewayPort => (env.PAYMENT_GATEWAY === 'razorpay' ? razorpay : dev),
    },
  ],
  exports: [
    PaymentsRepo,
    CancellationFeeService,
    PAYMENT_GATEWAY,
    // Exported alongside the token — the `QueueModule` pattern — so specs can
    // reach the concrete adapter without widening the port.
    DevPaymentAdapter,
  ],
})
export class PaymentGatewayModule {}
