import { Inject, Injectable } from '@nestjs/common';
import { GLOBAL_DISPATCH_CONFIG_DEFAULTS, type GlobalDispatchConfig } from '@towing/api-contracts';
import { CacheService } from '../../common/cache/cache.service';
import { DB, type Database } from '../../db/db.module';
import { dispatchConfig } from '../../db/schema';

/**
 * The global half of §6.7 — the `dispatch_config` singleton.
 *
 * Phase 14 created and seeded this table and, deliberately, left it with no
 * reader: its consumers are the §3.8 booking guards (here, Phase 15) and the
 * §6.2 scorer (Phase 17). This is the first of them. The column docblock says
 * so outright: "Read by Phase 15's booking-creation guard."
 *
 * Falls back to the code defaults rather than throwing when the row is missing.
 * A fresh or half-seeded database should refuse bookings by the documented
 * rules, not refuse them with a 500.
 */
const CACHE_KEY = 'dispatch:global-config:v1';
const TTL_SECONDS = 300;

export interface BookingGuardConfig extends GlobalDispatchConfig {
  /** §3.8's "admin-configurable" unpaid-balance block. */
  blockOnUnpaidBalance: boolean;
}

@Injectable()
export class DispatchConfigRepo {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly cache: CacheService,
  ) {}

  async load(): Promise<BookingGuardConfig> {
    return this.cache.getOrSet(CACHE_KEY, TTL_SECONDS, async () => {
      const [row] = await this.db.select().from(dispatchConfig).limit(1);
      if (!row) {
        return { ...GLOBAL_DISPATCH_CONFIG_DEFAULTS, blockOnUnpaidBalance: true };
      }

      return {
        weights: {
          proximity: Number(row.weightProximity),
          rating: Number(row.weightRating),
          acceptance: Number(row.weightAcceptance),
          completion: Number(row.weightCompletion),
        },
        stalePingSeconds: row.stalePingSeconds,
        oneActiveBookingPerCustomer: row.oneActiveBookingPerCustomer,
        blockOnUnpaidBalance: row.blockOnUnpaidBalance,
        // ── W12 ──
        redispatchPriority: row.redispatchPriority as 'front' | 'normal',
        pingOnJobMs: row.pingOnJobMs,
        pingIdleMs: row.pingIdleMs,
        // Raw JSONB out of a cache: validated by the CONSUMER
        // (`resolveDispatchConfig`'s per-service layer takes a `ServiceType`
        // key), so a hand-edited value degrades to "no override", never to a
        // crash on the dispatch path.
        perServiceMaxOffers: (row.perServiceMaxOffers ??
          null) as BookingGuardConfig['perServiceMaxOffers'],
      };
    });
  }

  /** §6.7 means "no deploy", not "no deploy but wait for a TTL". */
  async invalidate(): Promise<void> {
    await this.cache.invalidate(CACHE_KEY);
  }
}
