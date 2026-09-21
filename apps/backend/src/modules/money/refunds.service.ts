import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import {
  ErrorCodes,
  paiseToRupeeString,
  rupeeStringToPaise,
  type DisputeLiability,
  type JobStatus,
} from '@towing/api-contracts';
import { ApiException } from '../../common/errors/api-exception';
import { DB, type Database } from '../../db/db.module';
import {
  adminRefundRowKey,
  disputeRefundRowKey,
  ledgerKeys,
  refundRowKey,
  type RefundReason,
} from '../../db/ledger/idempotency-keys';
import { LedgerService } from '../../db/ledger/ledger.service';
import {
  BookingStateMachineService,
  type TransitionResult,
} from '../bookings/booking-state-machine.service';
import { PAYMENT_GATEWAY, type PaymentGatewayPort } from './payment-gateway.port';
import { PaymentsRepo } from './payments.repo';

/**
 * W8's key source for the refunds the v1 grammar cannot express. See
 * `idempotency-keys.ts` for the full grammar rationale: a dispute refund is
 * keyed by the dispute (a second, separate dispute is a NEW refund), and a
 * finance-issued refund by `sha256(adminId:clientKey)` — the one place a
 * client header reaches a key, and only through a hash that pins the admin.
 */
export type RefundKeySource =
  { kind: 'dispute'; disputeId: string } | { kind: 'admin'; adminId: string; clientKey: string };

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
 * FULL VS PARTIAL (W8). A FULL refund reverses the remaining un-reversed
 * portion of every settlement credit leg and the booking leaves `paid`. A
 * PARTIAL refund claws back the liable party's share of X — the booking STAYS
 * `paid`, and that is safe by construction: `ledgerDrift` asks whether a paid
 * booking's credits sum to its recorded payout (partials do not touch credits),
 * while `reversalDrift` runs at EVERY status and only requires refunds not to
 * exceed credits. A chained full refund (after an earlier partial) reverses
 * only what has not already been clawed back, so the bound stays exact at
 * every step.
 *
 * (The old header claimed "a booking carrying any refund_debit leg is never
 * left in `paid`". That overstated its own reason and W8 corrected it: the
 * rule that keeps `ledgerDrift` tractable is about CREDITS, and the invariant
 * that actually guards reversals — `reversalDrift` — was designed from the
 * start to run at every status precisely so a paid booking could carry one.)
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
   * Order: legality pre-check → refund row → vendor call → compensating legs
   * → status. The row comes before the vendor call so a crash anywhere after
   * it leaves evidence that a refund was intended, and its
   * `ON CONFLICT DO NOTHING` makes the whole operation a replay rather than
   * a second refund.
   *
   * M0-F12: the landing legality is checked BEFORE the refund row, not after
   * the money moved. Learning the edge is illegal from `transition()` — after
   * the gateway refund and the compensating legs — is the same failure class
   * A8 fixed for one edge.
   */
  async refundBooking(params: {
    bookingId: string;
    /**
     * Free text since W9: the §3.5 cancellation path and the disputes still
     * pass their fixed reason codes, but a Finance-issued refund carries the
     * operator's own words — the reason lands on the row, the gateway call and
     * the audit note. With a `keySource` it never reaches a key; the legacy
     * v1 key path below is the only place a fixed code is still required.
     */
    reason: string;
    initiatedBy: string;
    /**
     * Where the booking lands afterwards. `cancelled` (§3.5) or `disputed`
     * (W8's admin route) — never `paid`, see the header. `null` when
     * the booking is already where it belongs (e.g. an admin cancelled it
     * first and the refund only settles the money): the gateway refund, the
     * compensating legs and the amount-aware payment update still run, only
     * the status write is skipped (A8).
     */
    transitionTo: 'cancelled' | 'disputed' | null;
    note?: string;
    /** W8: v2 key + `refunds.dispute_id` for dispute and finance-issued refunds. */
    keySource?: RefundKeySource;
  }): Promise<{ refundId: string; replayed: boolean }> {
    const key = params.keySource
      ? keyFromSource(params.bookingId, 'full', params.keySource)
      : // The v1 grammar is booking+reason, so it is only reachable by the
        // §3.5 path, whose reason IS one of the three RefundReason codes.
        refundRowKey(params.bookingId, params.reason as RefundReason);

    // THE IDEMPOTENCY CHECK COMES FIRST — before the captured-payment guard.
    // After a completed refund the payment is `refunded` and `capturedFor` no
    // longer finds it, so a double-submitted refund used to 409 instead of
    // replaying. W9's carry-forward wants the opposite: find the row, resume
    // whatever is left to do, report `replayed`.
    const replayed = await this.existingRefund(key);
    if (replayed) {
      await this.resumeRefund({
        refundId: replayed.id,
        bookingId: params.bookingId,
        transitionTo: params.transitionTo,
        reason: params.reason,
        note: params.note,
      });
      return { refundId: replayed.id, replayed: true };
    }

    const captured = await this.payments.capturedFor(params.bookingId, 'booking');
    if (!captured) {
      throw new ApiException(
        HttpStatus.CONFLICT,
        ErrorCodes.INVALID_BOOKING_STATE,
        'There is no captured payment on this booking to refund',
      );
    }

    if (params.transitionTo !== null) {
      const [booking] = (await this.db.execute(sql`
        select status from bookings where id = ${params.bookingId}::uuid
      `)) as unknown as Array<{ status: JobStatus }>;
      if (!booking || !BookingStateMachineService.isLegal(booking.status, params.transitionTo)) {
        throw new ApiException(
          HttpStatus.CONFLICT,
          ErrorCodes.INVALID_BOOKING_STATE,
          `A booking cannot go from ${booking?.status ?? 'unknown'} to ${params.transitionTo}`,
          { from: booking?.status ?? null, to: params.transitionTo },
        );
      }
    }

    // The REMAINING balance, not the original amount: a booking that already
    // carries partial refunds still reaches full coverage in total, and
    // `reverseLedger` below reverses only the un-clawed-back portion of each
    // credit leg, so `reversalDrift` stays exact across a chain.
    const amountPaise =
      rupeeStringToPaise(captured.amount) - rupeeStringToPaise(captured.refundedAmount);
    if (amountPaise <= 0) {
      throw new ApiException(
        HttpStatus.CONFLICT,
        ErrorCodes.INVALID_BOOKING_STATE,
        'This payment is already fully refunded',
      );
    }

    const disputeId = params.keySource?.kind === 'dispute' ? params.keySource.disputeId : null;

    const inserted = (await this.db.execute(sql`
      insert into refunds (booking_id, payment_id, amount, reason, status, idempotency_key, initiated_by, kind, dispute_id)
      values (${params.bookingId}::uuid, ${captured.id}::uuid, ${paiseToRupeeString(amountPaise)}::numeric,
              ${params.reason}, 'pending', ${key}, ${params.initiatedBy}, 'full', ${disputeId}::uuid)
      on conflict (idempotency_key) do nothing
      returning id
    `)) as unknown as Array<{ id: string }>;

    if (inserted.length === 0) {
      // Race backstop: another process inserted between the check above and
      // here. Resume from the winner and report the replay.
      const raced = await this.existingRefund(key);
      if (raced) {
        await this.resumeRefund({
          refundId: raced.id,
          bookingId: params.bookingId,
          transitionTo: params.transitionTo,
          reason: params.reason,
          note: params.note,
        });
        return { refundId: raced.id, replayed: true };
      }
      throw ApiException.conflict('The refund changed while this request was in flight');
    }

    const refundId = inserted[0]!.id;

    await this.callGateway({
      refundId,
      key,
      gatewayRef: captured.gatewayRef,
      amountPaise,
      reason: params.reason,
    });

    await this.reverseLedger(params.bookingId, refundId);

    // The booking MUST leave `paid` — see the header. A `disputed` landing is
    // W8's admin route; `cancelled` is the §3.5 path. `null` skips the
    // write when the caller already put the booking where it belongs.
    const to = params.transitionTo;
    const transitioned =
      to !== null
        ? await this.db.transaction((tx) =>
            this.machine.transition(tx, {
              bookingId: params.bookingId,
              to,
              actor: 'system',
              note: params.note ?? `Refunded (${params.reason})`,
            }),
          )
        : null;

    await this.payments.applyRefund(captured.id);

    // A18: the refund moves status (when it moves it), so it announces like
    // every other transition — after everything above committed.
    if (transitioned) {
      await this.machine.announce(transitioned);
    }

    this.logger.log(
      `event=booking_refunded booking=${params.bookingId} amount_paise=${amountPaise} ` +
        `reason=${params.reason}`,
    );

    return { refundId, replayed: false };
  }

  /**
   * A PARTIAL refund (W8): gateway refund of X, and compensating legs for the
   * LIABLE party's share — the booking stays `paid`.
   *
   * The liability names who bears X: `driver` debits the driver's wallet
   * (capped at what the settlement credited them, minus anything earlier
   * refunds already clawed back), `fleet` the fleet's, and `platform` writes no
   * legs at all — the platform absorbs its share, which is what makes the
   * "keep the ride, refund the overcharge" resolution possible without moving
   * money between the trip's parties.
   *
   * The cap is checked BEFORE the refund row and the gateway call (M0-F12's
   * lesson: never learn an amount is impossible from the database after the
   * money moved), and `reversalDrift` — which runs at every status — is the
   * invariant that proves the cumulative bound held.
   */
  async refundPartial(params: {
    bookingId: string;
    amountPaise: number;
    liability: DisputeLiability;
    reason: string;
    initiatedBy: string;
    keySource: RefundKeySource;
  }): Promise<{ refundId: string; replayed: boolean }> {
    const key = keyFromSource(params.bookingId, 'partial', params.keySource);

    // Key first, exactly like the full path: a double-submitted partial must
    // replay (resume), not start a second gateway call.
    const replayed = await this.existingRefund(key);
    if (replayed) {
      await this.resumeRefund({
        refundId: replayed.id,
        bookingId: params.bookingId,
        transitionTo: null,
        reason: params.reason,
      });
      return { refundId: replayed.id, replayed: true };
    }

    const captured = await this.payments.capturedFor(params.bookingId, 'booking');
    if (!captured) {
      throw new ApiException(
        HttpStatus.CONFLICT,
        ErrorCodes.INVALID_BOOKING_STATE,
        'There is no captured payment on this booking to refund',
      );
    }

    const remainingPaise =
      rupeeStringToPaise(captured.amount) - rupeeStringToPaise(captured.refundedAmount);
    if (params.amountPaise <= 0 || params.amountPaise > remainingPaise) {
      throw ApiException.validation('The refund exceeds what is left on this payment', {
        amountPaise: params.amountPaise,
        remainingPaise,
      });
    }

    if (params.liability !== 'platform') {
      const remainingCredit = await this.remainingCreditFor(params.bookingId, params.liability);
      if (params.amountPaise > remainingCredit) {
        throw ApiException.validation(
          `A ${params.liability} liability cannot exceed what that party was credited on this booking`,
          {
            liability: params.liability,
            amountPaise: params.amountPaise,
            remainingCreditPaise: remainingCredit,
          },
        );
      }
    }

    const disputeId = params.keySource.kind === 'dispute' ? params.keySource.disputeId : null;

    const inserted = (await this.db.execute(sql`
      insert into refunds (booking_id, payment_id, amount, reason, status, idempotency_key,
                           initiated_by, kind, liability, dispute_id)
      values (${params.bookingId}::uuid, ${captured.id}::uuid,
              ${paiseToRupeeString(params.amountPaise)}::numeric,
              ${params.reason}, 'pending', ${key}, ${params.initiatedBy}, 'partial',
              ${params.liability}, ${disputeId}::uuid)
      on conflict (idempotency_key) do nothing
      returning id
    `)) as unknown as Array<{ id: string }>;

    if (inserted.length === 0) {
      const raced = await this.existingRefund(key);
      if (raced) {
        await this.resumeRefund({
          refundId: raced.id,
          bookingId: params.bookingId,
          transitionTo: null,
          reason: params.reason,
        });
        return { refundId: raced.id, replayed: true };
      }
      throw ApiException.conflict('The refund changed while this request was in flight');
    }

    const refundId = inserted[0]!.id;

    await this.callGateway({
      refundId,
      key,
      gatewayRef: captured.gatewayRef,
      amountPaise: params.amountPaise,
      reason: params.reason,
    });

    await this.clawback(params.bookingId, refundId, params.amountPaise, params.liability);
    await this.payments.applyRefund(captured.id);

    this.logger.log(
      `event=booking_partially_refunded booking=${params.bookingId} ` +
        `amount_paise=${params.amountPaise} liability=${params.liability}`,
    );

    return { refundId, replayed: false };
  }

  /**
   * Resume a replayed refund's remaining idempotent steps (W9's carry-forward,
   * decided in M0 and owned here).
   *
   * A crash after the gateway call used to leave the money refunded with no
   * compensating legs, no transition and the payment still `captured` — and
   * the replay returned `replayed: true` and did nothing about it. Now a
   * replay converges the system: every step below is idempotent by
   * construction, so running it on a completed refund is a no-op and running
   * it on a half-finished one finishes the job.
   *
   * The gateway call is re-issued ONLY when the row carries no `gateway_ref` —
   * the crash window between the vendor's response and the row update. The
   * real adapter dedupes on the key it is handed; the dev adapter re-issues (a
   * visible log line, and the e2e pins exactly this window). A `failed` row is
   * left alone: no money moved, and a retry is a new intent with a new key.
   */
  private async resumeRefund(params: {
    refundId: string;
    bookingId: string;
    transitionTo: 'cancelled' | 'disputed' | null;
    reason: string;
    note?: string;
  }): Promise<void> {
    const [row] = (await this.db.execute(sql`
      select amount::text as amount, status, gateway_ref, kind, liability, idempotency_key
        from refunds where id = ${params.refundId}::uuid
    `)) as unknown as Array<{
      amount: string;
      status: string;
      gateway_ref: string | null;
      kind: 'full' | 'partial';
      liability: DisputeLiability | null;
      idempotency_key: string;
    }>;
    if (!row || row.status === 'failed') return;

    const amountPaise = rupeeStringToPaise(row.amount);
    const payment = await this.paymentForResume(params.bookingId);
    if (!row.gateway_ref && payment?.gatewayRef) {
      await this.callGateway({
        refundId: params.refundId,
        key: row.idempotency_key,
        gatewayRef: payment.gatewayRef,
        amountPaise,
        reason: params.reason,
      });
    }

    // Legs: the ledger keys are refund-scoped, so a second delivery of the
    // same leg is a replay, and `reverseLedger`'s remaining-aware read means
    // an already-clawed-back credit is not clawed back again.
    if (row.kind === 'full') {
      await this.reverseLedger(params.bookingId, params.refundId);
    } else if (row.liability && row.liability !== 'platform') {
      await this.clawback(params.bookingId, params.refundId, amountPaise, row.liability);
    }

    // The transition, skipped when the booking already reached the target —
    // both because re-running it would 409 on the state machine and because
    // "already there" is the converged state this resume exists to reach.
    let transitioned: TransitionResult | null = null;
    if (params.transitionTo !== null) {
      const [booking] = (await this.db.execute(sql`
        select status from bookings where id = ${params.bookingId}::uuid
      `)) as unknown as Array<{ status: JobStatus }>;
      if (booking && booking.status !== params.transitionTo) {
        transitioned = await this.db.transaction((tx) =>
          this.machine.transition(tx, {
            bookingId: params.bookingId,
            to: params.transitionTo!,
            actor: 'system',
            note: params.note ?? `Refunded (${params.reason})`,
          }),
        );
      }
    }

    // A recompute, not an increment — the second delivery cannot double-count.
    if (payment) await this.payments.applyRefund(payment.id);
    if (transitioned) await this.machine.announce(transitioned);

    this.logger.log(
      `event=refund_resumed refund=${params.refundId} booking=${params.bookingId} ` +
        `amount_paise=${amountPaise}`,
    );
  }

  /** The refund row for a key, when one exists — the replay check both paths share. */
  private async existingRefund(key: string): Promise<{ id: string } | null> {
    const [row] = (await this.db.execute(sql`
      select id from refunds where idempotency_key = ${key}
    `)) as unknown as Array<{ id: string }>;
    return row ?? null;
  }

  /**
   * The booking's booking-purpose payment, for a resume to re-issue against —
   * read without the `captured` filter on purpose: by the time a replay lands,
   * the payment may already be `refunded`, and that is exactly the row whose
   * `gateway_ref` (and id) the resume needs.
   */
  private async paymentForResume(
    bookingId: string,
  ): Promise<{ id: string; gatewayRef: string | null } | null> {
    const [row] = (await this.db.execute(sql`
      select id, gateway_ref from payments
       where booking_id = ${bookingId}::uuid and purpose = 'booking'
       order by created_at desc limit 1
    `)) as unknown as Array<{ id: string; gateway_ref: string | null }>;
    return row ? { id: row.id, gatewayRef: row.gateway_ref } : null;
  }

  /**
   * The vendor call, extracted so the first attempt and a resumed one cannot
   * drift. `attempts: 1` inside the adapter — a blind retry would issue a
   * second refund against the same payment.
   */
  private async callGateway(params: {
    refundId: string;
    key: string;
    gatewayRef: string | null;
    amountPaise: number;
    reason: string;
  }): Promise<void> {
    if (!params.gatewayRef) return;
    try {
      const handle = await this.gateway.refund({
        gatewayRef: params.gatewayRef,
        amountPaise: params.amountPaise,
        idempotencyKey: params.key,
        reason: params.reason,
      });
      await this.db.execute(sql`
        update refunds
           set status = ${handle.status === 'processed' ? 'processed' : 'pending'}::refund_status,
               gateway_ref = ${handle.refundRef},
               processed_at = ${handle.status === 'processed' ? sql`now()` : sql`null`},
               updated_at = now()
         where id = ${params.refundId}::uuid
      `);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.db.execute(sql`
        update refunds set status = 'failed', failure_reason = ${message}, updated_at = now()
         where id = ${params.refundId}::uuid
      `);
      throw error;
    }
  }

  /** The settlement credit legs on a booking, per wallet owner. */
  private async settlementCredits(
    bookingId: string,
  ): Promise<
    Array<{ ownerType: 'user' | 'driver' | 'fleet'; ownerId: string; creditedPaise: number }>
  > {
    const rows = (await this.db.execute(sql`
      select w.owner_type, w.owner_id, coalesce(sum(t.amount), 0) as credited
        from wallet_transactions t
        join wallets w on w.id = t.wallet_id
       where t.ref_id = ${bookingId}::uuid
         and t.type in ('driver_share_credit', 'fleet_share_credit', 'fare_credit')
       group by w.owner_type, w.owner_id
    `)) as unknown as Array<{
      owner_type: 'user' | 'driver' | 'fleet';
      owner_id: string;
      credited: string;
    }>;
    return rows.map((row) => ({
      ownerType: row.owner_type,
      ownerId: row.owner_id,
      creditedPaise: rupeeStringToPaise(row.credited),
    }));
  }

  /** What earlier refunds have already clawed back, per wallet owner. */
  private async reversedByOwner(bookingId: string): Promise<Map<string, number>> {
    const rows = (await this.db.execute(sql`
      select w.owner_type, w.owner_id, coalesce(sum(t.amount), 0) as reversed
        from wallet_transactions t
        join wallets w on w.id = t.wallet_id
       where t.ref_id = ${bookingId}::uuid and t.type = 'refund_debit'
       group by w.owner_type, w.owner_id
    `)) as unknown as Array<{
      owner_type: 'user' | 'driver' | 'fleet';
      owner_id: string;
      reversed: string;
    }>;
    // Amounts are negative; the map stores the absolute clawed-back total.
    return new Map(
      rows.map((row) => [`${row.owner_type}:${row.owner_id}`, -rupeeStringToPaise(row.reversed)]),
    );
  }

  /** Credited minus already-clawed, for one liability party — the partial cap. */
  private async remainingCreditFor(
    bookingId: string,
    liability: Exclude<DisputeLiability, 'platform'>,
  ): Promise<number> {
    const credits = (await this.settlementCredits(bookingId)).filter(
      (credit) => credit.ownerType === liability,
    );
    if (credits.length === 0) return 0;
    const reversed = await this.reversedByOwner(bookingId);
    return credits.reduce(
      (total, credit) =>
        total +
        Math.max(
          0,
          credit.creditedPaise - (reversed.get(`${credit.ownerType}:${credit.ownerId}`) ?? 0),
        ),
      0,
    );
  }

  /**
   * The compensating legs: reverse the REMAINING un-reversed portion of each
   * settlement credit leg, wallet by wallet.
   *
   * Reading them rather than recomputing is deliberate. A recompute would use
   * today's commission table and today's split, and §14.5's whole point is that
   * history stays intact — the reversal has to undo what was actually credited,
   * not what would be credited if the same trip happened now.
   *
   * REMAINING, not the original totals, because a booking can be refunded in
   * steps (a partial, then a full): reversing the same credit twice would push
   * `reversalDrift` non-zero, and on a replay this method must be a no-op
   * rather than a second clawback.
   */
  private async reverseLedger(bookingId: string, refundId: string): Promise<void> {
    const credits = await this.settlementCredits(bookingId);
    if (credits.length === 0) return;

    const reversed = await this.reversedByOwner(bookingId);
    const legs = credits
      .map((credit) => {
        const remaining =
          credit.creditedPaise - (reversed.get(`${credit.ownerType}:${credit.ownerId}`) ?? 0);
        return { credit, remaining };
      })
      .filter(({ remaining }) => remaining > 0)
      .map(({ credit, remaining }) => ({
        owner: { ownerType: credit.ownerType, ownerId: credit.ownerId },
        type: 'refund_debit' as const,
        amountPaise: -remaining,
        reason: 'Reversed — booking refunded',
        refId: bookingId,
        idempotencyKey:
          credit.ownerType === 'fleet'
            ? ledgerKeys.refundFleetDebit(refundId)
            : ledgerKeys.refundDriverDebit(refundId),
      }));

    await this.ledger.post(legs);
  }

  /**
   * The partial refund's single clawback leg: X debited from the liable
   * party's wallet, keyed per refund so a resume is a ledger replay rather
   * than a second debit. `platform` writes nothing — the platform absorbs it.
   */
  private async clawback(
    bookingId: string,
    refundId: string,
    amountPaise: number,
    liability: DisputeLiability,
  ): Promise<void> {
    if (liability === 'platform') return;
    const owner = (await this.settlementCredits(bookingId)).find(
      (credit) => credit.ownerType === liability,
    );
    if (!owner) return;

    await this.ledger.post([
      {
        owner: { ownerType: owner.ownerType, ownerId: owner.ownerId },
        type: 'refund_debit' as const,
        amountPaise: -amountPaise,
        reason: `Partial refund clawback (${liability})`,
        refId: bookingId,
        idempotencyKey:
          owner.ownerType === 'fleet'
            ? ledgerKeys.refundFleetDebit(refundId)
            : ledgerKeys.refundDriverDebit(refundId),
      },
    ]);
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

/** The v2 row key for a dispute- or finance-sourced refund. See `idempotency-keys.ts`. */
function keyFromSource(
  bookingId: string,
  kind: 'full' | 'partial',
  source: RefundKeySource,
): string {
  return source.kind === 'dispute'
    ? disputeRefundRowKey(bookingId, kind, source.disputeId)
    : adminRefundRowKey(bookingId, kind, source.adminId, source.clientKey);
}
