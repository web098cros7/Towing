import { Module } from '@nestjs/common';
import { AdminAuthModule } from '../admin-auth/admin-auth.module';
import { AuthModule } from '../auth/auth.module';
import { AdminPrivacyController } from './admin-privacy.controller';
import { AdminPrivacyService } from './admin-privacy.service';
import { ErasureService } from './erasure.service';

/**
 * W19 — the privacy lane (§20.4 DPDP): the console's queue, the erasure runner
 * and the retention sweep.
 *
 * `AuthModule` is imported for `TokenService` — the erasure revokes the
 * subject's remaining refresh families itself, because an erasure is exactly
 * the case where "the request that started this" and "the sessions that must
 * die" are different moments — and `AdminAuthModule` for the sole writer of
 * `admin_actions`, same pair as the W18 console module. `StorageModule`,
 * `QueueModule` and the notifications spine are `@Global()`, as everywhere
 * else.
 *
 * `AdminPrivacyService` is exported for the same reason every admin service
 * with a navigation badge is: the queue's definition of "open" lives next to
 * the workflow that moves those statuses.
 */
@Module({
  imports: [AuthModule, AdminAuthModule],
  controllers: [AdminPrivacyController],
  providers: [AdminPrivacyService, ErasureService],
  exports: [AdminPrivacyService],
})
export class PrivacyModule {}
