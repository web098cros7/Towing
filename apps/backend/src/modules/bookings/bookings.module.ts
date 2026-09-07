import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PricingModule } from '../pricing/pricing.module';
import { CouponsModule } from '../coupons/coupons.module';
import { PaymentGatewayModule } from '../money/payment-gateway.module';
import { RealtimeModule } from '../../realtime/realtime.module';
import { BookingOtpService } from './booking-otp.service';
import { BookingStateMachineService } from './booking-state-machine.service';
import { BookingsController } from './bookings.controller';
import { BookingsRepo } from './bookings.repo';
import { BookingsService } from './bookings.service';
import { CustomerGateway } from './customer.gateway';
import { DispatchConfigRepo } from './dispatch-config.repo';

/**
 * §5.1's booking lifecycle.
 *
 * `PricingModule` for the §3.4 fare lock — a booking never re-derives a fare,
 * it asks the same service the estimate came from. `AuthModule` for
 * `JwtAuthGuard`. Everything else (DB, cache, queue, notifications, events,
 * Redis) is `@Global()`.
 *
 * Exports the state machine and the OTP service because they are the pieces
 * every later phase reaches for: Phase 17 transitions bookings and Phase 18
 * verifies the OTP, and neither may reimplement them.
 */
@Module({
  // `PaymentGatewayModule`, not `MoneyModule`: §3.5's chargeable cancellation
  // needs to COLLECT a fee, not to settle a fare. Importing the whole money
  // domain would be a cycle, since `MoneyModule` imports this one for the
  // state machine — see `PaymentGatewayModule`'s header.
  imports: [AuthModule, PricingModule, RealtimeModule, CouponsModule, PaymentGatewayModule],
  controllers: [BookingsController],
  providers: [
    BookingsService,
    BookingsRepo,
    BookingStateMachineService,
    BookingOtpService,
    DispatchConfigRepo,
    CustomerGateway,
  ],
  exports: [
    BookingStateMachineService,
    BookingOtpService,
    BookingsRepo,
    DispatchConfigRepo,
    // Phase 17's engine publishes §9.1.6 wave progress through it, and Phase 18
    // will publish live driver position on the same rooms.
    CustomerGateway,
  ],
})
export class BookingsModule {}
