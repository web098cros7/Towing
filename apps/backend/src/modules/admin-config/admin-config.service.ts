import { Inject, Injectable } from '@nestjs/common';
import {
  COMMISSION_PCT_CAP,
  COMMISSION_PCT_FLOOR,
  paiseToRupeeString,
  rupeeStringToPaise,
  type AdminCommissionConfig,
  type AdminCommissionUpdate,
  type AdminPricingConfig,
  type AdminPricingHistoryEntry,
  type AdminPricingRule,
  type AdminPricingRuleCreate,
  type AdminPricingRuleDeactivate,
  type AdminPricingUpdate,
  type Band,
  type CommissionHistoryEntry,
} from '@towing/api-contracts';
import { asc, desc, eq } from 'drizzle-orm';
import { ApiException } from '../../common/errors/api-exception';
import { isUniqueViolation } from '../../common/errors/pg-errors';
import { DB, type Database } from '../../db/db.module';
import {
  adminActions,
  chargeConfig,
  commissionConfig,
  commissionConfigHistory,
  pricingRules,
} from '../../db/schema';
import { AdminAuditService } from '../admin-auth/admin-audit.service';
import type { SessionContext } from '../auth/token.service';
import { PricingConfigRepo } from '../pricing/pricing-config.repo';

/**
 * §16.5 `GET/PUT /v1/admin/pricing` and `GET/PUT /v1/admin/commission`.
 *
 * WHY THESE EXIST IN PHASE 14 RATHER THAN 20 (where the forms land): the §3.3
 * guardrail needs a way to be exercised. Phase 14 builds the floor/cap check,
 * the `ck_commission_config_guardrail` CHECK and `commission_config_history`;
 * without a route, none of the three could ever be tripped and "validated
 * server-side, rejected and audited" would be an untested claim.
 *
 * EVERY WRITE INVALIDATES THE PRICING CACHE. §6.7 says these knobs change with
 * no deploy; a five-minute TTL between an admin's save and the fare it changes
 * is not what that promises.
 */
