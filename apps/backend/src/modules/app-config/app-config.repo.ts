import { Inject, Injectable } from '@nestjs/common';
import type { AppConfig } from '@towing/api-contracts';
import { CacheService } from '../../common/cache/cache.service';
import { DB, type Database } from '../../db/db.module';
import { appConfig } from '../../db/schema';

/**
 * W12 — the ONE reader of `app_config`, shared by the public endpoint and the
 * admin screen so a banner preview cannot disagree with the banner.
 *
 * CACHED, because a client asks for this at launch and on every resume: it is
 * the highest-read config endpoint in the product and it changes a handful of
 * times a year. Every admin write invalidates, so §19.9's "SEV-1 → banner in
 * the apps" is measured in the next request rather than in a TTL.
 *
 * FALLS BACK TO THE CODE DEFAULTS when the row is missing: a fresh or
 * half-seeded database must serve "no banner, nothing blocked", not a 500 to
 * every handset trying to start.
 */
const CACHE_KEY = 'app-config:v1';
const TTL_SECONDS = 60;

export const APP_CONFIG_DEFAULTS: AppConfig = {
  minCustomerVersion: '1.0.0',
  minDriverVersion: '1.0.0',
  forceUpgrade: false,
  sevLevel: null,
  sevMessage: null,
  sevUpdatedAt: null,
};

@Injectable()
export class AppConfigRepo {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly cache: CacheService,
  ) {}

  async load(): Promise<AppConfig> {
    return this.cache.getOrSet(CACHE_KEY, TTL_SECONDS, async () => {
      const [row] = await this.db.select().from(appConfig).limit(1);
      if (!row) return { ...APP_CONFIG_DEFAULTS };

      return {
        minCustomerVersion: row.minCustomerVersion,
        minDriverVersion: row.minDriverVersion,
        forceUpgrade: row.forceUpgrade,
        sevLevel: row.sevLevel as AppConfig['sevLevel'],
        sevMessage: row.sevMessage,
        sevUpdatedAt: row.sevUpdatedAt?.toISOString() ?? null,
      };
    });
  }

  async invalidate(): Promise<void> {
    await this.cache.invalidate(CACHE_KEY);
  }

  /**
   * A weak ETag over the payload that matters.
   *
   * DERIVED FROM THE VALUES, not from `updated_at`: a write that changes nothing
   * (the form re-saving an unchanged banner) must not invalidate every client's
   * copy, and two databases that hold the same config should present the same
   * tag. It is weak (`W/`) because the representation this guards is a JSON body
   * any intermediary may re-serialise.
   */
  etag(config: AppConfig): string {
    const fingerprint = JSON.stringify([
      config.minCustomerVersion,
      config.minDriverVersion,
      config.forceUpgrade,
      config.sevLevel,
      config.sevMessage,
      config.sevUpdatedAt,
    ]);
    let hash = 0;
    for (let index = 0; index < fingerprint.length; index += 1) {
      hash = (hash * 31 + fingerprint.charCodeAt(index)) | 0;
    }
    return `W/"ac-${(hash >>> 0).toString(16)}"`;
  }
}
