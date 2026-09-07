import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { PayoutApprovalState, PayoutStatus } from '@towing/api-contracts';
import { DB, type Database } from '../../db/db.module';

export interface PayoutRow {
  id: string;
  ownerId: string;
  /**
   * ALL THREE `wallet_owner_type` values. This was narrowed to
   * `'fleet' | 'driver'` and reached via an unchecked cast in `toRow`, so a
   * `'user'` row — which the column permits and `wallets` already stores —
   * flowed through typed as something it is not. Harmless while nothing
   * branched on it; Phase 13's recipient resolver does.
   */
  ownerType: 'user' | 'driver' | 'fleet';
  amount: string;
  status: PayoutStatus;
  routeRef: string | null;
  failureReason: string | null;
  provider: string | null;
  idempotencyKey: string | null;
  requestedAt: Date;
  paidAt: Date | null;
  /** §14.4's Finance gate — a separate axis from `status`. See the schema. */
  approvalState: PayoutApprovalState;
  approvedBy: string | null;
  approvedAt: Date | null;
  rejectionReason: string | null;
}

/** The owner a payout belongs to. Phase 19 widened every method to take this. */
export interface PayoutOwner {
  ownerType: 'driver' | 'fleet';
  ownerId: string;
}

/** Raw `db.execute` returns timestamps as strings; coerced once, here. */
function toRow(row: Record<string, unknown>): PayoutRow {
  return {
    id: row.id as string,
    ownerId: row.owner_id as string,
    ownerType: row.owner_type as 'user' | 'driver' | 'fleet',
    amount: row.amount as string,
    status: row.status as PayoutStatus,
    routeRef: (row.route_ref as string | null) ?? null,
    failureReason: (row.failure_reason as string | null) ?? null,
    provider: (row.provider as string | null) ?? null,
    idempotencyKey: (row.idempotency_key as string | null) ?? null,
    requestedAt: new Date(row.requested_at as string),
    paidAt: row.paid_at ? new Date(row.paid_at as string) : null,
    approvalState: row.approval_state as PayoutApprovalState,
    approvedBy: (row.approved_by as string | null) ?? null,
    approvedAt: row.approved_at ? new Date(row.approved_at as string) : null,
    rejectionReason: (row.rejection_reason as string | null) ?? null,
  };
}

@Injectable()
export class PayoutsRepo {
  constructor(@Inject(DB) private readonly db: Database) {}

  /**
   * Creates the payout row. The two unique indexes it can violate mean
   * different things and the caller must be able to tell them apart, so the
   * error is left to bubble with its constraint name intact.
   */
  async create(params: {
    owner: PayoutOwner;
    amount: string;
    idempotencyKey: string;
    provider: string;
    /**
     * §14.4's gate, decided by the caller from
     * `charge_config.payout_auto_approve_max`. Written at INSERT rather than
     * patched afterwards, so a payout is never briefly `auto_approved` in a
     * window where a crash could leave it there and send it unreviewed.
     */
    approvalState: PayoutApprovalState;
  }): Promise<PayoutRow> {
    const rows = (await this.db.execute(sql`
      insert into payouts (owner_id, owner_type, amount, status, idempotency_key, provider,
                           approval_state)
      values (${params.owner.ownerId}::uuid, ${params.owner.ownerType}::wallet_owner_type,
              ${params.amount}::numeric, 'requested',
              ${params.idempotencyKey}, ${params.provider}, ${params.approvalState})
      returning *
    `)) as unknown as Array<Record<string, unknown>>;

    return toRow(rows[0]!);
  }

  /**
   * The fund account a payout pays into. Null when nothing is linked, which the
   * caller turns into `payout_account_not_linked` rather than a vendor call
   * with an empty destination.
   */
  async activeDestination(owner: PayoutOwner): Promise<string | null> {
    const rows = (await this.db.execute(sql`
      select route_fund_account_id from payout_accounts
       where owner_type = ${owner.ownerType}::wallet_owner_type
         and owner_id = ${owner.ownerId}::uuid
         and status = 'active'
    `)) as unknown as Array<{ route_fund_account_id: string | null }>;

    return rows[0]?.route_fund_account_id ?? null;
  }

  async byIdempotencyKey(key: string): Promise<PayoutRow | null> {
    const rows = (await this.db.execute(sql`
      select * from payouts where idempotency_key = ${key}
    `)) as unknown as Array<Record<string, unknown>>;
    return rows[0] ? toRow(rows[0]) : null;
  }

  async byId(payoutId: string): Promise<PayoutRow | null> {
    const rows = (await this.db.execute(sql`
      select * from payouts where id = ${payoutId}::uuid
    `)) as unknown as Array<Record<string, unknown>>;
    return rows[0] ? toRow(rows[0]) : null;
  }

  /**
   * Finds the payout a webhook is about: by the provider reference first, then
   * by our own id echoed back in `notes`. The fallback covers the race where
   * the provider accepted the payout but we crashed before persisting
   * `route_ref` — without it that payout would be stranded until the poll.
   */
  async byProviderRefOrId(providerRef: string | null, payoutId: string | null): Promise<PayoutRow | null> {
    if (providerRef) {
      const rows = (await this.db.execute(sql`
        select * from payouts where route_ref = ${providerRef}
      `)) as unknown as Array<Record<string, unknown>>;
      if (rows[0]) return toRow(rows[0]);
    }

    return payoutId ? this.byId(payoutId) : null;
  }

