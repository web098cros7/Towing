import { Module } from '@nestjs/common';
import { AdminAuthModule } from '../admin-auth/admin-auth.module';
import { AdminNotesModule } from '../admin-notes/admin-notes.module';
import { AuthModule } from '../auth/auth.module';
import { BookingsModule } from '../bookings/bookings.module';
import { CouponsModule } from '../coupons/coupons.module';
import { DispatchModule } from '../dispatch/dispatch.module';
import { InvoicesModule } from '../invoices/invoices.module';
import { JobExecutionModule } from '../job-execution/job-execution.module';
import { MoneyModule } from '../money/money.module';
import { PricingModule } from '../pricing/pricing.module';
import { TrackingModule } from '../tracking/tracking.module';
import { AdminBookingsController } from './admin-bookings.controller';
import { AdminBookingsRepo } from './admin-bookings.repo';
import { AdminBookingsService } from './admin-bookings.service';
import { AdminDisputesController } from './admin-disputes.controller';
import { AdminDisputesRepo } from './admin-disputes.repo';
import { AdminDisputesService } from './admin-disputes.service';

/**
 * W8's money-and-bookings console (§9.4.7, §6.5, §14.2).
 *
 * The import list is the workstreams this service reaches into, and each edge is
 * deliberate:
 *
 *  - `BookingsModule` — the state machine (`transition` is the only writer of
 *    `bookings.status`) and `BookingOtpService` (an assignment that ended takes
 *    its OTP with it).
 *  - `DispatchModule` — `revokeAll` for A12, the reassign attempt writers, and
 *    the §6.5 re-dispatch / exclusive-offer entry points.
 *  - `MoneyModule` — `RefundsService` (full and partial) and
 *    `PaymentReconcileService` (the §14.2 recheck path).
 *  - `PricingModule` — `PricingConfigRepo`, the live §3.5 cancellation knobs
 *    the customer's own cancel reads.
 *  - `CouponsModule` — releasing a coupon on a waived cancellation.
 *  - `TrackingModule` — the assignment-cache and ETA invalidations step 4 of
 *    reassign mirrors from `afterJobEnded`.
 *  - `AdminNotesModule` — the dispute note route writes through the shared
 *    service so its subject-access rule cannot drift from the panel's.
 *  - `JobExecutionModule` / `InvoicesModule` — admin completion (waiting charge
 *    from the snapshot) and the audited invoice link.
 *
 * `DispatchModule` imports `BookingsModule`, and `BookingsModule` does NOT
 * import any admin module, so this module is a leaf: no cycle.
 */
@Module({
  imports: [
    AuthModule,
    AdminAuthModule,
    AdminNotesModule,
    BookingsModule,
    CouponsModule,
    DispatchModule,
    InvoicesModule,
    JobExecutionModule,
    MoneyModule,
    PricingModule,
    TrackingModule,
  ],
  controllers: [AdminBookingsController, AdminDisputesController],
  providers: [AdminBookingsService, AdminBookingsRepo, AdminDisputesService, AdminDisputesRepo],
  // W8's dispute open/count is this layer's to expose; nothing imports it back.
  exports: [AdminDisputesRepo],
})
export class AdminBookingsModule {}
