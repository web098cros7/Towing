import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AdminAuthModule } from '../admin-auth/admin-auth.module';
import { AdminBannersController } from './admin-banners.controller';
import { BannersController } from './banners.controller';
import { BannersService } from './banners.service';

/**
 * W16 — banners (§9.4.11): the public carousel read and the console behind it.
 *
 * `AdminAuthModule` is imported for the sole writer of `admin_actions`
 * (`AdminAuditService`) — every create/update records one row with the whole
 * before/after. `STORAGE` + `PresignedUploadService` come from the global
 * `StorageModule`, the same seam KYC documents and dispute evidence use.
 */
@Module({
  imports: [AuthModule, AdminAuthModule],
  controllers: [BannersController, AdminBannersController],
  providers: [BannersService],
})
export class BannersModule {}
