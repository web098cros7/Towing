import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import {
  ErrorCodes,
  paiseToRupeeString,
  rupeeStringToPaise,
  type AdminFinanceConfigDto,
  type AdminFinanceConfigUpdate,
  type AdminPayoutDto,
  type AdminPayoutsListResponse,
  type AdminPayoutsQuery,
} from '@towing/api-contracts';
import { ApiException } from '../../common/errors/api-exception';
import { DB, type Database } from '../../db/db.module';
import { AdminAuditService } from '../admin-auth/admin-audit.service';
import type { SessionContext } from '../auth/token.service';
import { PricingConfigRepo } from '../pricing/pricing-config.repo';
import { PayoutsRepo } from '../money/payouts.repo';
import { PayoutsService } from '../money/payouts.service';

/**
 * §9.4.10's Finance surface.
 *
 * THE `finance` SUB-ROLE'S FIRST CONSUMER WITH ANY AUTHORITY. It has existed in
 * `AdminSubRole` since Phase 10 with no `@Roles('finance')` anywhere in the
 * codebase; `admin-config` reads and writes settings, but this moves money out
 * of the platform.
 *
 * THE QUEUE COVERS BOTH OWNER TYPES. Fleet payouts bypassed approval entirely
 * from Track A Phase 7 until Phase 19 — bringing them under one threshold
 * rather than leaving a second, unapproved path is the point of §14.4's rule,
 * and it is a behaviour change for existing fleets rather than a new feature.
 */
@Injectable()
export class AdminFinanceService {
  private readonly logger = new Logger(AdminFinanceService.name);

  constructor(
    private readonly repo: PayoutsRepo,
    private readonly payouts: PayoutsService,
    private readonly audit: AdminAuditService,
    private readonly pricingConfig: PricingConfigRepo,
    @Inject(DB) private readonly db: Database,
  ) {}

  /**
   * The queue.
   *
   * Rows carry the owner's NAME and a redacted destination, not just an id and
   * an amount — approving a payout on a UUID alone is not a decision anybody
   * can defend, and a reviewer needs to be able to sanity-check where the money
   * is going.
   */
  async payoutQueue(query: AdminPayoutsQuery): Promise<AdminPayoutsListResponse> {
    const { items, total } = await this.repo.approvalQueue(query);

    if (items.length === 0) {
      return { items: [], page: query.page, limit: query.limit, total };
    }

    const enriched = await this.db.execute(sql`
      select p.id,
             coalesce(f.business_name, d.name) as owner_name,
             a.account_number_last4,
             a.bank_name
        from payouts p
        left join fleets f on p.owner_type = 'fleet' and f.id = p.owner_id
        left join drivers d on p.owner_type = 'driver' and d.id = p.owner_id
        left join payout_accounts a
               on a.owner_type = p.owner_type and a.owner_id = p.owner_id
       where p.id = any(${sql`array[${sql.join(
         items.map((item) => sql`${item.id}::uuid`),
         sql`, `,
       )}]`})
    `);

    const detail = new Map(
      (enriched as unknown as Array<Record<string, unknown>>).map((row) => [
        row.id as string,
        row,
      ]),
    );

    return {
      items: items.map((row): AdminPayoutDto => {
        const extra = detail.get(row.id);
        return {
          id: row.id,
          ownerType: row.ownerType === 'driver' ? 'driver' : 'fleet',
          ownerId: row.ownerId,
          ownerName: (extra?.owner_name as string | null) ?? null,
          amountPaise: rupeeStringToPaise(row.amount),
          status: row.status,
          approvalState: row.approvalState,
          requestedAt: row.requestedAt.toISOString(),
          approvedAt: row.approvedAt?.toISOString() ?? null,
          rejectionReason: row.rejectionReason,
          failureReason: row.failureReason,
          destinationLast4: (extra?.account_number_last4 as string | null) ?? null,
          bankName: (extra?.bank_name as string | null) ?? null,
        };
      }),
      page: query.page,
      limit: query.limit,
      total,
    };
  }

  /**
   * §14.4's approval.
   *
   * `decideApproval` is `transitionToTerminal`'s discipline applied to a
   * different column: a guarded UPDATE whose ZERO-ROW result means another
   * admin already decided this one. The caller must then do NOTHING — no vendor
   * call, no audit row, no compensating entry — which is why this raises rather
   * than falling through.
   *
   * `submitApproved` reuses the payout's OWN stored idempotency key, so an
   * approve that times out and is retried is one intent to the provider rather
   * than two payouts to the same bank account.
   */
  async approve(adminId: string, payoutId: string, context: SessionContext) {
    const before = await this.repo.byId(payoutId);
    const row = await this.repo.decideApproval(payoutId, 'approved', { adminId });

    if (!row) throw alreadyDecided(before?.approvalState);

    // NOT fire-and-forget: a failed audit insert fails the request. §9.4.10's
    // AC is that payouts are auditable, and an approval nobody can attribute is
    // not one.
    await this.audit.record({
      adminId,
      action: 'payout.approve',
      subjectType: 'payout',
      subjectId: payoutId,
      before: { approvalState: before?.approvalState ?? null, amount: before?.amount ?? null },
      after: { approvalState: 'approved' },
      ip: context.ip,
      userAgent: context.userAgent,
    });

    this.logger.log(`payout ${payoutId} approved by ${adminId}`);

    return this.payouts.submitApproved(row);
  }

