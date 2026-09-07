import { createHash } from 'node:crypto';
import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import {
  ErrorCodes,
  paiseToRupeeString,
  rupeeStringToPaise,
  type PaymentCaptureRequest,
  type PaymentIntentDto,
  type PaymentPurpose,
  type PaymentResultDto,
} from '@towing/api-contracts';
import { RedisLock } from '../../common/cache/redis-lock';
import { ApiException } from '../../common/errors/api-exception';
import { isUniqueViolation } from '../../common/errors/pg-errors';
import { NotificationService } from '../../common/notifications/notification.service';
import { QUEUE, type QueuePort } from '../../common/queue/queue.port';
import { ENV, type Env } from '../../config/env';
import { DB, type Database } from '../../db/db.module';
import { paymentRowKey } from '../../db/ledger/idempotency-keys';
import { LedgerService } from '../../db/ledger/ledger.service';
import { paymentCaptureLockKey } from '../../redis/redis.constants';
import { BookingStateMachineService } from '../bookings/booking-state-machine.service';
import { CustomerGateway } from '../bookings/customer.gateway';
import { PAYMENT_GATEWAY, type PaymentGatewayPort, type PaymentHandle } from './payment-gateway.port';
import { PaymentsRepo, type PaymentRow, type SettlementInputsRow } from './payments.repo';
import { computeSettlement } from './settlement';
import { devCheckoutSignature, devPaymentRef } from './dev-payment.adapter';
import { cancellationPolicy } from '../bookings/cancellation-policy';
import { PricingConfigRepo } from '../pricing/pricing-config.repo';

/**
 * §14.2's capture, and the one place a booking ever becomes `paid`.
 *
 * THREE CALLERS, ONE SETTLEMENT FUNCTION. The capture route, the Razorpay
 * webhook and the five-minute sweep all end at `settleCapturedPayment` and
 * nowhere else, because three code paths that each credit a ledger is three
 * chances for them to disagree about what "credited" means.
 *
 * THE CLIENT IS NEVER THE AUTHORITY. `capture` verifies the checkout signature
 * and then asks the gateway itself what happened. A caller that says "captured"
 * may be replaying, confused, or lying, and only the vendor knows which.
 */
