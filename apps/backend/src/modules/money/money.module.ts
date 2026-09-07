import { Module } from '@nestjs/common';
import { ENV, type Env } from '../../config/env';
import { AuthModule } from '../auth/auth.module';
import { DevPayoutAdapter } from './dev-payout.adapter';
import { EarningsProjectorService } from './earnings-projector.service';
import { EarningsController } from './earnings.controller';
import { EarningsRepo } from './earnings.repo';
import { EarningsService } from './earnings.service';
import { ProfileCompleteGuard } from '../../common/tenancy/profile-complete.guard';
import { PayoutReconcileService } from './payout-reconcile.service';
import { PAYOUT_PROVIDER, type PayoutProviderPort } from './payout-provider.port';
import { PayoutsController } from './payouts.controller';
import { PayoutsRepo } from './payouts.repo';
import { PayoutsService } from './payouts.service';
import { PaymentReconcileService } from './payment-reconcile.service';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { RefundsService } from './refunds.service';
import { WalletService } from './wallet.service';
import { DriverEarningsRepo } from './driver-earnings.repo';
import { DriverEarningsService } from './driver-earnings.service';
import { EarningsDigestService } from './earnings-digest.service';
import { DriverMoneyController } from './driver-money.controller';
import { DriverPayoutAccountService } from './driver-payout-account.service';
import { PayoutAccountsRepo } from './payout-accounts.repo';
import { BookingsModule } from '../bookings/bookings.module';
import { PricingModule } from '../pricing/pricing.module';
import { PaymentGatewayModule } from './payment-gateway.module';
import { RazorpayRouteAdapter } from './razorpay-route.adapter';
import { ReportsController } from './reports.controller';
import { ReportsRepo } from './reports.repo';
import { ReportsService } from './reports.service';

/**
 * The money domain: the earnings projection and its nightly reconciliation,
 * the §9.3.7/§9.3.8 read endpoints, the payout write path, and — from Phase 19
 * — the §14.2 capture path that finally makes a booking `paid`.
 *
 * TWO PORTS, TWO SWITCHES, TWO BREAKERS. `PAYOUT_PROVIDER` is money out and
 * `PAYMENT_GATEWAY` is money in; Razorpay's payment gateway and RazorpayX Route
 * are different products with independent availability, and folding them into
 * one port would mean a payout backlog stops customers paying.
 *
 * `BookingsModule` is imported for the state machine and the customer gateway
 * — capture is the only writer of the `completed → paid` edge. ConfigModule,
 * DbModule, LedgerModule, CacheModule, FleetEventsModule, QueueModule and
 * NotificationsModule are all `@Global()`.
 */
@Module({
  imports: [AuthModule, BookingsModule, PricingModule, PaymentGatewayModule],
  controllers: [EarningsController, ReportsController, PayoutsController, PaymentsController, DriverMoneyController],
  providers: [
    EarningsProjectorService,
    EarningsService,
    EarningsRepo,
    ReportsService,
    ReportsRepo,
    PayoutsService,
    PayoutsRepo,
    PayoutReconcileService,
    PaymentsService,
    PaymentReconcileService,
    RefundsService,
    WalletService,
    DriverEarningsRepo,
    DriverEarningsService,
    EarningsDigestService,
    DriverPayoutAccountService,
    PayoutAccountsRepo,
    ProfileCompleteGuard,
    // Both adapters are instantiated whichever one the factory picks — which is
    // exactly why neither constructor may validate credentials or open a
    // connection. RazorpayRouteAdapter does that in `onModuleInit`, guarded.
    DevPayoutAdapter,
    RazorpayRouteAdapter,
    {
      provide: PAYOUT_PROVIDER,
      inject: [ENV, DevPayoutAdapter, RazorpayRouteAdapter],
      useFactory: (env: Env, dev: DevPayoutAdapter, razorpay: RazorpayRouteAdapter): PayoutProviderPort =>
        env.PAYOUT_PROVIDER === 'razorpay_route' ? razorpay : dev,
    },
  ],
  // `DevPayoutAdapter` is exported alongside the token — the `QueueModule`
  // pattern — so specs can reach the concrete adapter without widening the port.
  exports: [
    EarningsProjectorService,
    PayoutsService,
    PayoutsRepo,
    PayoutReconcileService,
    PaymentsService,
    PaymentReconcileService,
    RefundsService,
    DriverEarningsRepo,
    PayoutAccountsRepo,
    EarningsDigestService,
    PAYOUT_PROVIDER,
    DevPayoutAdapter,
    // Re-exported wholesale so importers get the gateway token, the payments
    // repo and the dev adapter without having to know the split.
    PaymentGatewayModule,
  ],
})
export class MoneyModule {}
