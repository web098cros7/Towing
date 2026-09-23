import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import {
  ErrorCodes,
  bearerFor,
  paiseToRupeeString,
  rupeeStringToPaise,
  type DisputeLiability,
  type JobStatus,
  type PartialRefundTerms,
  type RefundBearer,
  type RefundCause,
  type RefundDelivery,
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
import { CouponsService } from '../coupons/coupons.service';
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
 *
 * WHERE A REFUND GOES. A booking can be paid through the gateway, partly or
 * wholly from the customer's MiTow wallet, in cash to the driver, or with a
 * coupon applied at payment time. The captured `booking` payment therefore
 * carries TWO refundable pools:
 *
 *   gatewayPool = provider is 'cash' or 'wallet' ? 0 : amount
 *   walletPool  = walletApplied + (provider === 'cash' ? amount : 0)
 *
 * Cash can only be returned digitally, as wallet credit — the driver already
 * holds the notes, and reversing their pool credit while the
 * `cash_collected_debit` stays is exactly what leaves them owing it. A full
 * refund returns both remaining pools; a partial spends the gateway pool
 * FIRST and only then the wallet pool. A refund with no gateway part needs no
 * vendor call and is marked `processed` as soon as the wallet credit lands.
 * A full refund also releases the booking's coupon.
 */
@Injectable()
export class RefundsService {
  private readonly logger = new Logger(RefundsService.name);

  constructor(
    private readonly payments: PaymentsRepo,
    private readonly ledger: LedgerService,
    private readonly machine: BookingStateMachineService,
    private readonly coupons: CouponsService,
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
    transitionTo: 'cancelled' | 'refunded' | 'disputed' | null;
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

    // The REMAINING balance, split across the two pools. A booking that
    // already carries partial refunds still reaches full coverage in total,
    // and `reverseLedger` below reverses only the un-clawed-back portion of
    // each credit leg, so `reversalDrift` stays exact across a chain.
    const split = await this.refundedSplit(captured.id);
    const gatewayPool = gatewayPoolFor(captured);
    const walletPool = walletPoolFor(captured);
    const remainingGateway = gatewayPool - split.gatewayPaise;
    const remainingWallet = walletPool - split.walletPaise;
    const amountPaise = remainingGateway + remainingWallet;
    if (amountPaise <= 0) {
      throw new ApiException(
        HttpStatus.CONFLICT,
        ErrorCodes.INVALID_BOOKING_STATE,
        'This payment is already fully refunded',
      );
    }

    const disputeId = params.keySource?.kind === 'dispute' ? params.keySource.disputeId : null;

    const inserted = (await this.db.execute(sql`
      insert into refunds (booking_id, payment_id, amount, gateway_amount, wallet_amount,
                           reason, status, idempotency_key, initiated_by, kind, dispute_id)
      values (${params.bookingId}::uuid, ${captured.id}::uuid,
              ${paiseToRupeeString(amountPaise)}::numeric,
              ${paiseToRupeeString(remainingGateway)}::numeric,
              ${paiseToRupeeString(remainingWallet)}::numeric,
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
      gatewayPaise: remainingGateway,
      reason: params.reason,
    });

    if (remainingWallet > 0) {
      await this.creditWallet(params.bookingId, refundId, remainingWallet);
    }

    // A refund with no gateway part needs no vendor confirmation: the wallet
    // credit above is the whole movement, so the row is done.
    if (remainingGateway === 0) {
      await this.db.execute(sql`
        update refunds set status = 'processed', processed_at = now(), updated_at = now()
         where id = ${refundId}::uuid
      `);
    }

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

    // A full refund gives the coupon back — the customer did not get the trip
    // the discount was for. In its own transaction so a coupon failure cannot
    // roll back the money that already moved.
    await this.db.transaction((tx) => this.coupons.releaseForBooking(tx, params.bookingId));

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
   * A PARTIAL refund (W8, reworked for ADM-6): refund X to the customer and
   * claw back the driver side's part of it. The booking stays `paid`.
   *
   * WHO PAYS IS DECIDED BY THE CAUSE (ADM-6, Ehsan 23 Sep, after comparing
   * Uber, Ola and Rapido). The admin states why the refund is given, and
   * `DEFAULT_BEARER_BY_CAUSE` turns that into a bearer, which they may override
   * with a written reason:
   *
   *   shared    the driver side gives back X times the share of the customer's
   *             payment it was credited, and the platform the rest. The
   *             fare-recalculation rule: if the fare was wrong, everyone who was
   *             paid out of it gives back their part of the difference.
   *   platform  nothing is clawed back; the platform absorbs X.
   *   provider  the driver side gives back all of X.
   *
   * "The driver side" is whoever the trip actually credited: an independent
   * driver, or a fleet and its driver. It is READ from the settlement legs,
   * never named by the admin, so a fleet that does not exist cannot be charged.
   *
   * THE CAP: the driver side never gives back more than it was credited on
   * this booking, minus what earlier refunds already took. A `provider` refund
   * above that is refused, before any money moves (M0-F12's lesson: never learn
   * an amount is impossible after the gateway call). `reversalDrift`, which runs
   * at every status, is the invariant that proves the cumulative bound held.
   *
   * DELIVERY. `original` spends the gateway pool first and returns it to the
   * card, then the wallet pool to the wallet: unchanged. `wallet` spends the
   * pools in the same order, so the remaining balance of each stays exact for
   * any later refund, but sends every rupee to the customer's MiTow wallet and
   * makes no gateway call.
   */
  async refundPartial(params: {
    bookingId: string;
    amountPaise: number;
    terms: PartialRefundTerms;
    reason: string;
    initiatedBy: string;
    keySource: RefundKeySource;
  }): Promise<{ refundId: string; replayed: boolean; providerSharePaise: number }> {
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
      return {
        refundId: replayed.id,
        replayed: true,
        providerSharePaise: await this.storedProviderShare(replayed.id),
      };
    }

    const captured = await this.payments.capturedFor(params.bookingId, 'booking');
    if (!captured) {
      throw new ApiException(
        HttpStatus.CONFLICT,
        ErrorCodes.INVALID_BOOKING_STATE,
        'There is no captured payment on this booking to refund',
      );
    }

    const split = await this.refundedSplit(captured.id);
    const gatewayPool = gatewayPoolFor(captured);
    const walletPool = walletPoolFor(captured);
    const remainingGateway = gatewayPool - split.gatewayPaise;
    const remainingWallet = walletPool - split.walletPaise;
    const remainingPaise = remainingGateway + remainingWallet;
    if (params.amountPaise <= 0 || params.amountPaise > remainingPaise) {
      throw ApiException.validation('The refund exceeds what is left on this payment', {
        amountPaise: params.amountPaise,
        remainingPaise,
      });
    }

    // Which POOL each rupee comes from: the gateway pool first, so the
    // customer's wallet credit is the last resort. Recorded the same way for
    // both deliveries (see `refunds.gateway_amount`).
    const gatewayPaise = Math.min(params.amountPaise, remainingGateway);
    const walletPaise = params.amountPaise - gatewayPaise;

    const bearer = bearerFor(params.terms);
    const provider = await this.providerCredit(params.bookingId);
    const providerSharePaise = providerShareFor({
      bearer,
      amountPaise: params.amountPaise,
      providerCreditedPaise: provider.creditedPaise,
      customerPaidPaise: gatewayPool + walletPool,
    });
    if (providerSharePaise > provider.remainingPaise) {
      throw ApiException.validation(
        'The driver cannot give back more than this trip paid them',
        {
          bearer,
          amountPaise: params.amountPaise,
          providerSharePaise,
          remainingCreditPaise: provider.remainingPaise,
        },
      );
    }

    const disputeId = params.keySource.kind === 'dispute' ? params.keySource.disputeId : null;
    const delivery = params.terms.delivery;

    const inserted = (await this.db.execute(sql`
      insert into refunds (booking_id, payment_id, amount, gateway_amount, wallet_amount,
                           reason, status, idempotency_key,
                           initiated_by, kind, liability, dispute_id,
                           cause, delivery, provider_share, bearer_override_reason)
      values (${params.bookingId}::uuid, ${captured.id}::uuid,
              ${paiseToRupeeString(params.amountPaise)}::numeric,
              ${paiseToRupeeString(gatewayPaise)}::numeric,
              ${paiseToRupeeString(walletPaise)}::numeric,
              ${params.reason}, 'pending', ${key}, ${params.initiatedBy}, 'partial',
              ${bearer}, ${disputeId}::uuid,
              ${params.terms.cause}, ${delivery},
              ${paiseToRupeeString(providerSharePaise)}::numeric,
              ${params.terms.overrideReason ?? null})
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
        return {
          refundId: raced.id,
          replayed: true,
          providerSharePaise: await this.storedProviderShare(raced.id),
        };
      }
      throw ApiException.conflict('The refund changed while this request was in flight');
    }

    const refundId = inserted[0]!.id;
    const delivered = deliveredSplit({ delivery, gatewayPaise, walletPaise });

    await this.callGateway({
      refundId,
      key,
      gatewayRef: captured.gatewayRef,
      gatewayPaise: delivered.toGatewayPaise,
      reason: params.reason,
    });

    if (delivered.toWalletPaise > 0) {
      await this.creditWallet(params.bookingId, refundId, delivered.toWalletPaise);
    }

    if (delivered.toGatewayPaise === 0) {
      await this.db.execute(sql`
        update refunds set status = 'processed', processed_at = now(), updated_at = now()
         where id = ${refundId}::uuid
      `);
    }

    await this.clawback(params.bookingId, refundId, providerSharePaise, params.terms.cause);
    await this.payments.applyRefund(captured.id);

    this.logger.log(
      `event=booking_partially_refunded booking=${params.bookingId} ` +
        `amount_paise=${params.amountPaise} cause=${params.terms.cause} bearer=${bearer} ` +
        `provider_share_paise=${providerSharePaise} delivery=${delivery}`,
    );

    return { refundId, replayed: false, providerSharePaise };
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
    transitionTo: 'cancelled' | 'refunded' | 'disputed' | null;
    reason: string;
    note?: string;
  }): Promise<void> {
    const [row] = (await this.db.execute(sql`
      select amount::text as amount,
             gateway_amount::text as gateway_amount,
             wallet_amount::text as wallet_amount,
             status, gateway_ref, kind, liability, idempotency_key,
             delivery, cause, provider_share::text as provider_share
        from refunds where id = ${params.refundId}::uuid
    `)) as unknown as Array<{
      amount: string;
      gateway_amount: string;
      wallet_amount: string;
      status: string;
      gateway_ref: string | null;
      kind: 'full' | 'partial';
      liability: DisputeLiability | null;
      idempotency_key: string;
      delivery: RefundDelivery;
      cause: RefundCause | null;
      provider_share: string | null;
    }>;
    if (!row || row.status === 'failed') return;

    const amountPaise = rupeeStringToPaise(row.amount);
    // Where the money is SENT, not which pool it came from: a `wallet`
    // delivery sends the gateway pool's part to the wallet too.
    const { toGatewayPaise: gatewayPaise, toWalletPaise: walletPaise } = deliveredSplit({
      delivery: row.delivery,
      gatewayPaise: rupeeStringToPaise(row.gateway_amount),
      walletPaise: rupeeStringToPaise(row.wallet_amount),
    });
    const payment = await this.paymentForResume(params.bookingId);

    // The gateway call is re-issued ONLY when the row carries no `gateway_ref`
    // AND the stored split says there was a gateway part AND the payment's ref
    // is a real gateway ref — a cash or wallet-only payment has nothing to
    // call.
    if (
      !row.gateway_ref &&
      gatewayPaise > 0 &&
      payment?.gatewayRef &&
      isRealGatewayRef(payment.gatewayRef)
    ) {
      await this.callGateway({
        refundId: params.refundId,
        key: row.idempotency_key,
        gatewayRef: payment.gatewayRef,
        gatewayPaise,
        reason: params.reason,
      });
    }

    // The wallet credit leg is idempotent by its refund-scoped key, so a
    // second delivery is a replay.
    if (walletPaise > 0) {
      await this.creditWallet(params.bookingId, params.refundId, walletPaise);
    }

    // A refund with no gateway part is done as soon as the wallet credit
    // lands — mark it processed if it is still pending.
    if (gatewayPaise === 0 && row.status === 'pending') {
      await this.db.execute(sql`
        update refunds set status = 'processed', processed_at = now(), updated_at = now()
         where id = ${params.refundId}::uuid
      `);
    }

    // Legs: the ledger keys are refund-scoped, so a second delivery of the
    // same leg is a replay, and `reverseLedger`'s remaining-aware read means
    // an already-clawed-back credit is not clawed back again.
    if (row.kind === 'full') {
      await this.reverseLedger(params.bookingId, params.refundId);
    } else if (row.provider_share !== null) {
      // ADM-6: the share decided at issue time, never recomputed (see the
      // column). Zero for a platform-borne refund, which posts nothing.
      await this.clawback(
        params.bookingId,
        params.refundId,
        rupeeStringToPaise(row.provider_share),
        row.cause,
      );
    } else if (row.liability === 'driver' || row.liability === 'fleet') {
      // A refund issued before ADM-6: the named party bore all of X.
      await this.legacyClawback(params.bookingId, params.refundId, amountPaise, row.liability);
    }

    // A full refund gives the coupon back — idempotent because
    // `releaseForBooking` deletes the redemption row and a second call finds
    // nothing to release.
    if (row.kind === 'full') {
      await this.db.transaction((tx) => this.coupons.releaseForBooking(tx, params.bookingId));
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
   *
   * SKIPPED when there is no gateway part to refund (`gatewayPaise === 0`) or
   * when the payment's ref is not a real gateway ref — a cash payment's
   * `cash-…` and a wallet-only payment's `wallet-…` are placeholders, not
   * handles the vendor would recognise.
   */
  private async callGateway(params: {
    refundId: string;
    key: string;
    gatewayRef: string | null;
    gatewayPaise: number;
    reason: string;
  }): Promise<void> {
    if (params.gatewayPaise <= 0) return;
    if (!params.gatewayRef || !isRealGatewayRef(params.gatewayRef)) return;
    try {
      const handle = await this.gateway.refund({
        gatewayRef: params.gatewayRef,
        amountPaise: params.gatewayPaise,
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

  /**
   * What earlier refunds have already taken from each pool of a payment.
   *
   * The two pools are independent: a partial that spent the gateway pool does
   * not reduce the wallet pool, and vice versa. Summing the split columns over
   * the payment's non-failed refunds is the exact mirror of what
   * `applyRefund` writes back to `payments.refunded_amount`.
   */
  private async refundedSplit(
    paymentId: string,
  ): Promise<{ gatewayPaise: number; walletPaise: number }> {
    const [row] = (await this.db.execute(sql`
      select coalesce(sum(gateway_amount), 0)::text as gateway,
             coalesce(sum(wallet_amount), 0)::text as wallet
        from refunds
       where payment_id = ${paymentId}::uuid and status <> 'failed'
    `)) as unknown as Array<{ gateway: string; wallet: string }>;
    return {
      gatewayPaise: rupeeStringToPaise(row?.gateway ?? '0'),
      walletPaise: rupeeStringToPaise(row?.wallet ?? '0'),
    };
  }

  /**
   * The customer's wallet credit for the wallet part of a refund.
   *
   * ONE leg, keyed per refund, so a resume is a ledger replay rather than a
   * second credit. The owner is read from `bookings.user_id` — the refund row
   * carries no user, and the booking is the source of truth for whose money
   * this is.
   */
  private async creditWallet(
    bookingId: string,
    refundId: string,
    amountPaise: number,
  ): Promise<void> {
    const [booking] = (await this.db.execute(sql`
      select user_id from bookings where id = ${bookingId}::uuid
    `)) as unknown as Array<{ user_id: string }>;
    if (!booking) return;

    await this.ledger.post([
      {
        owner: { ownerType: 'user', ownerId: booking.user_id },
        type: 'refund_credit' as const,
        amountPaise,
        reason: `Refund for booking TW-${bookingId.slice(0, 8).toUpperCase()}`,
        refId: bookingId,
        idempotencyKey: ledgerKeys.refundUserCredit(refundId),
      },
    ]);
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
   * The driver side's part of a partial refund, taken back from whoever the
   * trip credited, in proportion to what each still holds from it.
   *
   * An independent driver is one wallet. A fleet trip credits the fleet AND
   * its driver, and both give back their proportion: charging only one of
   * them would make the split depend on which wallet the admin happened to
   * think of. The last owner takes the rounding remainder so the legs sum to
   * exactly `providerSharePaise`. Keys are per refund and per owner type, so a
   * resume is a ledger replay rather than a second debit.
   */
  private async clawback(
    bookingId: string,
    refundId: string,
    providerSharePaise: number,
    cause: RefundCause | null,
  ): Promise<void> {
    if (providerSharePaise <= 0) return;

    const reversed = await this.reversedByOwner(bookingId);
    const owners = (await this.settlementCredits(bookingId))
      .filter((credit) => credit.ownerType === 'driver' || credit.ownerType === 'fleet')
      .map((credit) => ({
        ...credit,
        remaining: Math.max(
          0,
          credit.creditedPaise - (reversed.get(`${credit.ownerType}:${credit.ownerId}`) ?? 0),
        ),
      }));
    const pool = owners.reduce((total, owner) => total + owner.remaining, 0);
    if (pool <= 0) return;

    // Safe to recompute on a resume: `ledger.post` writes every leg in ONE
    // transaction and treats a key already present as a replay. So either
    // none of this refund's legs landed (the proportions below are the ones
    // the first attempt saw) or all of them did (every leg is a no-op replay,
    // whatever amount it now computes).
    let left = providerSharePaise;
    const legs = owners
      .filter((owner) => owner.remaining > 0)
      .map((owner, index, all) => {
        const share =
          index === all.length - 1
            ? left
            : Math.round((providerSharePaise * owner.remaining) / pool);
        left -= share;
        return { owner, share };
      })
      .filter(({ share }) => share > 0)
      .map(({ owner, share }) => ({
        owner: { ownerType: owner.ownerType, ownerId: owner.ownerId },
        type: 'refund_debit' as const,
        amountPaise: -share,
        reason: adjustmentLabel(cause),
        refId: bookingId,
        idempotencyKey:
          owner.ownerType === 'fleet'
            ? ledgerKeys.refundFleetDebit(refundId)
            : ledgerKeys.refundDriverDebit(refundId),
      }));

    if (legs.length > 0) await this.ledger.post(legs);
  }

  /**
   * A pre-ADM-6 partial refund's clawback: the one party the admin named bore
   * all of X. Only reachable by resuming a refund issued before 0040; nothing
   * issues this shape any more.
   */
  private async legacyClawback(
    bookingId: string,
    refundId: string,
    amountPaise: number,
    liability: 'driver' | 'fleet',
  ): Promise<void> {
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

  /**
   * What the driver side was credited on this booking, and how much of it
   * earlier refunds have not already taken back.
   */
  private async providerCredit(
    bookingId: string,
  ): Promise<{ creditedPaise: number; remainingPaise: number }> {
    const reversed = await this.reversedByOwner(bookingId);
    let creditedPaise = 0;
    let remainingPaise = 0;
    for (const credit of await this.settlementCredits(bookingId)) {
      if (credit.ownerType !== 'driver' && credit.ownerType !== 'fleet') continue;
      creditedPaise += credit.creditedPaise;
      remainingPaise += Math.max(
        0,
        credit.creditedPaise - (reversed.get(`${credit.ownerType}:${credit.ownerId}`) ?? 0),
      );
    }
    return { creditedPaise, remainingPaise };
  }

  private async storedProviderShare(refundId: string): Promise<number> {
    const [row] = (await this.db.execute(sql`
      select provider_share::text as provider_share from refunds where id = ${refundId}::uuid
    `)) as unknown as Array<{ provider_share: string | null }>;
    return row?.provider_share ? rupeeStringToPaise(row.provider_share) : 0;
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

/**
 * The gateway pool of a captured `booking` payment: what the vendor actually
 * holds and can be asked to refund. A cash payment's money is in the driver's
 * pocket and a wallet-only payment never touched the vendor, so both are 0.
 */
function gatewayPoolFor(payment: { amount: string; provider: string | null }): number {
  if (payment.provider === 'cash' || payment.provider === 'wallet') return 0;
  return rupeeStringToPaise(payment.amount);
}

/**
 * The wallet pool of a captured `booking` payment: what was spent from the
 * customer's MiTow balance, PLUS the whole amount of a cash payment — cash can
 * only be returned digitally, as wallet credit, because the driver already
 * holds the notes.
 */
function walletPoolFor(payment: {
  amount: string;
  walletApplied: string;
  provider: string | null;
}): number {
  const walletApplied = rupeeStringToPaise(payment.walletApplied);
  if (payment.provider === 'cash') return walletApplied + rupeeStringToPaise(payment.amount);
  return walletApplied;
}

/**
 * A real gateway ref is anything the vendor issued. The `cash-…` and
 * `wallet-…` prefixes are this application's own placeholders for payments
 * that never reached the vendor, and calling `refund` with one would be a
 * vendor error at best.
 */
function isRealGatewayRef(ref: string): boolean {
  return !ref.startsWith('cash-') && !ref.startsWith('wallet-');
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

/**
 * The driver side's part of a partial refund of X.
 *
 * `shared` is the fare-recalculation rule: the driver side was credited
 * `providerCredited` out of the `customerPaid` the customer handed over, so it
 * gives back that same fraction of X. The platform's part is the rest, which
 * is its commission's share of the refund (and the tax's, while GST is 0).
 * Rounded to the paisa; the cap check in `refundPartial` sees the rounded
 * figure, so rounding can never push a driver past what they were paid.
 */
export function providerShareFor(params: {
  bearer: RefundBearer;
  amountPaise: number;
  providerCreditedPaise: number;
  customerPaidPaise: number;
}): number {
  switch (params.bearer) {
    case 'platform':
      return 0;
    case 'provider':
      return params.amountPaise;
    case 'shared':
      if (params.customerPaidPaise <= 0) return 0;
      return Math.round(
        (params.amountPaise * params.providerCreditedPaise) / params.customerPaidPaise,
      );
  }
}

/**
 * Where a refund's money is SENT, from which pools it was spent.
 *
 * `original`: each pool back the way it came. `wallet`: everything to the
 * customer's MiTow wallet and nothing to the gateway, although the pool
 * bookkeeping (`gateway_amount` / `wallet_amount`) is unchanged.
 */
export function deliveredSplit(params: {
  delivery: RefundDelivery;
  gatewayPaise: number;
  walletPaise: number;
}): { toGatewayPaise: number; toWalletPaise: number } {
  if (params.delivery === 'wallet') {
    return { toGatewayPaise: 0, toWalletPaise: params.gatewayPaise + params.walletPaise };
  }
  return { toGatewayPaise: params.gatewayPaise, toWalletPaise: params.walletPaise };
}

/**
 * The line a driver reads on their earnings statement for a clawback.
 *
 * Uber's "fare adjustment" is the model: the driver sees that their earning
 * changed and why, in words, rather than an unexplained reversal. Kept short
 * because it renders on one line in the driver app's earnings list.
 */
export function adjustmentLabel(cause: RefundCause | null): string {
  switch (cause) {
    case 'fare_error':
      return 'Fare adjusted: customer refund for a fare or route issue';
    case 'driver_misconduct':
      return 'Deducted: customer refund after a service complaint';
    case 'platform_error':
    case 'goodwill':
      // Never clawed back by default; reachable only through an override,
      // which carries its own written reason in the audit trail.
      return 'Fare adjusted: customer refund';
    case null:
      return 'Fare adjusted: customer refund';
  }
}