@Injectable()
export class AdminConfigService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AdminAuditService,
    private readonly pricingConfig: PricingConfigRepo,
  ) {}

  async getPricing(): Promise<AdminPricingConfig> {
    const [charges] = await this.db.select().from(chargeConfig).limit(1);
    if (!charges) {
      throw ApiException.conflict('Pricing is not configured — run the seed');
    }

    const rules = await this.db.select().from(pricingRules).orderBy(asc(pricingRules.maxKm));

    return {
      charges: {
        nightPct: Number(charges.nightPct),
        nightStartHour: charges.nightStartHour,
        nightEndHour: charges.nightEndHour,
        highwayChargePaise: rupeeStringToPaise(charges.highwayCharge),
        accidentChargePaise: rupeeStringToPaise(charges.accidentCharge),
        waitingFreeMinutes: charges.waitingFreeMinutes,
        waitingPerMinutePaise: rupeeStringToPaise(charges.waitingPerMinute),
        surgePctHigh: Number(charges.surgePctHigh),
        surgePctPeak: Number(charges.surgePctPeak),
        haversineRoadFactor: Number(charges.haversineRoadFactor),
      },
      rules: rules.map(toPricingRule),
    };
  }

  async updatePricing(
    adminId: string,
    body: AdminPricingUpdate,
    context: SessionContext,
  ): Promise<AdminPricingConfig> {
    const before = await this.getPricing();

    await this.db.transaction(async (tx) => {
      if (body.charges) {
        const c = body.charges;
        await tx
          .update(chargeConfig)
          .set({
            ...(c.nightPct !== undefined ? { nightPct: c.nightPct.toFixed(2) } : {}),
            ...(c.nightStartHour !== undefined ? { nightStartHour: c.nightStartHour } : {}),
            ...(c.nightEndHour !== undefined ? { nightEndHour: c.nightEndHour } : {}),
            ...(c.highwayChargePaise !== undefined
              ? { highwayCharge: paiseToRupeeString(c.highwayChargePaise) }
              : {}),
            ...(c.accidentChargePaise !== undefined
              ? { accidentCharge: paiseToRupeeString(c.accidentChargePaise) }
              : {}),
            ...(c.waitingFreeMinutes !== undefined
              ? { waitingFreeMinutes: c.waitingFreeMinutes }
              : {}),
            ...(c.waitingPerMinutePaise !== undefined
              ? { waitingPerMinute: paiseToRupeeString(c.waitingPerMinutePaise) }
              : {}),
            ...(c.surgePctHigh !== undefined ? { surgePctHigh: c.surgePctHigh.toFixed(2) } : {}),
            ...(c.surgePctPeak !== undefined ? { surgePctPeak: c.surgePctPeak.toFixed(2) } : {}),
            ...(c.haversineRoadFactor !== undefined
              ? { haversineRoadFactor: c.haversineRoadFactor.toFixed(2) }
              : {}),
            updatedAt: new Date(),
          })
          .where(eq(chargeConfig.singleton, true));
      }

      for (const rule of body.rules ?? []) {
        await tx
          .update(pricingRules)
          .set({
            ...(rule.pricePaise !== undefined
              ? { price: paiseToRupeeString(rule.pricePaise) }
              : {}),
            ...(rule.priceMaxPaise !== undefined
              ? {
                  priceMax:
                    rule.priceMaxPaise === null ? null : paiseToRupeeString(rule.priceMaxPaise),
                }
              : {}),
            ...(rule.isActive !== undefined ? { isActive: rule.isActive } : {}),
            updatedAt: new Date(),
          })
          .where(eq(pricingRules.id, rule.id));
      }
    });

    const after = await this.getPricing();

    await this.audit.record({
      adminId,
      action: 'pricing.update',
      subjectType: 'pricing_config',
      subjectId: null,
      before,
      after,
      reason: body.reason ?? null,
      ip: context.ip ?? null,
      userAgent: context.userAgent ?? null,
    });

    await this.pricingConfig.invalidate();
    return after;
  }

  /**
   * W10: add a slab, a §7.3 range or a flat fare. Before this, the matrices
   * were unextendable — `adminPricingUpdateSchema` edits rows by id, and a fare
   * table you cannot add a row to is a snapshot, not a rate card.
   *
   * A DUPLICATE ACTIVE BAND IS A 409, NOT A 500 FROM POSTGRES.
   * `uq_pricing_rules_distance_band` and `uq_pricing_rules_roadside` are
   * PARTIAL on `is_active`, so a collision is a business fact ("wheel-lift
   * already has a 10 km slab") rather than a schema error — deactivating the
   * old row is the documented way to reuse a band, and the conflict message
   * says so.
   *
   * The whole before/after lives in the audit row, which is also the version
   * history `pricingHistory` reads back. No separate version table.
   */
  async createPricingRule(
    adminId: string,
    body: AdminPricingRuleCreate,
    context: SessionContext,
  ): Promise<AdminPricingRule> {
    let created: PricingRuleRow;
    try {
      const inserted = await this.db
        .insert(pricingRules)
        .values({
          ruleKind: body.ruleKind,
          serviceType: body.serviceType ?? null,
          vehicleClass: body.vehicleClass ?? null,
          maxKm: body.maxKm == null ? null : body.maxKm.toFixed(2),
          price: paiseToRupeeString(body.pricePaise),
          priceMax: body.priceMaxPaise == null ? null : paiseToRupeeString(body.priceMaxPaise),
        })
        .returning();

      created = inserted[0]!;
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw ApiException.conflict(
          'An active rule already covers that band — edit or deactivate it instead',
          {
            ruleKind: body.ruleKind,
            vehicleClass: body.vehicleClass ?? null,
            maxKm: body.maxKm ?? null,
            serviceType: body.serviceType ?? null,
          },
        );
      }
      throw error;
    }

    const dto = toPricingRule(created);

    await this.audit.record({
      adminId,
      action: 'pricing.rule.create',
      subjectType: 'pricing_config',
      subjectId: dto.id,
      before: null,
      after: dto,
      reason: body.reason ?? null,
      ip: context.ip ?? null,
      userAgent: context.userAgent ?? null,
    });

    await this.pricingConfig.invalidate();
    return dto;
  }

  /**
   * W10 "retire a slab" — DEACTIVATE, never hard-delete. A deleted row would
   * orphan the audit trail's reference and silently rewrite what an old booking
   * was priced against; `is_active = false` takes the rule out of the rate card
   * (`PricingConfigRepo.read` filters on it) while the history stays coherent.
   *
   * IDEMPOTENT BY DESIGN: a double-tapped button must not write a second audit
   * row for a state that is already true, so an already-inactive rule is
   * returned untouched.
   *
   * Existing bookings keep their locked fare — locking reads the rate card once,
   * at confirm, and stores the numbers (§7.5).
   */
  async deactivatePricingRule(
    adminId: string,
    ruleId: string,
    body: AdminPricingRuleDeactivate,
    context: SessionContext,
  ): Promise<AdminPricingRule> {
    const rows = await this.db
      .select()
      .from(pricingRules)
      .where(eq(pricingRules.id, ruleId))
      .limit(1);
    const existing = rows[0];
    if (!existing) throw ApiException.notFound('Pricing rule not found');
    if (!existing.isActive) return toPricingRule(existing);

    const updated = await this.db
      .update(pricingRules)
      .set({ isActive: false, updatedAt: new Date() })
      .where(eq(pricingRules.id, ruleId))
      .returning();
    const dto = toPricingRule(updated[0]!);

    await this.audit.record({
      adminId,
      action: 'pricing.rule.deactivate',
      subjectType: 'pricing_config',
      subjectId: ruleId,
      before: toPricingRule(existing),
      after: dto,
      reason: body.reason ?? null,
      ip: context.ip ?? null,
      userAgent: context.userAgent ?? null,
    });

    await this.pricingConfig.invalidate();
    return dto;
  }

  /** §9.4.8's "saved (versioned)" — the audit rows, read back as a feed. */
  async pricingHistory(limit = 50): Promise<AdminPricingHistoryEntry[]> {
    const rows = await this.db
      .select()
      .from(adminActions)
      .where(eq(adminActions.subjectType, 'pricing_config'))
      .orderBy(desc(adminActions.createdAt), desc(adminActions.id))
      .limit(limit);

    return rows.map((row) => ({
      id: row.id,
      adminId: row.adminId,
      action: row.action,
      reason: row.reason,
      before: row.before ?? null,
      after: row.after ?? null,
      createdAt: row.createdAt.toISOString(),
    }));
  }

  async getCommission(): Promise<AdminCommissionConfig> {
    const rows = await this.db.select().from(commissionConfig).orderBy(asc(commissionConfig.band));

    return {
      bands: rows.map((row) => ({
        band: row.band,
        pct: Number(row.pct),
        updatedAt: row.updatedAt.toISOString(),
        updatedBy: row.updatedBy,
      })),
      floorPct: COMMISSION_PCT_FLOOR,
      capPct: COMMISSION_PCT_CAP,
    };
  }

  /**
   * §3.3: "admin edits are validated server-side against the floor/cap (5%/10%
   * at launch); attempts outside the band are REJECTED AND AUDITED."
   *
   * BOTH HALVES OF THAT SENTENCE MATTER, AND THE ORDER IS LOAD-BEARING. The
   * audit row for a rejected attempt has to be written BEFORE the throw and
   * OUTSIDE any transaction the throw would roll back — otherwise the rejection
   * is enforced but invisible, and "audited" is a claim the code contradicts.
   * Someone probing the fare engine's limits is exactly what an audit log is
   * for.
   *
   * `adminCommissionUpdateSchema` normally rejects an out-of-band value at the
   * pipe, so this branch is reached only by a caller that bypassed the schema —
   * a future internal caller, a hand-rolled request. It is the backstop, and it
   * is tested by calling the service directly.
   */
  async updateCommission(
    adminId: string,
    body: AdminCommissionUpdate,
    context: SessionContext,
  ): Promise<AdminCommissionConfig> {
    const offenders = body.bands.filter(
      ({ pct }) => pct < COMMISSION_PCT_FLOOR || pct > COMMISSION_PCT_CAP,
    );

    if (offenders.length > 0) {
      await this.audit.record({
        adminId,
        action: 'commission.update.rejected',
        subjectType: 'commission_config',
        subjectId: null,
        before: await this.getCommission(),
        after: null,
        reason: body.reason ?? null,
        ip: context.ip ?? null,
        userAgent: context.userAgent ?? null,
      });

      throw ApiException.validation(
        `Commission must stay within ${COMMISSION_PCT_FLOOR}–${COMMISSION_PCT_CAP}% (§3.3)`,
        {
          bands: offenders.map(({ band, pct }) => ({ band, pct, allowed: '5–10' })),
        },
      );
    }

    const before = await this.getCommission();
    const previous = new Map<Band, number>(before.bands.map((b) => [b.band, b.pct]));

    const auditId = await this.audit.record({
      adminId,
      action: 'commission.update',
      subjectType: 'commission_config',
      subjectId: null,
      before,
      after: { bands: body.bands },
      reason: body.reason ?? null,
      ip: context.ip ?? null,
      userAgent: context.userAgent ?? null,
    });

    await this.db.transaction(async (tx) => {
      for (const { band, pct } of body.bands) {
        await tx
          .update(commissionConfig)
          .set({ pct: pct.toFixed(2), updatedBy: adminId, updatedAt: new Date() })
          .where(eq(commissionConfig.band, band));

        await tx.insert(commissionConfigHistory).values({
          band,
          oldPct: previous.get(band)?.toFixed(2) ?? null,
          newPct: pct.toFixed(2),
          changedBy: adminId,
          adminActionId: auditId,
          reason: body.reason ?? null,
        });
      }
    });

    await this.pricingConfig.invalidate();
    return this.getCommission();
  }

  async commissionHistory(limit = 50): Promise<CommissionHistoryEntry[]> {
    const rows = await this.db
      .select()
      .from(commissionConfigHistory)
      .orderBy(desc(commissionConfigHistory.createdAt))
      .limit(limit);

    return rows.map((row) => ({
      id: row.id,
      band: row.band,
      oldPct: row.oldPct === null ? null : Number(row.oldPct),
      newPct: Number(row.newPct),
      changedBy: row.changedBy ?? '',
      reason: row.reason,
      createdAt: row.createdAt.toISOString(),
    }));
  }
}

type PricingRuleRow = typeof pricingRules.$inferSelect;

/** One mapping for every reader of `pricing_rules` here — GET, create, deactivate. */
function toPricingRule(rule: PricingRuleRow): AdminPricingRule {
  return {
    id: rule.id,
    ruleKind: rule.ruleKind,
    serviceType: rule.serviceType,
    vehicleClass: rule.vehicleClass,
    maxKm: rule.maxKm === null ? null : Number(rule.maxKm),
    pricePaise: rupeeStringToPaise(rule.price),
    priceMaxPaise: rule.priceMax === null ? null : rupeeStringToPaise(rule.priceMax),
    isActive: rule.isActive,
  };
}
