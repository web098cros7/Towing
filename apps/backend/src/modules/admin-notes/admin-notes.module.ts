import { Module } from '@nestjs/common';
import { AdminAuthModule } from '../admin-auth/admin-auth.module';
import { AuthModule } from '../auth/auth.module';
import { AdminNotesController } from './admin-notes.controller';
import { AdminNotesService } from './admin-notes.service';

/**
 * Admin notes (W21). Imports `AdminAuthModule` for the exported
 * `AdminAuditService` — the sole writer of `admin_actions` — and `AuthModule`
 * for the guard's `TokenService` dependency.
 */
@Module({
  imports: [AuthModule, AdminAuthModule],
  controllers: [AdminNotesController],
  providers: [AdminNotesService],
})
export class AdminNotesModule {}
