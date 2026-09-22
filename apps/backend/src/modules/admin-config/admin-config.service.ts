import { Inject, Injectable } from '@nestjs/common';
import {
  COMMISSION_PCT_CAP,
  COMMISSION_PCT_FLOOR,
  commissionPaiseAtPct,
  paiseToRupeeString,
  rupeeStringToPaise,
  type AdminCommissionConfig,
  type AdminCommissionGuardrailUpdate,
  type AdminCommissionImpact,
  type AdminCommissionImpactQuery,
  type AdminCommissionProposal,
  type AdminCommissionProposalCreate,
  type AdminCommissionProposalDecision,
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
import { and, asc, desc, eq, gte, inArray, isNotNull } from 'drizzle-orm';
import { ApiException } from '../../common/errors/api-exception';
import { isUniqueViolation } from '../../common/errors/pg-errors';
import { DB, type Database } from '../../db/db.module';
import {
  adminActions,
  bookings,
  chargeConfig,
  commissionConfig,
  commissionConfigHistory,
  commissionGuardrail,
  commissionProposals,
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
    const guardrail = await this.guardrail();

    return {
      bands: rows.map((row) => ({
        band: row.band,
        pct: Number(row.pct),
        updatedAt: row.updatedAt.toISOString(),
        updatedBy: row.updatedBy,
      })),
      floorPct: guardrail.floorPct,
      capPct: guardrail.capPct,
      guardrailUpdatedAt: guardrail.updatedAt?.toISOString() ?? null,
    };
  }

  /**
   * W11 / decision G2 — the §3.3 window is a ROW now, not a constant.
   *
   * Both of the CHECKs that used to enforce 5–10 were relaxed to the absolute
   * outer bound (0 < pct ≤ 30) by migration 0026, because a CHECK cannot read
   * another table and "the window a human may move" cannot be expressed as one.
   * This reader is the enforcement point, and `getCommission` serves it so the
   * form validates against the same numbers the service will.
   *
   * Falls back to the launch constants when the row is missing (a database
   * older than 0026, a botched seed): refusing every commission edit because a
   * config row is absent would turn a seeding problem into an outage.
   */
  private async guardrail(): Promise<{ floorPct: number; capPct: number; updatedAt: Date | null }> {
    const rows = await this.db.select().from(commissionGuardrail).limit(1);
    const row = rows[0];
    if (!row) {
      return { floorPct: COMMISSION_PCT_FLOOR, capPct: COMMISSION_PCT_CAP, updatedAt: null };
    }
    return { floorPct: Number(row.floorPct), capPct: Number(row.capPct), updatedAt: row.updatedAt };
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
   *
   * SINCE W11 the window is read from `commission_guardrail` on every call, so
   * moving it takes effect on the NEXT edit with nothing restarted.
   */
  async updateCommission(
    adminId: string,
    body: AdminCommissionUpdate,
    context: SessionContext,
  ): Promise<AdminCommissionConfig> {
    const { config } = await this.writeCommission(adminId, body.bands, body.reason, context);
    return config;
  }

  /** The one write path both a direct edit and an applied proposal go through. */
  private async writeCommission(
    adminId: string,
    bands: Array<{ band: Band; pct: number }>,
    reason: string | undefined,
    context: SessionContext,
  ): Promise<{ config: AdminCommissionConfig; auditId: string }> {
    const guardrail = await this.guardrail();
    const offenders = bands.filter(({ pct }) => pct < guardrail.floorPct || pct > guardrail.capPct);

    if (offenders.length > 0) {
      await this.audit.record({
        adminId,
        action: 'commission.update.rejected',
        subjectType: 'commission_config',
        subjectId: null,
        before: await this.getCommission(),
        after: null,
        reason: reason ?? null,
        ip: context.ip ?? null,
        userAgent: context.userAgent ?? null,
      });

      throw ApiException.validation(
        `Commission must stay within ${guardrail.floorPct}–${guardrail.capPct}% (§3.3)`,
        {
          bands: offenders.map(({ band, pct }) => ({
            band,
            pct,
            allowed: `${guardrail.floorPct}–${guardrail.capPct}`,
          })),
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
      after: { bands },
      reason: reason ?? null,
      ip: context.ip ?? null,
      userAgent: context.userAgent ?? null,
    });

    await this.db.transaction(async (tx) => {
      for (const { band, pct } of bands) {
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
          reason: reason ?? null,
        });
      }
    });

    await this.pricingConfig.invalidate();
    return { config: await this.getCommission(), auditId };
  }

  /**
   * W11 / decision G2: move the §3.3 window itself. `commission.guardrail`,
   * Super Admin only.
   *
   * A WINDOW THAT EXCLUDES A LIVE RATE IS REFUSED. If Band A charges 10 % and
   * an admin tightens the cap to 9, the platform would be charging a rate its own
   * policy forbids — every subsequent booking write would be a contradiction
   * someone has to reconcile. The refusal is audited like the guardrail's other
   * refusals, and it names the offending bands so the operator knows what to
   * re-rate first.
   *
   * The ABSOLUTE bound (0 < floor < cap ≤ 30) is checked at the schema and again
   * by the DB CHECK; this method owns only the live-data rule.
   */
  async updateGuardrail(
    adminId: string,
    body: AdminCommissionGuardrailUpdate,
    context: SessionContext,
  ): Promise<AdminCommissionConfig> {
    const current = await this.guardrail();
    const live = await this.db.select().from(commissionConfig).orderBy(asc(commissionConfig.band));

    const stranded = live
      .map((row) => ({ band: row.band, pct: Number(row.pct) }))
      .filter(({ pct }) => pct < body.floorPct || pct > body.capPct);

    if (stranded.length > 0) {
      await this.audit.record({
        adminId,
        action: 'commission.guardrail.rejected',
        subjectType: 'commission_config',
        subjectId: null,
        before: { floorPct: current.floorPct, capPct: current.capPct },
        after: null,
        reason: body.reason ?? null,
        ip: context.ip ?? null,
        userAgent: context.userAgent ?? null,
      });

      throw ApiException.validation(
        `A live band would sit outside ${body.floorPct}–${body.capPct}% — re-rate it first`,
        { stranded },
      );
    }

    const before = { floorPct: current.floorPct, capPct: current.capPct };
    // UPSERT, not UPDATE: a database whose row is missing (a `truncateAll` in
    // tests, a reset that raced the seed) must not silently swallow the edit.
    await this.db
      .insert(commissionGuardrail)
      .values({
        floorPct: body.floorPct.toFixed(2),
        capPct: body.capPct.toFixed(2),
        updatedBy: adminId,
      })
      .onConflictDoUpdate({
        target: commissionGuardrail.singleton,
        set: {
          floorPct: body.floorPct.toFixed(2),
          capPct: body.capPct.toFixed(2),
          updatedBy: adminId,
          updatedAt: new Date(),
        },
      });

    await this.audit.record({
      adminId,
      action: 'commission.guardrail.update',
      subjectType: 'commission_config',
      subjectId: null,
      before,
      after: { floorPct: body.floorPct, capPct: body.capPct },
      reason: body.reason ?? null,
      ip: context.ip ?? null,
      userAgent: context.userAgent ?? null,
    });

    return this.getCommission();
  }

  /**
   * §9.4.9's impact preview — "at last week's volume, Band A 10 %→9 % ≈ −₹X".
   *
   * THE NUMBERS ARE ACTUAL, NOT EXTRAPOLATED. For each paid booking in the
   * window the proposed commission is recomputed with `commissionPaiseAtPct`
   * against that booking's own taxable base (`total − tax_amount`, the same
   * quantity the locking path multiplies), so the delta is what the platform
   * would have earned on the bookings it actually did. An average-based
   * projection would be easier and would answer a different question.
   *
   * Read-only, and it takes the percentages from the QUERY rather than the
   * table: it previews an edit the operator has not saved yet.
   */
  async commissionImpact(query: AdminCommissionImpactQuery): Promise<AdminCommissionImpact> {
    const proposed = parseBandParam(query.bands);
    const since = new Date(Date.now() - query.days * 24 * 60 * 60 * 1000);

    const rows = await this.db
      .select({
        band: bookings.commissionBand,
        total: bookings.total,
        taxAmount: bookings.taxAmount,
        commissionAmount: bookings.commissionAmount,
      })
      .from(bookings)
      .where(
        and(
          inArray(bookings.status, ['paid']),
          isNotNull(bookings.commissionBand),
          gte(bookings.createdAt, since),
        ),
      );

    const live = new Map<Band, number>(
      (await this.db.select().from(commissionConfig)).map((row) => [row.band, Number(row.pct)]),
    );

    const byBand = new Map<
      Band,
      { bookings: number; currentPaise: number; proposedPaise: number }
    >();
    for (const row of rows) {
      const band = row.band as Band | null;
      if (!band) continue;
      const taxable = rupeeStringToPaise(row.total) - rupeeStringToPaise(row.taxAmount);
      const proposedPct = proposed.get(band) ?? live.get(band) ?? 0;

      const entry = byBand.get(band) ?? { bookings: 0, currentPaise: 0, proposedPaise: 0 };
      entry.bookings += 1;
      entry.currentPaise += rupeeStringToPaise(row.commissionAmount);
      entry.proposedPaise += commissionPaiseAtPct(taxable, proposedPct);
      byBand.set(band, entry);
    }

    const bands = (['A', 'B', 'C'] as const).map((band) => {
      const entry = byBand.get(band) ?? { bookings: 0, currentPaise: 0, proposedPaise: 0 };
      return {
        band,
        currentPct: live.get(band) ?? 0,
        proposedPct: proposed.get(band) ?? live.get(band) ?? 0,
        bookings: entry.bookings,
        currentPaise: entry.currentPaise,
        proposedPaise: entry.proposedPaise,
        deltaPaise: entry.proposedPaise - entry.currentPaise,
      };
    });

    return {
      days: query.days,
      bands,
      totalCurrentPaise: bands.reduce((sum, band) => sum + band.currentPaise, 0),
      totalProposedPaise: bands.reduce((sum, band) => sum + band.proposedPaise, 0),
      totalDeltaPaise: bands.reduce((sum, band) => sum + band.deltaPaise, 0),
    };
  }

  /** §4.2's Operations ⚠️ — propose, with a reason; never set. */
  async createCommissionProposal(
    adminId: string,
    body: AdminCommissionProposalCreate,
    context: SessionContext,
  ): Promise<AdminCommissionProposal> {
    let created: CommissionProposalRow;
    try {
      const inserted = await this.db
        .insert(commissionProposals)
        .values({
          band: body.band,
          pct: body.pct.toFixed(2),
          proposedBy: adminId,
          reason: body.reason,
        })
        .returning();
      created = inserted[0]!;
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw ApiException.conflict(`Band ${body.band} already has an open proposal`, {
          band: body.band,
        });
      }
      throw error;
    }

    await this.audit.record({
      adminId,
      action: 'commission.proposal.created',
      subjectType: 'commission_config',
      subjectId: created.id,
      before: null,
      after: { band: body.band, pct: body.pct, reason: body.reason },
      ip: context.ip ?? null,
      userAgent: context.userAgent ?? null,
    });

    return toProposal(created);
  }

  async listCommissionProposals(): Promise<AdminCommissionProposal[]> {
    const rows = await this.db
      .select()
      .from(commissionProposals)
      .orderBy(desc(commissionProposals.createdAt))
      .limit(100);
    return rows.map(toProposal);
  }

  /**
   * Apply = the ORDINARY write path, so a proposal cannot become a rate that
   * bypassed the guardrail. If the window moved between proposal and decision,
   * the apply is refused with the same 422 a hand-typed edit would get — and
   * that refusal is audited by `writeCommission`.
   */
  async applyCommissionProposal(
    adminId: string,
    proposalId: string,
    body: AdminCommissionProposalDecision,
    context: SessionContext,
  ): Promise<AdminCommissionConfig> {
    const proposal = await this.openProposal(proposalId);

    const { config, auditId } = await this.writeCommission(
      adminId,
      [{ band: proposal.band, pct: Number(proposal.pct) }],
      body.reason ?? proposal.reason,
      context,
    );

    await this.db
      .update(commissionProposals)
      .set({
        status: 'applied',
        decidedBy: adminId,
        decidedAt: new Date(),
        adminActionId: auditId,
        updatedAt: new Date(),
      })
      .where(eq(commissionProposals.id, proposalId));

    await this.audit.record({
      adminId,
      action: 'commission.proposal.applied',
      subjectType: 'commission_config',
      subjectId: proposalId,
      before: { status: 'open', band: proposal.band, pct: Number(proposal.pct) },
      after: { status: 'applied', adminActionId: auditId },
      reason: body.reason ?? null,
      ip: context.ip ?? null,
      userAgent: context.userAgent ?? null,
    });

    return config;
  }

  async declineCommissionProposal(
    adminId: string,
    proposalId: string,
    body: AdminCommissionProposalDecision,
    context: SessionContext,
  ): Promise<void> {
    const proposal = await this.openProposal(proposalId);

    await this.db
      .update(commissionProposals)
      .set({
        status: 'declined',
        decidedBy: adminId,
        decidedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(commissionProposals.id, proposalId));

    await this.audit.record({
      adminId,
      action: 'commission.proposal.declined',
      subjectType: 'commission_config',
      subjectId: proposalId,
      before: { status: 'open', band: proposal.band, pct: Number(proposal.pct) },
      after: { status: 'declined' },
      reason: body.reason ?? null,
      ip: context.ip ?? null,
      userAgent: context.userAgent ?? null,
    });
  }

  private async openProposal(proposalId: string): Promise<CommissionProposalRow> {
    const rows = await this.db
      .select()
      .from(commissionProposals)
      .where(eq(commissionProposals.id, proposalId))
      .limit(1);
    const proposal = rows[0];
    if (!proposal) throw ApiException.notFound('Proposal not found');
    if (proposal.status !== 'open') {
      throw ApiException.conflict(`Proposal is already ${proposal.status}`, {
        status: proposal.status,
      });
    }
    return proposal;
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
type CommissionProposalRow = typeof commissionProposals.$inferSelect;

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

function toProposal(row: CommissionProposalRow): AdminCommissionProposal {
  return {
    id: row.id,
    band: row.band,
    pct: Number(row.pct),
    proposedBy: row.proposedBy,
    reason: row.reason,
    status: row.status as AdminCommissionProposal['status'],
    decidedBy: row.decidedBy,
    decidedAt: row.decidedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * `A:9,B:8,C:5` → a map. The schema's regex has already refused anything else,
 * so a parse failure here is a programming error, not a request error.
 */
function parseBandParam(param: string): Map<Band, number> {
  const result = new Map<Band, number>();
  for (const pair of param.split(',')) {
    const [band, pct] = pair.split(':');
    result.set(band as Band, Number(pct));
  }
  return result;
}