  /** Records the provider's acceptance. Guarded so a late poll cannot undo a terminal state. */
  async markProcessing(payoutId: string, providerRef: string): Promise<void> {
    await this.db.execute(sql`
      update payouts
         set status = 'processing', route_ref = ${providerRef},
             last_synced_at = now(), updated_at = now()
       where id = ${payoutId}::uuid and status = 'requested'
    `);
  }

  /**
   * The status guard is what makes every transition idempotent AND stops a late
   * webhook un-paying a settled payout. Zero rows returned means the payout was
   * already terminal, and the caller must then do nothing at all — including
   * not writing a compensating ledger entry.
   */
  async transitionToTerminal(
    payoutId: string,
    to: 'paid' | 'failed',
    options: { providerRef?: string | null; failureReason?: string | null } = {},
  ): Promise<PayoutRow | null> {
    const rows = (await this.db.execute(sql`
      update payouts
         set status = ${to}::payout_status,
             paid_at = ${to === 'paid' ? sql`now()` : sql`paid_at`},
             route_ref = coalesce(${options.providerRef ?? null}, route_ref),
             failure_reason = ${options.failureReason ?? null},
             last_synced_at = now(),
             updated_at = now()
       where id = ${payoutId}::uuid
         and status in ('requested', 'processing')
      returning *
    `)) as unknown as Array<Record<string, unknown>>;

    return rows[0] ? toRow(rows[0]) : null;
  }

  async page(
    owner: PayoutOwner,
    query: { page: number; limit: number; status?: PayoutStatus },
  ): Promise<{ items: PayoutRow[]; total: number }> {
    const statusFilter = query.status ? sql`and status = ${query.status}::payout_status` : sql``;
    const scope = sql`owner_type = ${owner.ownerType}::wallet_owner_type
                        and owner_id = ${owner.ownerId}::uuid`;

    const items = (await this.db.execute(sql`
      select * from payouts
       where ${scope}
       ${statusFilter}
       -- Matches idx_payouts_owner_feed exactly; a bare DESC implies NULLS
       -- FIRST and would make Postgres re-sort every page.
       order by requested_at desc nulls last, id desc nulls last
       limit ${query.limit} offset ${(query.page - 1) * query.limit}
    `)) as unknown as Array<Record<string, unknown>>;

    const [count] = (await this.db.execute(sql`
      select count(*)::int as total from payouts
       where ${scope}
       ${statusFilter}
    `)) as unknown as [{ total: number }];

    return { items: items.map(toRow), total: count.total };
  }

  /**
   * §14.4's approval decision, with `transitionToTerminal`'s discipline applied
   * to a different column: a guarded UPDATE whose ZERO-ROW result means another
   * admin already decided this one, and obliges the caller to do nothing at all
   * — no vendor call, no audit row, no compensating entry.
   */
  async decideApproval(
    payoutId: string,
    to: 'approved' | 'rejected',
    options: { adminId: string; reason?: string | null },
  ): Promise<PayoutRow | null> {
    const rows = (await this.db.execute(sql`
      update payouts
         set approval_state = ${to},
             approved_by = ${options.adminId}::uuid,
             approved_at = now(),
             rejection_reason = ${options.reason ?? null},
             updated_at = now()
       where id = ${payoutId}::uuid and approval_state = 'pending_approval'
      returning *
    `)) as unknown as Array<Record<string, unknown>>;

    return rows[0] ? toRow(rows[0]) : null;
  }

  /** §9.4.10's queue: everything waiting on Finance, oldest first. */
  async approvalQueue(query: {
    page: number;
    limit: number;
    state: PayoutApprovalState | 'all';
    ownerType?: 'driver' | 'fleet';
  }): Promise<{ items: PayoutRow[]; total: number }> {
    const stateFilter =
      query.state === 'all' ? sql`` : sql`and approval_state = ${query.state}`;
    const ownerFilter = query.ownerType
      ? sql`and owner_type = ${query.ownerType}::wallet_owner_type`
      : sql``;

    const items = (await this.db.execute(sql`
      select * from payouts
       where true ${stateFilter} ${ownerFilter}
       order by requested_at asc, id asc
       limit ${query.limit} offset ${(query.page - 1) * query.limit}
    `)) as unknown as Array<Record<string, unknown>>;

    const [count] = (await this.db.execute(sql`
      select count(*)::int as total from payouts
       where true ${stateFilter} ${ownerFilter}
    `)) as unknown as [{ total: number }];

    return { items: items.map(toRow), total: count.total };
  }

  /**
   * Non-terminal payouts the reconciliation poll should ask the provider about.
   *
   * The `updated_at` floor is what stops the poll racing a payout that is still
   * mid-request in another process. Bounded, so a backlog cannot turn one tick
   * into thousands of vendor calls.
   */
  async staleNonTerminal(olderThanMinutes: number, limit = 200): Promise<PayoutRow[]> {
    const rows = (await this.db.execute(sql`
      select * from payouts
       where status in ('requested', 'processing')
         -- A payout waiting on Finance has NOT been sent to the provider, so
         -- asking the provider about it would 404 at best. Section 14.4's gate
         -- sits upstream of the vendor entirely, which is the whole reason it
         -- is a separate column rather than a fifth payout_status value.
         and approval_state <> 'pending_approval'
         and updated_at < now() - (${olderThanMinutes} || ' minutes')::interval
       order by updated_at asc
       limit ${limit}
    `)) as unknown as Array<Record<string, unknown>>;

    return rows.map(toRow);
  }
}
