import { Module } from '@nestjs/common';
import { NotificationsModule } from '../../common/notifications/notifications.module';
import { AdminAuthModule } from '../admin-auth/admin-auth.module';
import { AuthModule } from '../auth/auth.module';
import { AdminAnalyticsController } from './admin-analytics.controller';
import { AnalyticsRollupService } from './analytics-rollup.service';
import { AnalyticsRepo } from './analytics.repo';
import { AnalyticsService } from './analytics.service';

/**
 * W17 — §9.4.13's analytics (§22.2/§22.3).
 *
 * `AdminAuthModule` for the sole writer of `admin_actions` (the manual rollup
 * trigger records one), `NotificationsModule` for the weekly report emit
 * (`analytics.report` → the ops mailbox). Reads go through `DB_READER` in
 * `analytics.repo.ts`; every write lives in `analytics-rollup.ts` behind the
 * `DB` handle.
 */
@Module({
  imports: [AuthModule, AdminAuthModule, NotificationsModule],
  controllers: [AdminAnalyticsController],
  providers: [AnalyticsService, AnalyticsRepo, AnalyticsRollupService],
  exports: [AnalyticsService, AnalyticsRollupService],
})
export class AnalyticsModule {}
