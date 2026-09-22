import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AdminAuditController } from './admin-audit.controller';
import { AdminAuditService } from './admin-audit.service';

/**
 * The audit viewer (W1, §3.5). Read-only: `AdminAuditService` in
 * `admin-auth` remains the ONLY writer of `admin_actions` — this module never
 * inserts. `AuthModule` arrives for the guard's `TokenService` dependency.
 */
@Module({
  imports: [AuthModule],
  controllers: [AdminAuditController],
  providers: [AdminAuditService],
})
export class AdminAuditModule {}
