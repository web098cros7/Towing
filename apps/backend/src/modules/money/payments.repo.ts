import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Band, PaymentPurpose } from '@towing/api-contracts';
import { DB, type Database, type DatabaseExecutor } from '../../db/db.module';

export interface PaymentRow {
  id: string;
  bookingId: string;
  amount: string;
  taxAmount: string;
  status: 'pending' | 'authorized' | 'captured' | 'failed' | 'refunded';
  purpose: PaymentPurpose;
  method: 'upi' | 'card' | 'cash' | 'wallet';
  gatewayRef: string | null;
  gatewayOrderRef: string | null;
  provider: string | null;
  idempotencyKey: string;
  failureReason: string | null;
  capturedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Everything `settleCapturedPayment` needs, read under a row lock in one go.
 *
 * Assembled here rather than by the service so the FOR UPDATE and the fields it
 * protects cannot drift apart: every number below participates in the identity
 * `commission_amount + driver_payout + tax_amount = total`, and reading any of
 * them outside the lock reintroduces exactly the race the lock exists for.
 */
export interface SettlementInputsRow {
  bookingId: string;
  status: string;
  userId: string;
  driverId: string | null;
  fleetId: string | null;
  driverSharePct: number | null;
  band: Band | null;
  totalRupees: string;
  taxRupees: string;
  paymentId: string | null;
  paymentAmount: string | null;
}

function toRow(row: Record<string, unknown>): PaymentRow {
  return {
    id: row.id as string,
    bookingId: row.booking_id as string,
    amount: row.amount as string,
    taxAmount: (row.tax_amount as string | null) ?? '0',
    status: row.status as PaymentRow['status'],
    purpose: row.purpose as PaymentPurpose,
    method: row.method as PaymentRow['method'],
    gatewayRef: (row.gateway_ref as string | null) ?? null,
    gatewayOrderRef: (row.gateway_order_ref as string | null) ?? null,
    provider: (row.provider as string | null) ?? null,
    idempotencyKey: row.idempotency_key as string,
    failureReason: (row.failure_reason as string | null) ?? null,
    capturedAt: row.captured_at ? new Date(row.captured_at as string) : null,
    createdAt: new Date(row.created_at as string),
    updatedAt: new Date(row.updated_at as string),
  };
}

@Injectable()
export class PaymentsRepo {
  constructor(@Inject(DB) private readonly db: Database) {}

  /**
   * Creates the intent row. Like `PayoutsRepo.create`, the unique violations it
   * can raise mean different things, so the error bubbles with its constraint
   * name intact and the service decides.
   */
  async create(params: {
    bookingId: string;
    amount: string;
    taxAmount: string;
    purpose: PaymentPurpose;
    method: 'upi' | 'card' | 'wallet';
    idempotencyKey: string;
    provider: string;
  }): Promise<PaymentRow> {
    const rows = (await this.db.execute(sql`
      insert into payments (booking_id, amount, tax_amount, purpose, method, status,
                            idempotency_key, provider)
      values (${params.bookingId}::uuid, ${params.amount}::numeric, ${params.taxAmount}::numeric,
              ${params.purpose}, ${params.method}::payment_method, 'pending',
              ${params.idempotencyKey}, ${params.provider})
      returning *
    `)) as unknown as Array<Record<string, unknown>>;

    return toRow(rows[0]!);
  }

  async byIdempotencyKey(key: string): Promise<PaymentRow | null> {
    const rows = (await this.db.execute(sql`
      select * from payments where idempotency_key = ${key}
    `)) as unknown as Array<Record<string, unknown>>;
    return rows[0] ? toRow(rows[0]) : null;
  }

  async byId(paymentId: string): Promise<PaymentRow | null> {
    const rows = (await this.db.execute(sql`
      select * from payments where id = ${paymentId}::uuid
    `)) as unknown as Array<Record<string, unknown>>;
    return rows[0] ? toRow(rows[0]) : null;
  }

  /**
   * An existing non-terminal intent for this booking and purpose, whatever key
   * created it.
   *
   * TWO LIVE ORDERS FOR ONE BOOKING IS HOW YOU GET TWO CAPTURES, so a second
   * intent request reuses the first rather than minting another. That is why
   * this is keyed on (booking, purpose) and not on the idempotency key: a
   * customer who backgrounds the app and comes back has a genuinely new client
   * key for what is still one intent to pay.
   */
  async openIntent(bookingId: string, purpose: PaymentPurpose): Promise<PaymentRow | null> {
    const rows = (await this.db.execute(sql`
      select * from payments
       where booking_id = ${bookingId}::uuid
         and purpose = ${purpose}
         and status in ('pending', 'authorized')
       order by created_at desc
       limit 1
    `)) as unknown as Array<Record<string, unknown>>;
    return rows[0] ? toRow(rows[0]) : null;
  }

  async capturedFor(bookingId: string, purpose: PaymentPurpose): Promise<PaymentRow | null> {
    const rows = (await this.db.execute(sql`
      select * from payments
       where booking_id = ${bookingId}::uuid and purpose = ${purpose} and status = 'captured'
       limit 1
    `)) as unknown as Array<Record<string, unknown>>;
    return rows[0] ? toRow(rows[0]) : null;
  }

