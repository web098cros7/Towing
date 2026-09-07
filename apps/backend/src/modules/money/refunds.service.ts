import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { ErrorCodes, paiseToRupeeString, rupeeStringToPaise } from '@towing/api-contracts';
import { ApiException } from '../../common/errors/api-exception';
import { DB, type Database } from '../../db/db.module';
import {
  ledgerKeys,
  refundRowKey,
  type RefundReason,
} from '../../db/ledger/idempotency-keys';
import { LedgerService } from '../../db/ledger/ledger.service';
import { BookingStateMachineService } from '../bookings/booking-state-machine.service';
import { PAYMENT_GATEWAY, type PaymentGatewayPort } from './payment-gateway.port';
import { PaymentsRepo } from './payments.repo';

/**
 * §14.5 — refunds and dispute reversals, and the first writer `refunds` has
 * ever had. (The table has existed since migration 0001 and even the seed
 * leaves it empty.)
 *
 * COMPENSATING ENTRIES, NEVER EDITS. §14.5 is explicit: "the commission and
 * driver credit are reversed by compensating ledger entries (never edits) so
 * history stays intact." `sole-writer.spec.ts` enforces the mechanical half —
 * no file outside the ledger may UPDATE or DELETE a `wallet_transactions` row —
 * and this service supplies the discipline: a reversal is a NEW leg with the
 * opposite sign and its own idempotency key.
 *
 * FULL REVERSALS ONLY IN PHASE 19. A partial refund needs a rule for what
 * fraction of the commission is returned and what the driver keeps, and that
 * rule belongs with Phase 20's admin dispute route where a human decides it.
 * Shipping a half-answer now would mean guessing.
 *
 * ⚠ THE RULE THAT KEEPS `ledgerDrift` TRACTABLE: a booking carrying any
 * `refund_debit` leg is never left in `paid`. `ledgerDrift` asks whether a PAID
 * booking's credits sum to its recorded payout, which a reversal makes false by
 * design — so a reversed booking must leave that status. `reversalDrift` is the
 * check that covers it instead, and it deliberately runs at every status.
 */
@Injectable()
export class RefundsService {
  private readonly logger = new Logger(RefundsService.name);

  constructor(
    private readonly payments: PaymentsRepo,
    private readonly ledger: LedgerService,
    private readonly machine: BookingStateMachineService,
    @Inject(DB) private readonly db: Database,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGatewayPort,
  ) {}

  /**
   * Reverses a paid booking in full.
   *
   * Order: refund row → vendor call → compensating legs → status. The row comes
   * first so a crash anywhere after it leaves evidence that a refund was
   * intended, and its `ON CONFLICT DO NOTHING` makes the whole operation a
   * replay rather than a second refund.
   */
  async refundBooking(params: {
    bookingId: string;
    reason: RefundReason;
    initiatedBy: string;
    /** Where the booking lands afterwards. Never `paid` — see the header. */
    to: 'cancelled' | 'disputed';
    note?: string;
  }): Promise<{ refundId: string; replayed: boolean }> {
    const captured = await this.payments.capturedFor(params.bookingId, 'booking');
    if (!captured) {
      throw new ApiException(
        HttpStatus.CONFLICT,
        ErrorCodes.INVALID_BOOKING_STATE,
        'There is no captured payment on this booking to refund',
      );
    }

    const amountPaise = rupeeStringToPaise(captured.amount);
    const key = refundRowKey(params.bookingId, params.reason);

    const inserted = (await this.db.execute(sql`
      insert into refunds (booking_id, amount, reason, status, idempotency_key, initiated_by)
      values (${params.bookingId}::uuid, ${paiseToRupeeString(amountPaise)}::numeric,
              ${params.reason}, 'pending', ${key}, ${params.initiatedBy})
      on conflict (idempotency_key) do nothing
      returning id
    `)) as unknown as Array<{ id: string }>;

    if (inserted.length === 0) {
      // Already refunded for this reason. The money moved once; say so and
      // stop, exactly as `PayoutsService` treats a replayed request.
      const [existing] = (await this.db.execute(sql`
        select id from refunds where idempotency_key = ${key}
      `)) as unknown as Array<{ id: string }>;
      return { refundId: existing!.id, replayed: true };
    }

    const refundId = inserted[0]!.id;

    // `attempts: 1` inside the adapter — a blind retry would issue a second
    // refund against the same payment.
    if (captured.gatewayRef) {
      try {
        const handle = await this.gateway.refund({
          gatewayRef: captured.gatewayRef,
          amountPaise,
          idempotencyKey: key,
          reason: params.reason,
        });
        await this.db.execute(sql`
          update refunds
             set status = ${handle.status === 'processed' ? 'processed' : 'pending'}::refund_status,
                 gateway_ref = ${handle.refundRef},
                 processed_at = ${handle.status === 'processed' ? sql`now()` : sql`null`},
                 updated_at = now()
           where id = ${refundId}::uuid
        `);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await this.db.execute(sql`
          update refunds set status = 'failed', failure_reason = ${message}, updated_at = now()
           where id = ${refundId}::uuid
        `);
        throw error;
      }
    }

    await this.reverseLedger(params.bookingId, refundId);

    // The booking MUST leave `paid` — see the header. A `disputed` landing is
    // Phase 20's admin route; `cancelled` is the §3.5 path.
    await this.db.transaction((tx) =>
      this.machine.transition(tx, {
        bookingId: params.bookingId,
        to: params.to,
        actor: 'system',
        note: params.note ?? `Refunded (${params.reason})`,
      }),
    );

    await this.payments.markRefunded(captured.id);

    this.logger.log(
      `event=booking_refunded booking=${params.bookingId} amount_paise=${amountPaise} ` +
        `reason=${params.reason}`,
    );

    return { refundId, replayed: false };
  }

  /**
   * The compensating legs: read the ORIGINAL credits back and negate each one.
   *
   * Reading them rather than recomputing is deliberate. A recompute would use
   * today's commission table and today's split, and §14.5's whole point is that
   * history stays intact — the reversal has to undo what was actually credited,
   * not what would be credited if the same trip happened now.
   */
  private async reverseLedger(bookingId: string, refundId: string): Promise<void> {
    const legs = (await this.db.execute(sql`
      select w.owner_type, w.owner_id, t.amount, t.type
        from wallet_transactions t
        join wallets w on w.id = t.wallet_id
       where t.ref_id = ${bookingId}::uuid
         and t.type in ('driver_share_credit', 'fleet_share_credit', 'fare_credit')
    `)) as unknown as Array<{
      owner_type: 'user' | 'driver' | 'fleet';
      owner_id: string;
      amount: string;
      type: string;
    }>;

    if (legs.length === 0) return;

    await this.ledger.post(
      legs.map((leg) => ({
        owner: { ownerType: leg.owner_type, ownerId: leg.owner_id },
        type: 'refund_debit' as const,
        amountPaise: -rupeeStringToPaise(leg.amount),
        reason: 'Reversed — booking refunded',
        refId: bookingId,
        idempotencyKey:
          leg.owner_type === 'fleet'
            ? ledgerKeys.refundFleetDebit(refundId)
            : ledgerKeys.refundDriverDebit(refundId),
      })),
    );
  }

  /** The webhook's confirmation that the vendor actually moved the money. */
  async markProcessedByGatewayRef(gatewayRef: string): Promise<void> {
    await this.db.execute(sql`
      update refunds
         set status = 'processed', processed_at = now(), updated_at = now()
       where gateway_ref = ${gatewayRef} and status = 'pending'
    `);
  }
}
