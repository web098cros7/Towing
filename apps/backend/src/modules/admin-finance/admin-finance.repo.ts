import { Inject, Injectable } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import {
  rupeeStringToPaise,
  type AdminLedgerEntryDto,
  type AdminLedgerQuery,
  type AdminRefundRowDto,
  type AdminRefundsQuery,
  type AdminTransactionDto,
  type AdminTransactionsQuery,
} from '@towing/api-contracts';
import { DB, type Database } from '../../db/db.module';
import { codeOf } from '../admin-bookings/admin-bookings.repo';

/** One row of the reconciliation CSV, before it is flattened to cells. */
export interface ReconciliationRow {
  kind: 'payment' | 'refund';
  ref: string;
  bookingId: string;
  amountPaise: number;
  status: string;
  method: string | null;
  gatewayRef: string | null;
  at: Date;
  note: string | null;
}

export interface PayoutSlaRow {
  decided: number;
  p50Minutes: number | null;
  p95Minutes: number | null;
  breaches24h: number;
  pendingOver24h: number;
}

/**
 * W9's finance-console reads. ONE repo for the four feeds, because they share
 * the same three join shapes (booking → user, wallet → owner, refund →
 * payment) and splitting them would copy those joins four ways.
 *
 * Everything here is READ-ONLY. The one W9 write (issuing a refund) goes
 * through `RefundsService`, which owns the ledger discipline — this file must
 * never learn how to move money.
 */
@Injectable()
export class AdminFinanceRepo {
  constructor(@Inject(DB) private readonly db: Database) {}

  // ── transactions ──────────────────────────────────────────────────────────

  async transactions(
    query: AdminTransactionsQuery,
  ): Promise<{ items: AdminTransactionDto[]; total: number }> {
    const where = this.transactionFilter(query);

    const rows = (await this.db.execute(sql`
      select p.id, p.booking_id, p.purpose, p.status, p.method, p.amount, p.tax_amount,
             p.refunded_amount, p.gateway_ref, p.failure_reason, p.captured_at, p.created_at,
             u.name as customer_name
        from payments p
        join bookings b on b.id = p.booking_id
        left join users u on u.id = b.user_id
       where ${where}
       order by coalesce(p.captured_at, p.created_at) desc, p.id desc
       limit ${query.limit} offset ${(query.page - 1) * query.limit}
    `)) as unknown as Array<Record<string, unknown>>;

    const [count] = (await this.db.execute(sql`
      select count(*)::int as total
        from payments p
        join bookings b on b.id = p.booking_id
        left join users u on u.id = b.user_id
       where ${where}
    `)) as unknown as [{ total: number }];

    return {
      items: rows.map((row): AdminTransactionDto => ({
        id: row.id as string,
        bookingId: row.booking_id as string,
        bookingCode: codeOf(row.booking_id as string),
        purpose: row.purpose as AdminTransactionDto['purpose'],
        status: row.status as AdminTransactionDto['status'],
        method: row.method as AdminTransactionDto['method'],
        amountPaise: rupeeStringToPaise(row.amount as string),
        taxPaise: rupeeStringToPaise((row.tax_amount as string | null) ?? '0'),
        refundedAmountPaise: rupeeStringToPaise((row.refunded_amount as string | null) ?? '0'),
        gatewayRef: (row.gateway_ref as string | null) ?? null,
        customerName: (row.customer_name as string | null) ?? null,
        failureReason: (row.failure_reason as string | null) ?? null,
        capturedAt: row.captured_at ? new Date(row.captured_at as string).toISOString() : null,
        createdAt: new Date(row.created_at as string).toISOString(),
      })),
      total: count.total,
    };
  }