  async byGatewayRef(gatewayRef: string): Promise<PaymentRow | null> {
    const rows = (await this.db.execute(sql`
      select * from payments where gateway_ref = ${gatewayRef}
    `)) as unknown as Array<Record<string, unknown>>;
    return rows[0] ? toRow(rows[0]) : null;
  }

  async byOrderRef(orderRef: string): Promise<PaymentRow | null> {
    const rows = (await this.db.execute(sql`
      select * from payments where gateway_order_ref = ${orderRef}
    `)) as unknown as Array<Record<string, unknown>>;
    return rows[0] ? toRow(rows[0]) : null;
  }

  async setOrderRef(paymentId: string, orderRef: string): Promise<void> {
    await this.db.execute(sql`
      update payments set gateway_order_ref = ${orderRef}, updated_at = now()
       where id = ${paymentId}::uuid
    `);
  }

  /**
   * `pending|authorized → captured`, guarded.
   *
   * The `status <> 'captured'` guard is the same discipline
   * `PayoutsRepo.transitionToTerminal` uses: a zero-row result means somebody
   * else got here first, and the caller must treat it as a replay rather than
   * as work to redo.
   */
  async markCaptured(
    paymentId: string,
    params: { gatewayRef: string | null; method: PaymentRow['method'] | null },
  ): Promise<PaymentRow | null> {
    const rows = (await this.db.execute(sql`
      update payments
         set status = 'captured',
             gateway_ref = coalesce(${params.gatewayRef}, gateway_ref),
             method = coalesce(${params.method}::payment_method, method),
             captured_at = now(),
             failure_reason = null,
             updated_at = now()
       where id = ${paymentId}::uuid and status <> 'captured'
      returning *
    `)) as unknown as Array<Record<string, unknown>>;

    return rows[0] ? toRow(rows[0]) : null;
  }

  async markFailed(paymentId: string, reason: string): Promise<PaymentRow | null> {
    const rows = (await this.db.execute(sql`
      update payments
         set status = 'failed', failure_reason = ${reason}, updated_at = now()
       where id = ${paymentId}::uuid and status in ('pending', 'authorized')
      returning *
    `)) as unknown as Array<Record<string, unknown>>;

    return rows[0] ? toRow(rows[0]) : null;
  }

  async markRefunded(paymentId: string): Promise<void> {
    await this.db.execute(sql`
      update payments set status = 'refunded', updated_at = now()
       where id = ${paymentId}::uuid and status = 'captured'
    `);
  }

  /**
   * The settlement inputs, under a row lock on the booking.
   *
   * `fleet_driver_shares` supplies `driverSharePct`; a driver with no fleet has
   * none, and `computeSettlement` reads null as "independent — credit the whole
   * pool as one `fare_credit`".
   */
  async settlementInputs(
    tx: DatabaseExecutor,
    bookingId: string,
    purpose: PaymentPurpose,
  ): Promise<SettlementInputsRow | null> {
    const rows = (await tx.execute(sql`
      select b.id, b.status, b.user_id, b.driver_id, b.fleet_id,
             b.commission_band, b.total, b.tax_amount,
             fds.driver_share as driver_share_pct,
             p.id as payment_id, p.amount as payment_amount
        from bookings b
        left join fleet_driver_shares fds
               on fds.fleet_id = b.fleet_id and fds.driver_id = b.driver_id
        left join payments p
               on p.booking_id = b.id and p.purpose = ${purpose} and p.status = 'captured'
       where b.id = ${bookingId}::uuid
       for update of b
    `)) as unknown as Array<Record<string, unknown>>;

    const row = rows[0];
    if (!row) return null;

    return {
      bookingId: row.id as string,
      status: row.status as string,
      userId: row.user_id as string,
      driverId: (row.driver_id as string | null) ?? null,
      fleetId: (row.fleet_id as string | null) ?? null,
      driverSharePct:
        row.driver_share_pct === null || row.driver_share_pct === undefined
          ? null
          : Number(row.driver_share_pct),
      band: (row.commission_band as Band | null) ?? null,
      totalRupees: row.total as string,
      taxRupees: (row.tax_amount as string | null) ?? '0',
      paymentId: (row.payment_id as string | null) ?? null,
      paymentAmount: (row.payment_amount as string | null) ?? null,
    };
  }

  /**
   * §19.3's sweep list: payments the gateway has never confirmed, on a booking
   * that is genuinely waiting for them.
   *
   * The `updated_at` floor stops the sweep racing an intent that another
   * process created moments ago; the bound stops a backlog turning one tick
   * into thousands of vendor calls, exactly as `staleNonTerminal` does.
   */
  async staleUncaptured(graceMinutes: number, limit = 200): Promise<PaymentRow[]> {
    const rows = (await this.db.execute(sql`
      select p.* from payments p
       join bookings b on b.id = p.booking_id
       where p.status in ('pending', 'authorized')
         and p.updated_at < now() - (${graceMinutes} || ' minutes')::interval
         and (
              (p.purpose = 'booking' and b.status = 'completed')
           or (p.purpose = 'cancellation_fee' and b.status <> 'cancelled')
         )
       order by p.updated_at asc
       limit ${limit}
    `)) as unknown as Array<Record<string, unknown>>;

    return rows.map(toRow);
  }
}