@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  /** Long enough for a vendor fetch plus two transactions; short enough that a
   *  crashed worker frees it fast. THE TTL IS THE SAFETY PROPERTY. */
  private static readonly LOCK_TTL_MS = 15_000;

  constructor(
    private readonly repo: PaymentsRepo,
    private readonly ledger: LedgerService,
    private readonly machine: BookingStateMachineService,
    private readonly lock: RedisLock,
    private readonly customers: CustomerGateway,
    private readonly rateCards: PricingConfigRepo,
    private readonly notifications: NotificationService,
    @Inject(DB) private readonly db: Database,
    @Inject(QUEUE) private readonly queue: QueuePort,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGatewayPort,
    @Inject(ENV) private readonly env: Env,
  ) {}

  // ───────────────────────────────────────────────────────────── intent ────

  /**
   * Opens (or re-serves) the gateway order the app's sheet runs against.
   *
   * Four layers of "do not create a second order", in order of how likely each
   * is to be the one that saves you: the Redis idempotency interceptor; the
   * open-intent reuse below; `payments.idempotency_key`'s unique index; and
   * `uq_payments_one_captured_per_booking`, which is the only one that is a
   * database fact rather than a convention.
   */
  async createIntent(
    bookingId: string,
    userId: string,
    purpose: PaymentPurpose,
    clientKey: string,
  ): Promise<PaymentIntentDto> {
    const booking = await this.loadPayableBooking(bookingId, userId, purpose);

    // §3.5's fee is COMPUTED, not read back off the booking. `cancellation_fee`
    // is written by the cancel route, which cannot run until this fee has been
    // paid — so reading the column here would always find zero and 422 the
    // intent. Running the same `cancellationPolicy` the quote runs is also what
    // guarantees the customer is charged what they were shown.
    const amountPaise =
      purpose === 'booking'
        ? rupeeStringToPaise(booking.total)
        : (await this.cancellationFeePaise(booking)).feePaise;

    if (amountPaise <= 0) {
      throw new ApiException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        ErrorCodes.VALIDATION_FAILED,
        'There is nothing to pay for this booking',
      );
    }

    // ANY open intent for this booking and purpose is reused, whatever key
    // created it. A customer who backgrounds the app and returns has a new
    // client key for what is still one intent to pay — and two live orders for
    // one booking is how you end up with two captures.
    const open = await this.repo.openIntent(bookingId, purpose);
    if (open?.gatewayOrderRef) {
      return this.intentDto(open, booking, amountPaise);
    }

    // Namespaced by booking AND purpose: `uq_payments_idempotency_key` is
    // GLOBAL, so two customers both sending `Idempotency-Key: 1` would
    // otherwise collide and the second would silently receive the first's
    // payment. Exactly the trap `PayoutsService` already guards.
    const storedKey = paymentRowKey(bookingId, purpose, sha256(clientKey));

    let row = open;
    if (!row) {
      try {
        row = await this.repo.create({
          bookingId,
          amount: paiseToRupeeString(amountPaise),
          taxAmount: purpose === 'booking' ? booking.taxAmount : '0',
          purpose,
          method: 'upi',
          idempotencyKey: storedKey,
          provider: this.gateway.name,
        });
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
        const existing = await this.repo.byIdempotencyKey(storedKey);
        if (!existing) throw error;
        row = existing;
        if (row.gatewayOrderRef) return this.intentDto(row, booking, amountPaise);
      }
    }

    const handle = await this.gateway.createIntent({
      paymentId: row.id,
      bookingId,
      purpose,
      amountPaise,
      customer: {
        userId,
        name: booking.customerName,
        contact: booking.customerMobile,
        email: booking.customerEmail,
      },
      idempotencyKey: row.idempotencyKey,
    });

    await this.repo.setOrderRef(row.id, handle.orderRef);

    return {
      paymentId: row.id,
      orderRef: handle.orderRef,
      publicKey: handle.publicKey,
      amountPaise: handle.amountPaise,
      currency: 'INR',
      autoSettles: handle.autoSettles,
      devCheckout: handle.devCheckout,
      breakdown: booking.breakdown,
    };
  }

  // ──────────────────────────────────────────────────────────── capture ────

  /**
   * Verify, then settle.
   *
   * Named `capture` because that is the route name the plan gave it, but the
   * server never instructs a capture: Standard Checkout captures at the
   * customer's confirm and this learns that it happened.
   */
  async capture(
    bookingId: string,
    userId: string,
    body: PaymentCaptureRequest,
  ): Promise<PaymentResultDto> {
    const booking = await this.loadPayableBooking(bookingId, userId, 'booking', {
      allowPaid: true,
    });

    // Already settled: a 200 replay, never a 409. The client legitimately
    // retries — a dropped response, a backgrounded app, a flaky network — and
    // an error there would train it to show a failure for a payment that
    // worked.
    if (booking.status === 'paid') return this.resultFor(bookingId, 'paid');

    // Signature first, and it writes NOTHING. A forged or replayed signature
    // must not leave so much as a row behind to reason about later.
    if (!this.gateway.verifyCheckout(body)) {
      throw new ApiException(
        HttpStatus.UNAUTHORIZED,
        ErrorCodes.INVALID_PAYMENT_SIGNATURE,
        'This payment could not be verified',
      );
    }

    const handle = await this.gateway.fetchPayment({
      gatewayRef: body.gatewayRef,
      orderRef: body.orderRef,
    });

    if (handle.status !== 'captured') {
      // §19.2: the booking STAYS `completed`. This is not the customer's
      // failure and must not be reported as one — the sweep resolves it.
      throw new ApiException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        ErrorCodes.PAYMENT_NOT_CAPTURED,
        'We are still confirming this payment with your bank',
        { gatewayStatus: handle.status },
      );
    }

    await this.assertAmountMatches(handle, rupeeStringToPaise(booking.total));

    await this.settleCapturedPayment(bookingId, handle);

    return this.resultFor(bookingId, 'paid');
  }

  /**
   * THE ONE SETTLEMENT FUNCTION. Route, webhook and sweep all call this.
   *
   * ORDERING: THE LEDGER COMMITS BEFORE THE STATUS TRANSITION, and the reason
   * is worth stating because the instinct is the other way round. Take the
   * other order and a crash between the two leaves a booking at `paid` with
   * `commission_amount`/`driver_payout` written and NO LEGS — `ledgerDrift = 1`,
   * and the nightly `earnings.reconcile` throws at 01:00 IST, dead-lettering
   * itself and firing the queue-depth alarm, for a booking nobody can now fix
   * without a manual ledger write.
   *
   * In this order a crash leaves credits on a booking still `completed`.
   * `ledgerDrift` filters `status = 'paid'`, so it does not fire; the
   * five-minute sweep re-runs this function, where the ledger post is a pure
   * replay on the `bk:v1:*` keys and the transition then succeeds. IT
   * CONVERGES INSTEAD OF ALARMING.
   *
   * The cost is that `LedgerService`'s own post-commit projection enqueue reads
   * the money columns before the transition writes them — hence the explicit
   * re-enqueue at the end.
   */
  async settleCapturedPayment(bookingId: string, handle: PaymentHandle): Promise<void> {
    // `required: false` — Redis being down must never mean payments stop
    // (§19.2 says nothing of the sort). The guarantees that hold without it are
    // database facts: `uq_payments_one_captured_per_booking`, the state
    // machine's FOR UPDATE legality check, and the ledger's own keys.
    await this.lock.withLock(
      paymentCaptureLockKey(bookingId),
      PaymentsService.LOCK_TTL_MS,
      { required: false },
      () => this.settleInner(bookingId, handle),
    );
  }

  private async settleInner(bookingId: string, handle: PaymentHandle): Promise<void> {
    const inputs = await this.db.transaction(async (tx) => {
      const row = await this.repo.settlementInputs(tx, bookingId, 'booking');
      if (!row) throw ApiException.notFound('Booking not found');
      return row;
    });

    if (inputs.status === 'paid') return;

    if (inputs.status !== 'completed') {
      // The webhook-arrives-early case, and a genuinely odd one. Throwing is
      // right: `WebhooksController` records it on `webhook_events.error` and
      // still 200s, and the sweep re-derives the truth within five minutes.
      throw new ApiException(
        HttpStatus.CONFLICT,
        ErrorCodes.INVALID_BOOKING_STATE,
        `A booking cannot be settled from ${inputs.status}`,
        { from: inputs.status },
      );
    }

    // Ensure a captured `payments` row exists. The webhook can legitimately
    // arrive before the app's own capture call, in which case there may be an
    // intent row to update or none at all.
    const paymentId = await this.ensureCapturedRow(bookingId, handle);

    if (!inputs.driverId || !inputs.band) {
      throw new ApiException(
        HttpStatus.CONFLICT,
        ErrorCodes.INVALID_BOOKING_STATE,
        'This booking has no driver or no locked commission band to settle against',
      );
    }

    // ⚠ THE SINGLE MOST DANGEROUS LINE IN THE PHASE.
    //
    // `taxable`, never `booking.total`. §14.3's split applies to what the
    // platform and the driver share, and GST is neither party's money — it is
    // collected on behalf of a government that has no wallet. Passing `total`
    // here credits the driver a share of the tax, and then
    // `ck_bookings_payout_within_total` rejects the UPDATE below outright
    // while `bookingDrift` would have caught it in the nightly job.
    //
    // With `tax_pct` at its default of 0 this is arithmetically identical to
    // `total`, which is exactly why it needs saying: the mistake is invisible
    // until the day somebody sets a rate.
    const totalPaise = rupeeStringToPaise(inputs.totalRupees);
    const taxPaise = rupeeStringToPaise(inputs.taxRupees);
    const taxablePaise = totalPaise - taxPaise;

    const settlement = computeSettlement({
      totalPaise: taxablePaise,
      band: inputs.band,
      driverSharePct: inputs.fleetId ? (inputs.driverSharePct ?? 0) : null,
    });

    // (a) LEDGER FIRST — see the header.
    await this.ledger.creditBookingSettlement({
      bookingId,
      totalPaise: taxablePaise,
      band: inputs.band,
      driverId: inputs.driverId,
      fleet: inputs.fleetId
        ? { fleetId: inputs.fleetId, driverSharePct: inputs.driverSharePct ?? 0 }
        : null,
    });

    // (b) THEN the status, in its own transaction. A second `completed → paid`
    // is a 409 from the legality guard under FOR UPDATE, which the caller
    // above treats as a replay.
    const result = await this.db.transaction((tx) =>
      this.machine.transition(tx, {
        bookingId,
        to: 'paid',
        actor: 'system',
        note: `Captured via ${this.gateway.name}`,
        patch: {
          commissionAmount: paiseToRupeeString(settlement.commissionPaise),
          driverPayout: paiseToRupeeString(settlement.poolPaise),
          paidAt: new Date(),
          ...(handle.method ? { paymentMethod: handle.method } : {}),
        },
      }),
    );

    // (c) After commit, all best-effort. None of it may fail a settlement that
    // has already happened.
    await this.afterSettlement(bookingId, paymentId, inputs, totalPaise, settlement.driverSharePaise);

    await this.machine.announce(result);
  }

  /** Everything that hangs off a settled payment, none of it load-bearing. */
  private async afterSettlement(
    bookingId: string,
    paymentId: string | null,
    inputs: SettlementInputsRow,
    totalPaise: number,
    driverNetPaise: number,
  ): Promise<void> {
    // §22.1, server-emitted at the LEDGER TRUTH POINT rather than from the
    // app. A client-emitted `payment_success` counts sheets that returned
    // success, which is not the same fact as money landing — and two numbers
    // for one KPI is what §2.5's dashboards then have to reconcile.
    this.logger.log(
      `event=payment_success booking=${bookingId} amount_paise=${totalPaise} ` +
        `provider=${this.gateway.name}`,
    );
    this.logger.log(`event=booking_completed booking=${bookingId}`);

    try {
      this.customers.emitBookingStatus(bookingId, 'paid');
    } catch (error) {
      this.logger.warn(`payment socket emit failed for ${bookingId}: ${String(error)}`);
    }

    // The projection is re-enqueued explicitly: `LedgerService` already fired
    // one after ITS commit, but that ran before the transition wrote
    // `commission_amount`, so the cell it computed is stale by construction.
    try {
      await this.queue.enqueue('invoice.generate', { bookingId }, { jobId: `invoice:${bookingId}` });
    } catch (error) {
      this.logger.warn(`invoice enqueue failed for ${bookingId}: ${String(error)}`);
    }

    const amountLabel = `₹${(totalPaise / 100).toLocaleString('en-IN', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;

    await this.emit('payment.succeeded', {
      bookingId,
      userId: inputs.userId,
      paymentId: paymentId ?? bookingId,
      amount: amountLabel,
    });

    await this.emit('booking.completed_invoice', {
      bookingId,
      userId: inputs.userId,
      amount: amountLabel,
    });

    if (inputs.driverId) {
      await this.emit('earnings.credited', {
        bookingId,
        driverId: inputs.driverId,
        amount: `₹${(driverNetPaise / 100).toLocaleString('en-IN', {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })}`,
      });
    }
  }

  // ─────────────────────────────────────────────────────────── failures ────

  /**
   * A payment the gateway rejected or never confirmed.
   *
   * §19.2: THE BOOKING STAYS `completed`. It sits at COMPLETED (unpaid)
   * indefinitely and that is a legitimate, documented state — not an error, and
   * not something to hide from the customer.
   */
  async markFailed(paymentId: string, reason: string): Promise<void> {
    const row = await this.repo.markFailed(paymentId, reason);
    if (!row) return;

    this.logger.warn(`event=payment_failure payment=${paymentId} reason=${reason}`);

    const [booking] = (await this.db.execute(sql`
      select user_id from bookings where id = ${row.bookingId}::uuid
    `)) as unknown as Array<{ user_id: string } | undefined>;

    if (booking) {
      await this.emit('payment.failed', {
        bookingId: row.bookingId,
        userId: booking.user_id,
        paymentId,
        amount: `₹${(rupeeStringToPaise(row.amount) / 100).toFixed(2)}`,
        reason,
      });
    }
  }

  /** The webhook's lookup, mirroring `PayoutsService.findForWebhook`. */
  async findForWebhook(gatewayRef: string | null, orderRef: string | null) {
    if (gatewayRef) {
      const byRef = await this.repo.byGatewayRef(gatewayRef);
      if (byRef) return byRef;
    }
    return orderRef ? this.repo.byOrderRef(orderRef) : null;
  }

  paymentById(paymentId: string) {
    return this.repo.byId(paymentId);
  }

  // ────────────────────────────────────────────────────────── internals ────

  /**
   * The amount check, and it is a security control rather than a rounding
   * guard.
   *
   * THE ATTACK: create a ₹1 order out of band against the same merchant
   * account and present it here for a ₹2,000 tow. Without this the ledger
   * credits a driver from money that was never collected — and every invariant
   * stays green while it happens, because they all reconcile against what the
   * BOOKING says it charged, not against what the gateway actually took.
   *
   * A null amount means the gateway did not say (the dev adapter deliberately
   * returns null rather than echoing back whatever would match). Skipping the
   * check then is correct: a dev adapter that always agreed would disable the
   * one control that stops this.
   */
  private async assertAmountMatches(handle: PaymentHandle, expectedPaise: number): Promise<void> {
    if (handle.amountPaise === null) return;
    if (handle.amountPaise === expectedPaise) return;

    this.logger.error(
      `payment amount mismatch: gateway says ${handle.amountPaise}, booking says ${expectedPaise} ` +
        `(ref ${handle.gatewayRef ?? 'unknown'})`,
    );

    throw new ApiException(
      HttpStatus.CONFLICT,
      ErrorCodes.PAYMENT_AMOUNT_MISMATCH,
      'The amount paid does not match this booking',
    );
  }

  /**
   * Guarantees a `captured` payments row exists for this booking, whichever
   * order the capture call and the webhook arrived in.
   */
  private async ensureCapturedRow(
    bookingId: string,
    handle: PaymentHandle,
  ): Promise<string | null> {
    const existing =
      (handle.gatewayRef ? await this.repo.byGatewayRef(handle.gatewayRef) : null) ??
      (handle.orderRef ? await this.repo.byOrderRef(handle.orderRef) : null) ??
      (await this.repo.openIntent(bookingId, 'booking')) ??
      (await this.repo.capturedFor(bookingId, 'booking'));

    if (existing) {
      if (existing.status !== 'captured') {
        await this.repo.markCaptured(existing.id, {
          gatewayRef: handle.gatewayRef,
          method: handle.method,
        });
      }
      return existing.id;
    }

    // WEBHOOK-FIRST, WITH NO INTENT ROW AT ALL. Rare but real: the app died
    // between opening the sheet and persisting our own row. The key is derived
    // from the GATEWAY reference rather than a client key, because there is no
    // client here — and it is stable, so a redelivery of the same webhook
    // dedupes on it.
    const [booking] = (await this.db.execute(sql`
      select total, tax_amount from bookings where id = ${bookingId}::uuid
    `)) as unknown as Array<{ total: string; tax_amount: string } | undefined>;
    if (!booking) return null;

    try {
      const created = await this.repo.create({
        bookingId,
        amount: booking.total,
        taxAmount: booking.tax_amount,
        purpose: 'booking',
        method: handle.method ?? 'upi',
        idempotencyKey: paymentRowKey(bookingId, 'booking', sha256(handle.gatewayRef ?? bookingId)),
        provider: this.gateway.name,
      });
      await this.repo.markCaptured(created.id, {
        gatewayRef: handle.gatewayRef,
        method: handle.method,
      });
      return created.id;
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      // Another worker created it in the meantime. Fine — it is captured.
      const raced = handle.gatewayRef ? await this.repo.byGatewayRef(handle.gatewayRef) : null;
      return raced?.id ?? null;
    }
  }

  /** §3.5's fee for this booking right now, from the one policy implementation. */
  private async cancellationFeePaise(booking: PayableBooking): Promise<{ feePaise: number }> {
    const { charges } = await this.rateCards.load();

    const outcome = cancellationPolicy({
      status: booking.status as never,
      confirmedAt: booking.createdAt,
      basePaise: rupeeStringToPaise(booking.baseFare),
      hasDriver: booking.hasDriver,
      config: {
        freeWindowMs: charges.cancelFreeMinutes * 60_000,
        partialWindowMs: charges.cancelPartialMinutes * 60_000,
        partialFeePaise: charges.cancelPartialFeePaise,
        driverCompensationPct: charges.cancelDriverCompPct,
      },
    });

    return { feePaise: outcome.feePaise };
  }

  private async loadPayableBooking(
    bookingId: string,
    userId: string,
    purpose: PaymentPurpose,
    options: { allowPaid?: boolean } = {},
  ): Promise<PayableBooking> {
    const [row] = (await this.db.execute(sql`
      select b.id, b.status, b.user_id, b.total, b.tax_amount, b.cancellation_fee,
             b.created_at, b.driver_id,
             b.base_fare, b.distance_charge, b.night_charge, b.highway_charge,
             b.accident_charge, b.waiting_charge, b.surge_amount, b.discount,
             u.name, u.mobile, u.email
        from bookings b join users u on u.id = b.user_id
       where b.id = ${bookingId}::uuid
    `)) as unknown as Array<Record<string, unknown> | undefined>;

    // 404 rather than 403 for somebody else's booking: confirming that a
    // booking exists to a stranger is itself a disclosure.
    if (!row || row.user_id !== userId) throw ApiException.notFound('Booking not found');

    const status = row.status as string;
    const payable =
      purpose === 'booking'
        ? status === 'completed' || (options.allowPaid === true && status === 'paid')
        : ['assigned', 'en_route', 'arrived', 'in_progress'].includes(status);

    if (!payable) {
      throw new ApiException(
        HttpStatus.CONFLICT,
        ErrorCodes.INVALID_BOOKING_STATE,
        `This booking cannot be paid for while it is ${status}`,
        { status },
      );
    }

    const paise = (value: unknown): number => rupeeStringToPaise((value as string | null) ?? '0');

    return {
      status,
      total: row.total as string,
      taxAmount: (row.tax_amount as string | null) ?? '0',
      cancellationFee: (row.cancellation_fee as string | null) ?? '0',
      baseFare: (row.base_fare as string | null) ?? '0',
      createdAt: new Date(row.created_at as string),
      hasDriver: row.driver_id !== null,
      customerName: (row.name as string | null) ?? null,
      customerMobile: (row.mobile as string | null) ?? null,
      customerEmail: (row.email as string | null) ?? null,
      breakdown: {
        basePaise: paise(row.base_fare) + paise(row.distance_charge),
        nightPaise: paise(row.night_charge),
        highwayPaise: paise(row.highway_charge),
        accidentPaise: paise(row.accident_charge),
        waitingPaise: paise(row.waiting_charge),
        surgePaise: paise(row.surge_amount),
        discountPaise: paise(row.discount),
        taxPaise: paise(row.tax_amount),
        totalPaise: paise(row.total),
      },
    };
  }

  private intentDto(
    row: PaymentRow,
    booking: PayableBooking,
    amountPaise: number,
  ): PaymentIntentDto {
    return {
      paymentId: row.id,
      orderRef: row.gatewayOrderRef!,
      publicKey: this.env.RAZORPAY_KEY_ID ?? 'rzp_test_dev',
      amountPaise,
      currency: 'INR',
      autoSettles: this.gateway.name === 'dev',
      // A REUSED intent recomputes it rather than storing it: the signature is
      // a pure function of the two refs and the secret, so re-deriving is
      // cheaper and safer than persisting a credential-shaped string.
      devCheckout:
        this.gateway.name === 'dev' && row.gatewayOrderRef
          ? {
              gatewayRef: devPaymentRef(row.gatewayOrderRef),
              signature: devCheckoutSignature(
                row.gatewayOrderRef,
                devPaymentRef(row.gatewayOrderRef),
                this.env.PAYMENT_WEBHOOK_SECRET,
              ),
            }
          : null,
      breakdown: booking.breakdown,
    };
  }

  private async resultFor(
    bookingId: string,
    expected: 'paid' | 'completed',
  ): Promise<PaymentResultDto> {
    const [row] = (await this.db.execute(sql`
      select b.status, b.total, b.invoice_key,
             p.id as payment_id, p.status as payment_status, p.failure_reason
        from bookings b
        left join payments p on p.booking_id = b.id and p.purpose = 'booking'
                            and p.status = 'captured'
       where b.id = ${bookingId}::uuid
    `)) as unknown as Array<Record<string, unknown> | undefined>;

    if (!row) throw ApiException.notFound('Booking not found');

    return {
      paymentId: (row.payment_id as string | null) ?? bookingId,
      bookingId,
      status: ((row.payment_status as string | null) ?? 'pending') as PaymentResultDto['status'],
      bookingStatus: (row.status as string) ?? expected,
      amountPaise: rupeeStringToPaise(row.total as string),
      invoiceAvailable: Boolean(row.invoice_key),
      failureReason: (row.failure_reason as string | null) ?? null,
    };
  }

  /** Notifications are best-effort; a failed send must not unsettle a payment. */
  private async emit(event: string, payload: Record<string, unknown>): Promise<void> {
    try {
      await this.notifications.emit(event as never, payload as never);
    } catch (error) {
      this.logger.warn(`notification ${event} failed: ${String(error)}`);
    }
  }
}

interface PayableBooking {
  status: string;
  total: string;
  taxAmount: string;
  cancellationFee: string;
  baseFare: string;
  createdAt: Date;
  hasDriver: boolean;
  customerName: string | null;
  customerMobile: string | null;
  customerEmail: string | null;
  breakdown: {
    basePaise: number;
    nightPaise: number;
    highwayPaise: number;
    accidentPaise: number;
    waitingPaise: number;
    surgePaise: number;
    discountPaise: number;
    taxPaise: number;
    totalPaise: number;
  };
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