  private transactionFilter(query: AdminTransactionsQuery): SQL {
    const filters: SQL[] = [];
    if (query.status) filters.push(sql`p.status = ${query.status}::payment_status`);
    if (query.purpose) filters.push(sql`p.purpose = ${query.purpose}`);
    // The payment's OWN timestamp: capture when it exists, creation otherwise.
    if (query.from) {
      filters.push(
        sql`coalesce(p.captured_at, p.created_at) >= (${query.from}::date::timestamp at time zone 'Asia/Kolkata')`,
      );
    }
    if (query.to) {
      filters.push(
        sql`coalesce(p.captured_at, p.created_at) < ((${query.to}::date + 1)::timestamp at time zone 'Asia/Kolkata')`,
      );
    }
    if (query.q) {
      const like = `%${escapeLike(query.q)}%`;
      const prefix = `${escapeLike(query.q)}%`;
      filters.push(sql`(
        p.booking_id::text ilike ${prefix}
        or p.gateway_ref ilike ${like}
        or u.name ilike ${like}
        or b.pickup_address ilike ${like}
      )`);
    }
    return filters.length > 0 ? sql.join(filters, sql` and `) : sql`true`;
  }

  // ── the wallet ledger feed ────────────────────────────────────────────────

  /**
   * Backwards in time, cursor-paginated.
   *
   * The cursor is `(created_at, id)` encoded opaquely — the pair, not the id
   * alone, because ids are random uuids here and a single-column cursor on
   * them would walk in id order rather than time order. `limit + 1` rows are
   * fetched: the extra one exists only to answer "is there another page".
   */
  async ledger(
    query: AdminLedgerQuery,
  ): Promise<{ items: AdminLedgerEntryDto[]; nextCursor: string | null }> {
    const filters: SQL[] = [];
    if (query.ownerType) filters.push(sql`w.owner_type = ${query.ownerType}::wallet_owner_type`);
    if (query.ownerId) filters.push(sql`w.owner_id = ${query.ownerId}::uuid`);
    if (query.type) filters.push(sql`t.type = ${query.type}::wallet_txn_type`);
    if (query.refId) filters.push(sql`t.ref_id = ${query.refId}::uuid`);
    if (query.from) {
      filters.push(
        sql`t.created_at >= (${query.from}::date::timestamp at time zone 'Asia/Kolkata')`,
      );
    }
    if (query.to) {
      filters.push(
        sql`t.created_at < ((${query.to}::date + 1)::timestamp at time zone 'Asia/Kolkata')`,
      );
    }
    const cursor = decodeCursor(query.cursor);
    if (cursor) {
      filters.push(
        sql`(t.created_at, t.id) < (${cursor.at.toISOString()}::timestamptz, ${cursor.id}::uuid)`,
      );
    }
    const where = filters.length > 0 ? sql.join(filters, sql` and `) : sql`true`;

    const rows = (await this.db.execute(sql`
      select t.id, t.type, t.amount, t.reason, t.ref_id, t.idempotency_key, t.created_at,
             w.owner_type, w.owner_id,
             coalesce(f.business_name, d.name, u.name) as owner_name
        from wallet_transactions t
        join wallets w on w.id = t.wallet_id
        left join fleets f on w.owner_type = 'fleet' and f.id = w.owner_id
        left join drivers d on w.owner_type = 'driver' and d.id = w.owner_id
        left join users u on w.owner_type = 'user' and u.id = w.owner_id
       where ${where}
       order by t.created_at desc, t.id desc
       limit ${query.limit + 1}
    `)) as unknown as Array<Record<string, unknown>>;

    const page = rows.slice(0, query.limit);
    const last = page[page.length - 1];
    const nextCursor =
      rows.length > query.limit && last
        ? encodeCursor(new Date(last.created_at as string), last.id as string)
        : null;

    return {
      items: page.map((row): AdminLedgerEntryDto => ({
        id: row.id as string,
        ownerType: row.owner_type as AdminLedgerEntryDto['ownerType'],
        ownerId: row.owner_id as string,
        ownerName: (row.owner_name as string | null) ?? null,
        type: row.type as AdminLedgerEntryDto['type'],
        // SIGNED paise — a debit is negative by the ledger's own convention
        // and stays negative on screen.
        amountPaise: Math.round(Number(row.amount as string) * 100),
        reason: (row.reason as string | null) ?? null,
        refId: (row.ref_id as string | null) ?? null,
        bookingCode: row.ref_id ? codeOf(row.ref_id as string) : null,
        idempotencyKey: row.idempotency_key as string,
        createdAt: new Date(row.created_at as string).toISOString(),
      })),
      nextCursor,
    };
  }

