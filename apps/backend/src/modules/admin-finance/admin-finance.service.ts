import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Response } from 'express';
import {
  ErrorCodes,
  paiseToRupeeString,
  rupeeStringToPaise,
  type AdminFinanceConfigDto,
  type AdminFinanceConfigUpdate,
  type AdminInvariantsResponse,
  type AdminLedgerQuery,
  type AdminLedgerResponse,
  type AdminPayoutDto,
  type AdminPayoutsListResponse,
  type AdminPayoutsQuery,
  type AdminPayoutSlaQuery,
  type AdminPayoutSlaResponse,
  type AdminRefundIssue,
  type AdminRefundIssueResponse,
  type AdminRefundsQuery,
  type AdminRefundsResponse,
  type AdminTransactionsQuery,
  type AdminTransactionsResponse,
  type RefundKind,
  type RefundStatus,
} from '@towing/api-contracts';
import { ApiException } from '../../common/errors/api-exception';
import { streamCsv } from '../../common/csv/csv';
import { DB, type Database } from '../../db/db.module';
import {
  driftedWallets,
  ledgerInvariants,
  type LedgerInvariants,
} from '../../db/ledger/invariants';
import { AdminAuditService } from '../admin-auth/admin-audit.service';
import { codeOf } from '../admin-bookings/admin-bookings.repo';
import type { SessionContext } from '../auth/token.service';
import { PricingConfigRepo } from '../pricing/pricing-config.repo';
import { PayoutsRepo } from '../money/payouts.repo';
import { PayoutsService } from '../money/payouts.service';
import { RefundsService } from '../money/refunds.service';
import { AdminFinanceRepo } from './admin-finance.repo';

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
    /** Named for what it is: there is also a `refunds(query)` READ on this class. */
    private readonly refundEngine: RefundsService,
    private readonly financeRepo: AdminFinanceRepo,
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
      (enriched as unknown as Array<Record<string, unknown>>).map((row) => [row.id as string, row]),
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

  // ── W9: the console reads and the one write ───────────────────────────────

  /** Every payment that ever touched a booking (the transactions table). */
  async transactions(query: AdminTransactionsQuery): Promise<AdminTransactionsResponse> {
    const { items, total } = await this.financeRepo.transactions(query);
    return { items, page: query.page, limit: query.limit, total };
  }

  /** The append-only wallet ledger, cursor-paginated (the ledger viewer). */
  ledger(query: AdminLedgerQuery): Promise<AdminLedgerResponse> {
    return this.financeRepo.ledger(query);
  }

  async refunds(query: AdminRefundsQuery): Promise<AdminRefundsResponse> {
    const { items, total } = await this.financeRepo.refunds(query);
    return { items, page: query.page, limit: query.limit, total };
  }

  /**
   * §14.1's five invariants, live. The panel exists so an operator can answer
   * "is the ledger sound right now?" without shell access — and so the answer
   * is the SAME query the nightly job and the suite assert, never a parallel
   * reimplementation that could disagree.
   */
  async invariants(): Promise<AdminInvariantsResponse> {
    const [drift, wallets] = await Promise.all([
      ledgerInvariants(this.db),
      driftedWallets(this.db, 20),
    ]);

    const invariants = INVARIANT_LABELS.map(({ key, label }) => ({
      key,
      label,
      drift: drift[key],
    }));

    return {
      checkedAt: new Date().toISOString(),
      ok: invariants.every((entry) => entry.drift === 0),
      // The array order is the panel's order; the keys are pinned by the
      // contract, and a MISSING invariant here is a compile error, not a
      // silently green panel.
      invariants,
      driftedWallets: wallets.map((wallet) => ({
        walletId: wallet.walletId,
        ownerType:
          wallet.ownerType as AdminInvariantsResponse['driftedWallets'][number]['ownerType'],
        ownerId: wallet.ownerId,
        balancePaise: wallet.balancePaise,
        ledgerPaise: wallet.ledgerPaise,
        deltaPaise: wallet.deltaPaise,
      })),
    };
  }

  /** §14.4's decision latency, at the two percentiles worth reading. */
  async payoutSla(query: AdminPayoutSlaQuery): Promise<AdminPayoutSlaResponse> {
    const row = await this.financeRepo.payoutSla(query.windowDays);
    return { windowDays: query.windowDays, ...row, generatedAt: new Date().toISOString() };
  }

  /**
   * One IST day of money as a downloadable file: captures and refunds in one
   * signed, time-ordered list. `streamCsv` owns the escaping (formula
   * injection included) — the same writer every other export in the repo uses.
   */
  async reconciliationCsv(res: Response, date: string): Promise<void> {
    // Row fetch errors happen BEFORE the first byte, so they can still be a
    // proper error envelope — log the cause here, because the generic
    // exception filter's body keeps it flat by design.
    let rows: Awaited<ReturnType<AdminFinanceRepo['reconciliation']>>;
    try {
      rows = await this.financeRepo.reconciliation(date);
    } catch (error) {
      this.logger.error(`reconciliation ${date} failed: ${String(error)}`);
      throw error;
    }
    let emitted = false;

    await streamCsv(
      res,
      {
        filename: `reconciliation-${date}.csv`,
        header: [
          'kind',
          'ref',
          'booking_code',
          'amount_paise',
          'status',
          'method',
          'gateway_ref',
          'at',
          'note',
        ],
      },
      async () => {
        if (emitted) return [];
        emitted = true;
        return rows.map((row) => [
          row.kind,
          row.ref,
          codeOf(row.bookingId),
          String(row.amountPaise),
          row.status,
          row.method ?? '',
          row.gatewayRef ?? '',
          row.at.toISOString(),
          row.note ?? '',
        ]);
      },
    );
  }

  /**
   * `POST /finance/refunds` — Finance's own refund, full or partial.
   *
   * THE KEY IS MANDATORY, and it is the only money write in the console that
   * demands one. Cancel and reassign refuse a second run because the booking
   * already moved; a refund has no such guard — a retried POST is
   * indistinguishable from a genuine second refund — so the caller pins their
   * intent in `Idempotency-Key`, hashed with the issuing admin's id, and a
   * replayed request resumes rather than refunding twice.
   *
   * The landing depends on where the booking already is, and it is A8's
   * lands: a `paid` booking must LEAVE `paid` (the refund reverses credits,
   * and `ledgerDrift` only holds while the two agree) — and `paid → cancelled`
   * is not a legal edge, so `disputed` it is, exactly where W8's dispute
   * full-refund lands. A booking that already left paid — the
   * capture-after-cancel conflict, and nothing else in practice — takes the
   * money-only path (`transitionTo: null`), which is exactly what the
   * conflict alert asks Finance to do.
   */
  async issueRefund(
    adminId: string,
    body: AdminRefundIssue,
    /** Enforced non-empty by `@IdempotencyKey()`; the row key hashes it with the admin id. */
    clientKey: string,
    context: SessionContext,
  ): Promise<AdminRefundIssueResponse> {
    const keySource = { kind: 'admin' as const, adminId, clientKey };

    let result: { refundId: string; replayed: boolean };

    if (body.amountPaise === undefined || body.liability === undefined) {
      const [booking] = (await this.db.execute(sql`
        select status from bookings where id = ${body.bookingId}::uuid
      `)) as unknown as Array<{ status: string }>;
      if (!booking) throw ApiException.notFound('Booking not found');

      result = await this.refundEngine.refundBooking({
        bookingId: body.bookingId,
        reason: body.reason,
        initiatedBy: adminId,
        // A paid booking leaves `paid` via A8's edge (`paid → disputed`);
        // anything else (the cancelled-booking capture conflict) keeps its
        // status and only the money moves.
        transitionTo: booking.status === 'paid' ? 'disputed' : null,
        keySource,
      });
    } else {
      result = await this.refundEngine.refundPartial({
        bookingId: body.bookingId,
        reason: body.reason,
        initiatedBy: adminId,
        amountPaise: body.amountPaise,
        liability: body.liability,
        keySource,
      });
    }

    // The response reads the STORED row, so a replay reports the original
    // amount and kind rather than whatever the request happened to carry.
    const [stored] = (await this.db.execute(sql`
      select amount, kind, status from refunds where id = ${result.refundId}::uuid
    `)) as unknown as Array<{ amount: string; kind: RefundKind; status: RefundStatus }>;

    await this.audit.record({
      adminId,
      action: 'refund.issue',
      subjectType: 'booking',
      subjectId: body.bookingId,
      after: {
        refundId: result.refundId,
        kind: stored?.kind ?? null,
        amountPaise: stored ? rupeeStringToPaise(stored.amount) : null,
        replayed: result.replayed,
      },
      reason: body.reason,
      ip: context.ip,
      userAgent: context.userAgent,
    });

    this.logger.warn(
      `refund ${result.refundId} issued by ${adminId} on booking ${body.bookingId}` +
        `${result.replayed ? ' (replayed — nothing moved twice)' : ''}`,
    );

    return {
      refundId: result.refundId,
      kind: stored?.kind ?? 'full',
      amountPaise: stored ? rupeeStringToPaise(stored.amount) : 0,
      status: stored?.status ?? 'pending',
      replayed: result.replayed,
    };
  }
}

/** The panel's order and wording — the labels an operator reads, once. */
const INVARIANT_LABELS = [
  { key: 'walletDrift', label: 'Wallet balance = sum of its ledger entries' },
  { key: 'bookingDrift', label: 'Commission + payout + tax = total (paid bookings)' },
  { key: 'ledgerDrift', label: 'Credited legs = the recorded driver payout' },
  { key: 'reversalDrift', label: 'No booking refunded beyond what it was credited' },
  { key: 'couponDrift', label: 'Coupon used_count = its redemption rows' },
] as const satisfies ReadonlyArray<{ key: keyof LedgerInvariants; label: string }>;

function alreadyDecided(state: string | undefined): ApiException {
  return new ApiException(
    HttpStatus.CONFLICT,
    ErrorCodes.PAYOUT_ALREADY_DECIDED,
    'This payout has already been decided',
    { approvalState: state ?? null },
  );
}
