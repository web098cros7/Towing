import { Module } from '@nestjs/common';
import { AdminAuthModule } from '../admin-auth/admin-auth.module';
import { AuthModule } from '../auth/auth.module';
import { AdminSupportController } from './admin-support.controller';
import { SupportController } from './support.controller';
import { SupportRepo } from './support.repo';
import { SupportService } from './support.service';

/**
 * W15's support tickets (§9.4.12).
 *
 * `AdminAuthModule` for the audit writer — every console action lands in
 * `admin_actions` — and `AuthModule` for the guard's `TokenService`.
 * Notifications are `@Global()`.
 */
@Module({
  imports: [AuthModule, AdminAuthModule],
  controllers: [SupportController, AdminSupportController],
  providers: [SupportService, SupportRepo],
})
export class SupportModule {}
