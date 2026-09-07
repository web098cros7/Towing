import { MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { ErrorEnvelopeFilter } from './common/errors/error-envelope.filter';
import { IdempotencyInterceptor } from './common/idempotency/idempotency.interceptor';
import { AppLoggerModule } from './common/logging/logger.module';
import { HttpMetricsInterceptor } from './common/observability/http-metrics.interceptor';
import { MetricsModule } from './common/observability/metrics.module';
import { RequestIdMiddleware } from './common/logging/request-id.middleware';
import { RedisThrottlerStorage } from './common/throttling/redis-throttler.storage';
import { TenantThrottlerGuard } from './common/throttling/tenant-throttler.guard';
import { ThrottlingModule } from './common/throttling/throttling.module';
import { throttlerOptions } from './common/throttling/throttler.config';
import { CacheModule } from './common/cache/cache.module';
import { KillSwitchModule } from './common/killswitch/killswitch.module';
import { FleetEventsModule } from './common/events/fleet-events.module';
import { QueueModule } from './common/queue/queue.module';
import { ExternalCallModule } from './common/http/external-call.module';
import { TelephonyModule } from './common/telephony/telephony.module';
import { NotificationsModule } from './common/notifications/notifications.module';
import { StorageModule } from './common/storage/storage.module';
import { ConfigModule } from './config/config.module';
import { ENV, type Env } from './config/env';
import { DbModule } from './db/db.module';
import { LedgerModule } from './db/ledger/ledger.module';
import { AdminAuthModule } from './modules/admin-auth/admin-auth.module';
import { AdminConfigModule } from './modules/admin-config/admin-config.module';
import { AdminDriversModule } from './modules/admin-drivers/admin-drivers.module';
import { AdminFinanceModule } from './modules/admin-finance/admin-finance.module';
import { RatingsModule } from './modules/ratings/ratings.module';
import { CouponsModule } from './modules/coupons/coupons.module';
import { InvoicesModule } from './modules/invoices/invoices.module';
import { AuthModule } from './modules/auth/auth.module';
import { AuthPublicModule } from './modules/auth-public/auth-public.module';
import { ComplianceModule } from './modules/compliance/compliance.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { DriverKycModule } from './modules/driver-kyc/driver-kyc.module';
import { DriverPresenceModule } from './modules/driver-presence/driver-presence.module';
import { DispatchModule } from './modules/dispatch/dispatch.module';
import { JobExecutionModule } from './modules/job-execution/job-execution.module';
import { TrackingModule } from './modules/tracking/tracking.module';
import { DriversNearbyModule } from './modules/drivers-nearby/drivers-nearby.module';
import { PlacesModule } from './modules/places/places.module';
import { DriversModule } from './modules/drivers/drivers.module';
import { FilesModule } from './modules/files/files.module';
import { HealthModule } from './modules/health/health.module';
import { JobsModule } from './modules/jobs/jobs.module';
import { MeModule } from './modules/me/me.module';
import { NotificationCentreModule } from './modules/notification-centre/notification-centre.module';
import { BookingsModule } from './modules/bookings/bookings.module';
import { PricingModule } from './modules/pricing/pricing.module';
import { MoneyModule } from './modules/money/money.module';
import { SettingsModule } from './modules/settings/settings.module';
import { TrucksModule } from './modules/trucks/trucks.module';
import { WebhooksModule } from './modules/webhooks/webhooks.module';
import { RealtimeModule } from './realtime/realtime.module';
import { RedisModule } from './redis/redis.module';

@Module({
  imports: [
    ConfigModule,
    AppLoggerModule,
    DbModule,
    LedgerModule,
    RedisModule,
    // forRootAsync so the counter can live in Redis: the storage has to be
    // resolved while the options factory runs, which is before AppModule's own
    // providers exist. One shared budget across N tasks — the Phase 8 deploy
    // gate that unpins `desiredCount`.
    ThrottlerModule.forRootAsync({
      imports: [ThrottlingModule, ConfigModule],
      inject: [ENV, RedisThrottlerStorage],
      useFactory: (env: Env, storage: RedisThrottlerStorage) => throttlerOptions(env, storage),
    }),
    CacheModule,
    KillSwitchModule,
    FleetEventsModule,
    QueueModule,
    StorageModule,
    ExternalCallModule,
    TelephonyModule,
    NotificationsModule,
    AuthModule,
    AuthPublicModule,
    AdminAuthModule,
    AdminDriversModule,
    AdminFinanceModule,
    RatingsModule,
    CouponsModule,
    InvoicesModule,
    AdminConfigModule,
    TrucksModule,
    DriversModule,
    DriverKycModule,
    DriverPresenceModule,
    DriversNearbyModule,
    DispatchModule,
    TrackingModule,
    JobExecutionModule,
    PlacesModule,
    FilesModule,
    DashboardModule,
    ComplianceModule,
    JobsModule,
    MeModule,
    NotificationCentreModule,
    PricingModule,
    BookingsModule,
    MoneyModule,
    SettingsModule,
    WebhooksModule,
    RealtimeModule,
    HealthModule,
    MetricsModule,
  ],
  providers: [
    // Not the stock ThrottlerGuard: its tracker is req.ip (one bucket for every
    // tenant behind the BFF) and its key includes the handler name (so a bucket
    // is really per-endpoint). See tenant-throttler.guard.ts.
    { provide: APP_GUARD, useClass: TenantThrottlerGuard },
    { provide: APP_FILTER, useClass: ErrorEnvelopeFilter },
    // Header-driven: only requests carrying an Idempotency-Key pay its cost.
    { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
    // A provider, not `useGlobalInterceptors` in main.ts — src/test/app.ts has
    // two hand-rolled factories that would each have to mirror it.
    { provide: APP_INTERCEPTOR, useClass: HttpMetricsInterceptor },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // Express 5 path-to-regexp syntax — a bare '*' only works via a deprecation
    // shim that warns on every boot.
    consumer.apply(RequestIdMiddleware).forRoutes('{*splat}');
  }
}