  /**
   * Rejection, which routes straight into the EXISTING `markFailed`.
   *
   * One failure path, not two — the property `markFailed`'s own docstring
   * claims. It writes the §14.5 compensating `adjustment` credit that returns
   * the held funds, opens the alert, emits `payout.failed`, and does all of it
   * exactly as a provider rejection would.
   */
  async reject(adminId: string, payoutId: string, reason: string, context: SessionContext) {
    const before = await this.repo.byId(payoutId);
    const row = await this.repo.decideApproval(payoutId, 'rejected', { adminId, reason });

    if (!row) throw alreadyDecided(before?.approvalState);

    await this.audit.record({
      adminId,
      action: 'payout.reject',
      subjectType: 'payout',
      subjectId: payoutId,
      before: { approvalState: before?.approvalState ?? null, amount: before?.amount ?? null },
      after: { approvalState: 'rejected' },
      reason,
      ip: context.ip,
      userAgent: context.userAgent,
    });

    await this.payouts.markFailed(payoutId, `Rejected by Finance: ${reason}`);

    this.logger.warn(`payout ${payoutId} rejected by ${adminId}: ${reason}`);

    const after = await this.repo.byId(payoutId);
    return { id: payoutId, approvalState: after?.approvalState ?? 'rejected' };
  }

  /**
   * §9.4.10's money policy, read from and written to `charge_config` — the same
   * singleton row `AdminConfigService` already edits under
   * `@Roles('super_admin','finance')`, so these knobs inherit its change
   * history for free.
   */
  async config(): Promise<AdminFinanceConfigDto> {
    const { charges } = await this.pricingConfig.load();

    return {
      payoutAutoApproveMaxPaise: charges.payoutAutoApproveMaxPaise,
      taxPct: charges.taxPct,
      taxLabel: charges.taxLabel,
      cancelFreeMinutes: charges.cancelFreeMinutes,
      cancelPartialMinutes: charges.cancelPartialMinutes,
      cancelPartialFeePaise: charges.cancelPartialFeePaise,
      cancelDriverCompPct: charges.cancelDriverCompPct,
    };
  }

  async updateConfig(
    adminId: string,
    patch: AdminFinanceConfigUpdate,
    context: SessionContext,
  ): Promise<AdminFinanceConfigDto> {
    const before = await this.config();

    const sets = [
      patch.payoutAutoApproveMaxPaise !== undefined
        ? sql`payout_auto_approve_max = ${paiseToRupeeString(patch.payoutAutoApproveMaxPaise)}::numeric`
        : null,
      patch.taxPct !== undefined ? sql`tax_pct = ${patch.taxPct}` : null,
      patch.taxLabel !== undefined ? sql`tax_label = ${patch.taxLabel}` : null,
      patch.cancelFreeMinutes !== undefined
        ? sql`cancel_free_minutes = ${patch.cancelFreeMinutes}`
        : null,
      patch.cancelPartialMinutes !== undefined
        ? sql`cancel_partial_minutes = ${patch.cancelPartialMinutes}`
        : null,
      patch.cancelPartialFeePaise !== undefined
        ? sql`cancel_partial_fee = ${paiseToRupeeString(patch.cancelPartialFeePaise)}::numeric`
        : null,
      patch.cancelDriverCompPct !== undefined
        ? sql`cancel_driver_comp_pct = ${patch.cancelDriverCompPct}`
        : null,
    ].filter((clause): clause is NonNullable<typeof clause> => clause !== null);

    if (sets.length === 0) throw ApiException.validation('Provide at least one field to update');

    // UPSERT, NOT UPDATE. A plain UPDATE against a database with no
    // `charge_config` row affects zero rows and returns 200 — an admin sets a
    // tax rate, sees success, and nothing changes. Silently discarding a money
    // config write is worse than failing it, and `charge_config` is a singleton
    // whose absence is a fixable state rather than an error.
    await this.db.execute(sql`
      insert into charge_config (singleton) values (true)
      on conflict (singleton) do nothing
    `);

    await this.db.execute(sql`
      update charge_config
         set ${sql.join(sets, sql`, `)}, updated_at = now()
       where singleton = true
    `);

    // §6.7 means "no deploy", not "eventually" — the rate card is cached.
    await this.pricingConfig.invalidate();

    const after = await this.config();

    await this.audit.record({
      adminId,
      action: 'finance.config.update',
      subjectType: 'charge_config',
      before: before as unknown as Record<string, unknown>,
      after: after as unknown as Record<string, unknown>,
      ip: context.ip,
      userAgent: context.userAgent,
    });

    // A tax rate going non-zero is the moment the invoice stops being a receipt
    // and starts claiming to be a tax document — worth a loud line in the log,
    // because ToBeDoneEhsan records it as a compliance blocker.
    if (before.taxPct === 0 && after.taxPct > 0) {
      this.logger.warn(
        `GST enabled at ${after.taxPct}% by ${adminId} — invoices are NOT yet compliant tax ` +
          'invoices (no platform GSTIN, HSN/SAC, place of supply or number series)',
      );
    }

    return after;
  }
}

function alreadyDecided(state: string | undefined): ApiException {
  return new ApiException(
    HttpStatus.CONFLICT,
    ErrorCodes.PAYOUT_ALREADY_DECIDED,
    'This payout has already been decided',
    { approvalState: state ?? null },
  );
}
