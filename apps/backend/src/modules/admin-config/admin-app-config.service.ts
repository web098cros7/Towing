import { Inject, Injectable } from '@nestjs/common';
import type { AdminAppConfigUpdate, AppConfig } from '@towing/api-contracts';
import { eq } from 'drizzle-orm';
import { DB, type Database } from '../../db/db.module';
import { appConfig } from '../../db/schema';
import { AdminAuditService } from '../admin-auth/admin-audit.service';
import { AppConfigRepo } from '../app-config/app-config.repo';
import type { SessionContext } from '../auth/token.service';

/**
 * W12's `GET/PUT /v1/admin/app-config` — §19.8's version gate and §19.9's SEV
 * banner, editable from the console.
 *
 * THE READ GOES THROUGH `AppConfigRepo`, the SAME cached reader the public
 * endpoint uses. The console's banner preview is therefore the object the
 * handsets will fetch, not a second mapping of the row that agrees with it
 * today.
 *
 * WHY A BANNER IS WORTH A CONFIRMATION. A SEV-1 message reaches every customer
 * with the app open — it is the closest thing this product has to a broadcast,
 * and it cannot be unsent. The console asks for an explicit confirmation before
 * raising one; the audit row records who raised it and what it said.
 */
@Injectable()
export class AdminAppConfigService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AdminAuditService,
    private readonly repo: AppConfigRepo,
  ) {}

  get(): Promise<AppConfig> {
    return this.repo.load();
  }

  async update(
    adminId: string,
    body: AdminAppConfigUpdate,
    context: SessionContext,
  ): Promise<AppConfig> {
    const before = await this.repo.load();

    // Every field is optional and checked against `undefined`, so `null` stays
    // a VALUE (clearing the banner) rather than an omission.
    const values = {
      ...(body.minCustomerVersion !== undefined
        ? { minCustomerVersion: body.minCustomerVersion }
        : {}),
      ...(body.minDriverVersion !== undefined ? { minDriverVersion: body.minDriverVersion } : {}),
      ...(body.forceUpgrade !== undefined ? { forceUpgrade: body.forceUpgrade } : {}),
      ...(body.sevLevel !== undefined ? { sevLevel: body.sevLevel } : {}),
      ...(body.sevMessage !== undefined ? { sevMessage: body.sevMessage } : {}),
      // Raising OR clearing the banner both stamp the moment it moved — the
      // apps show "as of" on the banner, and a cleared one has no other marker.
      ...(body.sevLevel !== undefined || body.sevMessage !== undefined
        ? { sevUpdatedAt: body.sevLevel === null ? null : new Date() }
        : {}),
      updatedAt: new Date(),
    };

    const [existing] = await this.db.select({ id: appConfig.id }).from(appConfig).limit(1);
    if (existing) {
      await this.db.update(appConfig).set(values).where(eq(appConfig.id, existing.id));
    } else {
      // A database that never had the row (a `truncateAll` in tests, an unseeded
      // environment) must not silently swallow the edit.
      await this.db.insert(appConfig).values(values);
    }

    // ORDER MATTERS: invalidate BEFORE reading `after`, or the cached `before`
    // value comes straight back and the audit row says nothing changed.
    await this.repo.invalidate();
    const after = await this.repo.load();

    await this.audit.record({
      adminId,
      action: 'app_config.update',
      subjectType: 'app_config',
      subjectId: null,
      before,
      after,
      reason: body.reason ?? null,
      ip: context.ip ?? null,
      userAgent: context.userAgent ?? null,
    });

    return after;
  }
}
