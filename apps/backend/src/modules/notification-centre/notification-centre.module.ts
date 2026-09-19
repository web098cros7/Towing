import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DriverNotificationsController } from './driver-notifications.controller';
import { MeNotificationsController } from './me-notifications.controller';
import { NotificationCentreService } from './notification-centre.service';

/**
 * The client-facing half of §12: device registration, the in-app centre, and
 * per-subject preferences — for both realms (Phase 13).
 *
 * NAMED `NotificationCentreModule`, NOT `NotificationsModule`: that name is
 * already taken by `common/notifications/notifications.module.ts`, which
 * `app.module.ts` imports. Two classes with one name would force an import
 * alias in the root module and confuse every future reader about which is
 * which. This one holds controllers; that one holds the spine.
 *
 * `DeviceRegistryService` comes from the `@Global()` `NotificationsModule`, so
 * it is not imported here — same reason `MeModule` does not import
 * `StorageModule` for `PresignedUploadService`.
 */
@Module({
  imports: [AuthModule],
  controllers: [MeNotificationsController, DriverNotificationsController],
  providers: [NotificationCentreService],
  // W6: the admin app-view lists a customer's notifications through it.
  exports: [NotificationCentreService],
})
export class NotificationCentreModule {}
