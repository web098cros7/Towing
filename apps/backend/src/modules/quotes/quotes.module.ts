import { Module } from '@nestjs/common';
import { AdminAuthModule } from '../admin-auth/admin-auth.module';
import { AuthModule } from '../auth/auth.module';
import { BookingsModule } from '../bookings/bookings.module';
import { PricingModule } from '../pricing/pricing.module';
import { AdminQuotesController } from './admin-quotes.controller';
import { QuotesController } from './quotes.controller';
import { QuotesService } from './quotes.service';

/**
 * W20 — §7.3's manual-quote lane, both sides of the counter.
 *
 * `BookingsModule` is imported rather than re-implementing booking creation
 * here: acceptance must run through the ONE creation path (§3.4's fare lock,
 * the §3.7/§3.8 guards, the OTP mint, the kill switches) with the quote's
 * amounts passed in as a pre-locked fare. A second insert site would be a
 * second place for those guards to drift.
 *
 * `PricingModule` supplies the rate card the commission is read from, and
 * `AdminAuthModule` the audit writer — the same pair the W18/W19 console
 * modules import.
 */
@Module({
  imports: [AuthModule, PricingModule, BookingsModule, AdminAuthModule],
  controllers: [QuotesController, AdminQuotesController],
  providers: [QuotesService],
})
export class QuotesModule {}