  // ── refunds list ──────────────────────────────────────────────────────────

  async refunds(query: AdminRefundsQuery): Promise<{ items: AdminRefundRowDto[]; total: number }> {
    const filters: SQL[] = [];
    if (query.status) filters.push(sql`r.status = ${query.status}::refund_status`);
    if (query.kind) filters.push(sql`r.kind = ${query.kind}`);
    if (query.from) {
      filters.push(
        sql`r.created_at >= (${query.from}::date::timestamp at time zone 'Asia/Kolkata')`,
      );
    }
    if (query.to) {
      filters.push(
        sql`r.created_at < ((${query.to}::date + 1)::timestamp at time zone 'Asia/Kolkata')`,
      );
    }
    if (query.q) {
      const like = `%${escapeLike(query.q)}%`;
      filters.push(sql`(r.reason ilike ${like} or r.booking_id::text ilike ${like})`);
    }
    const where = filters.length > 0 ? sql.join(filters, sql` and `) : sql`true`;

    const rows = (await this.db.execute(sql`
      select r.id, r.booking_id, r.amount, r.reason, r.status, r.kind, r.dispute_id,
             r.liability, r.initiated_by, r.gateway_ref, r.processed_at, r.created_at
        from refunds r
       where ${where}
       order by r.created_at desc, r.id desc
       limit ${query.limit} offset ${(query.page - 1) * query.limit}
    `)) as unknown as Array<Record<string, unknown>>;

    const [count] = (await this.db.execute(sql`
      select count(*)::int as total from refunds r where ${where}
    `)) as unknown as [{ total: number }];

    return {
      items: rows.map((row): AdminRefundRowDto => ({
        id: row.id as string,
        bookingId: row.booking_id as string,
        bookingCode: codeOf(row.booking_id as string),
        kind: row.kind as AdminRefundRowDto['kind'],
        amountPaise: rupeeStringToPaise(row.amount as string),
        reason: (row.reason as string | null) ?? null,
        status: row.status as AdminRefundRowDto['status'],
        disputeId: (row.dispute_id as string | null) ?? null,
        liability: (row.liability as string | null) ?? null,
        initiatedBy: row.initiated_by as string,
        gatewayRef: (row.gateway_ref as string | null) ?? null,
        processedAt: row.processed_at ? new Date(row.processed_at as string).toISOString() : null,
        createdAt: new Date(row.created_at as string).toISOString(),
      })),
      total: count.total,
    };
  }

  // ── payout SLA ────────────────────────────────────────────────────────────

  /**
   * How long DECISIONS took, not how long payments did.
   *
   * The SLA §14.4 promises Finance is the approval latency: `requested_at →
   * approved_at`, over payouts that reached a decision inside the window
   * (approved or rejected — a rejection is a decision). `pendingOver24h` is
   * the other half: payouts that have waited past 24 h and no human has
   * touched. `percentile_cont` is exact-interpolation, so a single payout
   * window still answers rather than returning null.
   */
  async payoutSla(windowDays: number): Promise<PayoutSlaRow> {
    const [row] = (await this.db.execute(sql`
      select
        count(*) filter (where approval_state in ('approved', 'rejected'))::int as decided,
        percentile_cont(0.5) within group (
          order by extract(epoch from (approved_at - requested_at)) / 60
        ) filter (where approval_state in ('approved', 'rejected')) as p50,
        percentile_cont(0.95) within group (
          order by extract(epoch from (approved_at - requested_at)) / 60
        ) filter (where approval_state in ('approved', 'rejected')) as p95,
        count(*) filter (
          where approval_state in ('approved', 'rejected')
            and approved_at - requested_at > interval '24 hours'
        )::int as breaches,
        count(*) filter (
          where approval_state = 'pending_approval'
            and requested_at < now() - interval '24 hours'
        )::int as pending_over_24h
        from payouts
       where requested_at >= now() - (${windowDays} || ' days')::interval
    `)) as unknown as Array<{
      decided: number;
      p50: string | number | null;
      p95: string | number | null;
      breaches: number;
      pending_over_24h: number;
    }>;

    const toMinutes = (value: string | number | null): number | null =>
      value === null ? null : Math.round(Number(value) * 10) / 10;

    return {
      decided: row?.decided ?? 0,
      p50Minutes: toMinutes(row?.p50 ?? null),
      p95Minutes: toMinutes(row?.p95 ?? null),
      breaches24h: row?.breaches ?? 0,
      pendingOver24h: row?.pending_over_24h ?? 0,
    };
  }

