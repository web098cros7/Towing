import { Inject, Injectable } from '@nestjs/common';
import { rupeeStringToPaise, type Band } from '@towing/api-contracts';
import { asc, eq } from 'drizzle-orm';
import { CacheService } from '../../common/cache/cache.service';
import { DB, type Database } from '../../db/db.module';
import { chargeConfig, commissionConfig, pricingRules } from '../../db/schema';
import {
  DEFAULT_CHARGE_CONFIG,
  DEFAULT_PRICING_RULES,
  type ChargeConfigValues,
  type DistanceBandRule,
  type PricingRuleSet,
  type VehicleClass,
} from './pricing.math';

/**
 * Loads the §7 rate card out of `pricing_rules`, `charge_config` and
 * `commission_config`, in the shape `pricing.math.ts` walks.
 *
 * CACHED, BECAUSE THIS IS ON THE ESTIMATE HOT PATH. Three queries per estimate
 * inside §19.1's 200 ms p95 budget is three too many when the answer changes a
 * handful of times a year. The TTL is short and every admin write calls
 * `invalidate()`, so an edit is visible immediately rather than up to a TTL
 * later — §6.7's "no deploy needed" is not satisfied by "no deploy, but wait
 * five minutes".
 *
 * IT FALLS BACK TO THE CODE DEFAULTS RATHER THAN THROWING. An empty
 * `pricing_rules` — a fresh database, a botched seed — would otherwise turn
 * every fare quote into a 500. The defaults ARE the launch matrix, so the
 * fallback prices correctly; it is only wrong in that an admin's edits are not
 * reflected, which is the better of the two failures.
 */
const RATE_CARD_CACHE_KEY = 'pricing:rate-card:v1';
const RATE_CARD_TTL_SECONDS = 300;

export interface RateCard {
  rules: PricingRuleSet;
  charges: ChargeConfigValues;
  /** §3.3 percentages as configured. Falls back to `BAND_PCT` when unseeded. */
  commissionPct: Record<Band, number>;
}

@Injectable()
export class PricingConfigRepo {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly cache: CacheService,
  ) {}

  async load(): Promise<RateCard> {
    return this.cache.getOrSet(RATE_CARD_CACHE_KEY, RATE_CARD_TTL_SECONDS, () => this.read());
  }

  /** Called by every admin write. §6.7 means "no deploy", not "eventually". */
  async invalidate(): Promise<void> {
    await this.cache.invalidate(RATE_CARD_CACHE_KEY);
  }

  private async read(): Promise<RateCard> {
    const [ruleRows, chargeRows, commissionRows] = await Promise.all([
      this.db
        .select()
        .from(pricingRules)
        .where(eq(pricingRules.isActive, true))
        .orderBy(asc(pricingRules.maxKm)),
      this.db.select().from(chargeConfig).limit(1),
      this.db.select().from(commissionConfig),
    ]);

    return {
      rules: toRuleSet(ruleRows),
      charges: toChargeValues(chargeRows[0]),
      commissionPct: toCommissionPct(commissionRows),
    };
  }
}

type RuleRow = typeof pricingRules.$inferSelect;
type ChargeRow = typeof chargeConfig.$inferSelect;
type CommissionRow = typeof commissionConfig.$inferSelect;

function toRuleSet(rows: RuleRow[]): PricingRuleSet {
  if (rows.length === 0) return DEFAULT_PRICING_RULES;

  const slabs: Record<VehicleClass, DistanceBandRule[]> = { wheel_lift: [], flatbed: [] };
  const longDistance: DistanceBandRule[] = [];
  const roadside: PricingRuleSet['roadside'] = {};

  for (const row of rows) {
    if (row.ruleKind === 'roadside') {
      if (row.serviceType) roadside[row.serviceType] = rupeeStringToPaise(row.price);
      continue;
    }

    // The `ck_pricing_rules_shape` CHECK guarantees these are non-null for
    // slab/long_distance rows; the guard is here so a hand-edited database
    // cannot produce a NaN band boundary that silently sorts first.
    if (!row.vehicleClass || row.maxKm === null) continue;

    const rule: DistanceBandRule = {
      maxKm: Number(row.maxKm),
      pricePaise: rupeeStringToPaise(row.price),
      priceMaxPaise: row.priceMax === null ? null : rupeeStringToPaise(row.priceMax),
    };

    if (row.ruleKind === 'long_distance') longDistance.push(rule);
    else slabs[row.vehicleClass].push(rule);
  }

  // `baseFarePaise` walks these with `.find()` and takes the first match, so
  // ascending order is load-bearing, not cosmetic. The SQL already orders by
  // `max_km`, but a NUMERIC sort and a JS number sort are not the same function
  // and this file is where the JS contract is owned.
  const byMaxKm = (a: DistanceBandRule, b: DistanceBandRule) => a.maxKm - b.maxKm;
  slabs.wheel_lift.sort(byMaxKm);
  slabs.flatbed.sort(byMaxKm);
  longDistance.sort(byMaxKm);

  return {
    slabs: {
      wheel_lift: slabs.wheel_lift.length ? slabs.wheel_lift : DEFAULT_PRICING_RULES.slabs.wheel_lift,
      flatbed: slabs.flatbed.length ? slabs.flatbed : DEFAULT_PRICING_RULES.slabs.flatbed,
    },
    longDistance: longDistance.length ? longDistance : DEFAULT_PRICING_RULES.longDistance,
    roadside: Object.keys(roadside).length ? roadside : DEFAULT_PRICING_RULES.roadside,
  };
}

function toChargeValues(row: ChargeRow | undefined): ChargeConfigValues {
  if (!row) return DEFAULT_CHARGE_CONFIG;
  return {
    nightPct: Number(row.nightPct),
    nightStartHour: row.nightStartHour,
    nightEndHour: row.nightEndHour,
    highwayChargePaise: rupeeStringToPaise(row.highwayCharge),
    accidentChargePaise: rupeeStringToPaise(row.accidentCharge),
    waitingFreeMinutes: row.waitingFreeMinutes,
    waitingPerMinutePaise: rupeeStringToPaise(row.waitingPerMinute),
    surgePctHigh: Number(row.surgePctHigh),
    surgePctPeak: Number(row.surgePctPeak),
    haversineRoadFactor: Number(row.haversineRoadFactor),
    taxPct: Number(row.taxPct),
    taxLabel: row.taxLabel,
    cancelFreeMinutes: row.cancelFreeMinutes,
    cancelPartialMinutes: row.cancelPartialMinutes,
    cancelPartialFeePaise: rupeeStringToPaise(row.cancelPartialFee),
    cancelDriverCompPct: Number(row.cancelDriverCompPct),
    payoutAutoApproveMaxPaise: rupeeStringToPaise(row.payoutAutoApproveMax),
  };
}

function toCommissionPct(rows: CommissionRow[]): Record<Band, number> {
  // Start from the §3.3 launch defaults so a partially-seeded table cannot leave
  // a band undefined and multiply a fare by NaN.
  const pct: Record<Band, number> = { A: 10, B: 8, C: 5 };
  for (const row of rows) pct[row.band] = Number(row.pct);
  return pct;
}
