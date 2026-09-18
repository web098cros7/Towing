import { Module } from '@nestjs/common';
import { AdminAuthModule } from '../admin-auth/admin-auth.module';
import { AuthModule } from '../auth/auth.module';
import { AdminUsersController } from './admin-users.controller';
import { AdminUsersService } from './admin-users.service';

/**
 * Admin user management (W2). Imports `AdminAuthModule` for the exported
 * `AdminAuditService` — the sole writer of `admin_actions` — and
 * `AuthModule` for `TokenService` (session revocation on demote/deactivate).
 * Redis arrives from the `@Global()` RedisModule for the `admin:revoke`
 * socket-drop publish W1-3's gateway consumes.
 */
@Module({
  imports: [AuthModule, AdminAuthModule],
  controllers: [AdminUsersController],
  providers: [AdminUsersService],
  exports: [AdminUsersService],
})
export class AdminUsersModule {}
