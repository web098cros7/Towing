import { Module } from '@nestjs/common';
import { AdminAuthModule } from '../admin-auth/admin-auth.module';
import { AuthModule } from '../auth/auth.module';
import { AdminNotificationsController } from './admin-notifications.controller';
import { AdminNotificationsService } from './admin-notifications.service';

/**
 * W18 — the notification console's API (§12.3).
 *
 * `NotificationsModule` is not imported: it is `@Global()` and provides the
 * router + catalogue the service reads. `AdminAuthModule` is for the sole
 * writer of `admin_actions` (the guarded test-send records one).
 */
@Module({
  imports: [AuthModule, AdminAuthModule],
  controllers: [AdminNotificationsController],
  providers: [AdminNotificationsService],
})
export class AdminNotificationsModule {}
