import { Module } from '@nestjs/common';
import { AdminAuthModule } from '../admin-auth/admin-auth.module';
import { AuthModule } from '../auth/auth.module';
import { MoneyModule } from '../money/money.module';
import { PricingModule } from '../pricing/pricing.module';
import { AdminFinanceController } from './admin-finance.controller';
import { AdminFinanceRepo } from './admin-finance.repo';
import { AdminFinanceService } from './admin-finance.service';

/**
 * §9.4.10's Finance queue — the `finance` sub-role's first consumer with any
 * authority over money.
 *
 * `MoneyModule` for `PayoutsRepo`/`PayoutsService` (rejection routes into the
 * existing `markFailed`, so there is one failure path rather than two) and for
 * W9's `RefundsService` — the console's refund write must ride the SAME
 * engine the dispute exits and the §3.5 path use, keys and all, or Finance
 * becomes a third way to move money. `AdminAuthModule` for
 * `AdminAuditService`, whose own docstring already named "Phase 19's payout
 * approvals" as a caller.
 */
@Module({
  imports: [AuthModule, AdminAuthModule, MoneyModule, PricingModule],
  controllers: [AdminFinanceController],
  providers: [AdminFinanceService, AdminFinanceRepo],
})
export class AdminFinanceModule {}