  // ── reconciliation ────────────────────────────────────────────────────────

  /**
   * One IST day's money: captured/refunded payments and processed refunds, in
   * one time-ordered list. The CSV is a byte stream (`streamCsv`), so this
   * returns rows rather than a page — a day's money is bounded by arithmetic
   * rather than by hope, and 50k payments in one IST day is not a real day.
   */
  async reconciliation(date: string): Promise<ReconciliationRow[]> {
    const rows = (await this.db.execute(sql`
      select 'payment' as kind, p.id as ref, p.booking_id, p.amount, p.status::text as status,
             p.method::text as method, p.gateway_ref,
             coalesce(p.captured_at, p.created_at) as at, p.purpose as note
        from payments p
       where p.status in ('captured', 'refunded')
         and coalesce(p.captured_at, p.created_at) >= (${date}::date::timestamp at time zone 'Asia/Kolkata')
         and coalesce(p.captured_at, p.created_at) < ((${date}::date + 1)::timestamp at time zone 'Asia/Kolkata')
      union all
      -- status is cast to text on BOTH sides: the two enums (payment_status,
      -- refund_status) cannot be unioned directly, and Postgres refuses to
      -- guess which type the column should be.
      select 'refund' as kind, r.id as ref, r.booking_id, -r.amount as amount,
             r.status::text as status, null as method, r.gateway_ref,
             coalesce(r.processed_at, r.created_at) as at, r.reason as note
        from refunds r
       where r.status = 'processed'
         and coalesce(r.processed_at, r.created_at) >= (${date}::date::timestamp at time zone 'Asia/Kolkata')
         and coalesce(r.processed_at, r.created_at) < ((${date}::date + 1)::timestamp at time zone 'Asia/Kolkata')
       order by at asc, ref asc
    `)) as unknown as Array<Record<string, unknown>>;

    return rows.map((row) => ({
      kind: row.kind as ReconciliationRow['kind'],
      ref: row.ref as string,
      bookingId: row.booking_id as string,
      // Refund rows are negative by construction: one column, signed, so the
      // day's net is a SUM an accountant can run without a second sheet.
      amountPaise: Math.round(Number(row.amount as string) * 100),
      status: row.status as string,
      method: (row.method as string | null) ?? null,
      gatewayRef: (row.gateway_ref as string | null) ?? null,
      at: new Date(row.at as string),
      note: (row.note as string | null) ?? null,
    }));
  }
}

/** ILIKE wildcard escaping — the same rule the bookings search applies. */
function escapeLike(value: string): string {
  return value.replace(/[%_\\]/g, (match) => `\\${match}`);
}

function encodeCursor(at: Date, id: string): string {
  return Buffer.from(`${at.toISOString()}|${id}`, 'utf8').toString('base64url');
}

function decodeCursor(cursor: string | undefined): { at: Date; id: string } | null {
  if (!cursor) return null;
  try {
    const [rawAt, id] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
    if (!rawAt || !id) return null;
    const at = new Date(rawAt);
    if (Number.isNaN(at.getTime())) return null;
    return { at, id };
  } catch {
    return null;
  }
}
