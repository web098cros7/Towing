import { Module } from '@nestjs/common';
import { AdminAuthModule } from '../admin-auth/admin-auth.module';
import { AdminDriversModule } from '../admin-drivers/admin-drivers.module';
import { AdminFleetsModule } from '../admin-fleets/admin-fleets.module';
import { AuthModule } from '../auth/auth.module';
import { BookingsModule } from '../bookings/bookings.module';
import { AccountSuspensionService } from './account-suspension.service';
import { AdminDirectoryController } from './admin-directory.controller';
import { AdminDirectoryRepo } from './admin-directory.repo';
import { AdminDirectoryService } from './admin-directory.service';

/**
 * W6's directory: user search/detail/trips, the suspension request flow, and
 * ONE `AccountSuspensionService` the driver and fleet routes are meant to join
 * (they delegate to A14's and A15's services today; the follow-up commit folds
 * their internals in).
 *
 * Imports are the service edges, not conveniences:
 * - `AdminAuthModule` for `AdminAuditService` (the sole writer of admin_actions);
 * - `AuthModule` for `TokenService` (refresh-family revocation);
 * - `AdminDriversModule`/`AdminFleetsModule` for the two delegation targets;
 * - `BookingsModule` for the state machine the searching-booking cancels run
 *   through — never `BookingsService.cancel`, which is the customer path.
 * `NotificationsModule` (DeviceRegistryService) and the queue are `@Global()`.
 */
@Module({
  imports: [AuthModule, AdminAuthModule, AdminDriversModule, AdminFleetsModule, BookingsModule],
  controllers: [AdminDirectoryController],
  providers: [AdminDirectoryRepo, AdminDirectoryService, AccountSuspensionService],
  exports: [AccountSuspensionService],
})
export class AdminDirectoryModule {}
