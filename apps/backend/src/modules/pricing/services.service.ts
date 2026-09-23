import { Inject, Injectable } from '@nestjs/common';
import type { ServiceCatalogItem } from '@towing/api-contracts';
import { asc, eq } from 'drizzle-orm';
import { CacheService } from '../../common/cache/cache.service';
import { ApiException } from '../../common/errors/api-exception';
import { DB, type Database } from '../../db/db.module';
import { services } from '../../db/schema';
import { PricingConfigRepo } from './pricing-config.repo';
import { isRoadsideService } from './pricing.math';

/**
 * `GET /v1/services` (§16.2) — Appendix B's nine-entry catalogue.
 *
 * Replaces TowGo's static `services.data.ts` and the tow-type prices in
 * `towTypes.data.ts`, whose own comment said they "become the estimate API
 * later".
 *
 * Cached like the rate card: the catalogue changes when a human edits it, and
 * every estimate resolves a slug through it.
 */
const CATALOG_CACHE_KEY = 'pricing:services:v1';
const CATALOG_TTL_SECONDS = 300;

@Injectable()
export class ServicesService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly cache: CacheService,
    private readonly pricing: PricingConfigRepo,
  ) {}

  /**
   * The active catalogue, minus any roadside service nobody has priced.
   *
   * A roadside service exists in the catalogue BEFORE it has a fare: Winch Out
   * was added that way on purpose, so it could ship without a made-up price and
   * go live the moment an admin sets one. Listing it unpriced would put a tile
   * on the customer's home screen that fails at the estimate, so it stays off
   * the list until its fare row is active — and comes back off it if an admin
   * retires the fare.
   *
   * The filter runs OUTSIDE the catalogue cache, against the rate card, which
   * every admin pricing write invalidates. Inside it, a newly priced service
   * would stay hidden for up to five minutes after the admin was told "saved".
   */
  async list(): Promise<ServiceCatalogItem[]> {
    const [catalogue, rateCard] = await Promise.all([this.activeRows(), this.pricing.load()]);
    return catalogue.filter(
      (item) =>
        !isRoadsideService(item.serviceType) ||
        rateCard.rules.roadside[item.serviceType] !== undefined,
    );
  }

  private activeRows(): Promise<ServiceCatalogItem[]> {
    return this.cache.getOrSet(CATALOG_CACHE_KEY, CATALOG_TTL_SECONDS, async () => {
      const rows = await this.db
        .select()
        .from(services)
        .where(eq(services.isActive, true))
        .orderBy(asc(services.displayOrder));

      return rows.map((row) => ({
        slug: row.slug,
        serviceType: row.serviceType,
        defaultVehicleClass: row.defaultVehicleClass,
        name: row.name,
        description: row.description,
        requiresDrop: row.requiresDrop,
        displayOrder: row.displayOrder,
      }));
    });
  }

  /**
   * Resolve a catalogue slug for the estimate route.
   *
   * An unknown or deactivated slug is a 422, not a fall-back-to-`tow`. A client
   * holding a stale catalogue must be told, because silently pricing a `bike_tow`
   * request as a car tow bills the customer for the wrong service.
   */
  async requireBySlug(slug: string): Promise<ServiceCatalogItem> {
    const item = (await this.list()).find((service) => service.slug === slug);
    if (!item) {
      throw ApiException.validation(`Unknown service "${slug}"`, {
        serviceSlug: 'not in the active catalogue',
      });
    }
    return item;
  }

  async invalidate(): Promise<void> {
    await this.cache.invalidate(CATALOG_CACHE_KEY);
  }
}
