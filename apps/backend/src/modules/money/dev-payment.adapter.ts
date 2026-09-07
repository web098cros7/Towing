import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { QUEUE, type QueuePort } from '../../common/queue/queue.port';
import { ENV, type Env } from '../../config/env';
import { verifyWebhookSignature } from './webhook-signature';
import {
  checkoutSignaturePayload,
  parseRazorpayPaymentWebhook,
  type CreateIntentParams,
  type PaymentGatewayPort,
  type PaymentHandle,
  type PaymentIntentHandle,
  type PaymentWebhookEvent,
  type RefundHandle,
} from './payment-gateway.port';

/**
 * The PERMANENT local-development payment gateway — the same standing as
 * `DevPayoutAdapter`, `DevOtpAdapter`, `LogNotificationAdapter` and
 * `DiskStorageAdapter`. `pnpm backend` + `pnpm db:seed` must demonstrate the
 * whole §14.2 chain — order → capture → ledger credit → `paid` → invoice —
 * with zero Razorpay credentials, forever.
 *
 * It is not a stub. It verifies webhook signatures with the real HMAC, parses
 * the real Razorpay envelope, and drives the real `settleCapturedPayment`
 * path; only the vendor round trip is simulated.
 *
 * `PAYMENT_DEV_SETTLE_MS` DEFAULTS TO 0, unlike `PAYOUT_DEV_SETTLE_MS`'s 5000,
 * and the difference is honest rather than convenient. A bank transfer is
 * asynchronous by nature, so a payout that settles instantly would be a lie
 * about the shape of the thing. A UPI or card capture is synchronous from the
 * app's point of view — the sheet returns success — so zero is the truthful
 * default. It also means the entire chain runs in one round trip with NO QUEUE
 * AT ALL, which is exactly what the test suite needs: it runs with
 * `QUEUE_ENABLED=false`, where a delayed job would never fire.
 *
 * `assertProductionSafety` refuses to boot production with this bound: a
 * gateway that reports every payment captured with no bank involved is a
 * ledger full of money nobody sent.
 */
@Injectable()
export class DevPaymentAdapter implements PaymentGatewayPort {
  readonly name = 'dev';

  private readonly logger = new Logger(DevPaymentAdapter.name);

  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(QUEUE) private readonly queue: QueuePort,
  ) {}

  async createIntent(params: CreateIntentParams): Promise<PaymentIntentHandle> {
    // The acceptance time is encoded IN the reference, the `DevPayoutAdapter`
    // trick and for the same reasons: an in-memory Map is lost on restart (so
    // every in-flight payment would look brand new forever) and is not shared
    // between tasks, so whichever one happened to poll would give a different
    // answer. A self-describing ref has neither problem.
    const orderRef = `order_dev_${Date.now().toString(36)}_${randomUUID().slice(0, 8)}`;

    if (this.env.PAYMENT_DEV_SETTLE_MS > 0) {
      // Only when somebody has deliberately asked for a delay, so they can see
      // the COMPLETED (unpaid) state §19.2 describes. A durable delayed job,
      // never a setTimeout — a timer dies with the process and takes the
      // payment's only path to `captured` with it.
      await this.queue.enqueue(
        'payments.dev-settle',
        { paymentId: params.paymentId, gatewayRef: devPaymentRef(orderRef) },
        { jobId: `dev-settle-pay:${params.paymentId}`, delayMs: this.env.PAYMENT_DEV_SETTLE_MS },
      );
    }

    this.logger.log(
      `[dev] order ${orderRef} for booking ${params.bookingId} ` +
        `(₹${(params.amountPaise / 100).toFixed(2)}, ${params.purpose})`,
    );

    const gatewayRef = devPaymentRef(orderRef);

    return {
      orderRef,
      publicKey: 'rzp_test_dev',
      amountPaise: params.amountPaise,
      currency: 'INR',
      autoSettles: true,
      // Computed HERE because only this side knows the secret. The app cannot
      // produce a valid HMAC and must not be given the means to.
      devCheckout: {
        gatewayRef,
        signature: devCheckoutSignature(orderRef, gatewayRef, this.env.PAYMENT_WEBHOOK_SECRET),
      },
    };
  }

  /**
   * Accepts only refs this adapter could have produced, and it matters that
   * the negative branch is reachable: a dev gateway that verified everything
   * would leave `INVALID_PAYMENT_SIGNATURE` untested until the day a real
   * merchant account existed, which is the day you least want to discover it.
   *
   * A real HMAC over `orderRef|gatewayRef` on top, keyed on the webhook secret
   * — so the app has something concrete to compute and the shape of the
   * handshake is exercised, not merely asserted.
   */
  verifyCheckout(params: { orderRef: string; gatewayRef: string; signature: string }): boolean {
    if (!params.orderRef.startsWith('order_dev_')) return false;
    if (!params.gatewayRef.startsWith('pay_dev_')) return false;

    const expected = Buffer.from(
      createHmac('sha256', this.env.PAYMENT_WEBHOOK_SECRET)
        .update(checkoutSignaturePayload(params.orderRef, params.gatewayRef))
        .digest('hex'),
      'hex',
    );

    try {
      const received = Buffer.from(params.signature.trim(), 'hex');
      if (expected.length !== received.length || received.length === 0) return false;
      return timingSafeEqual(expected, received);
    } catch {
      return false;
    }
  }

  /**
   * Ages into `captured` off the timestamp in the order reference, so the §19.3
   * sweep can settle a payment even with `QUEUE_ENABLED=false` and no delayed
   * job to run — the degraded configuration the whole test suite uses.
   *
   * With the default `PAYMENT_DEV_SETTLE_MS = 0` this is captured immediately,
   * so `POST /capture` succeeds in a single round trip.
   */
  fetchPayment(ref: {
    gatewayRef: string | null;
    orderRef: string | null;
  }): Promise<PaymentHandle> {
    const orderRef = ref.orderRef ?? null;
    const createdAt = createdAtFrom(orderRef ?? ref.gatewayRef ?? '');
    // An unparseable ref is treated as settled, for the same reason
    // `DevPayoutAdapter` does: it can only come from an older format or a
    // hand-written row, and leaving those in flight forever is the worse
    // failure.
    const settled =
      createdAt === null || Date.now() - createdAt >= this.env.PAYMENT_DEV_SETTLE_MS;

    return Promise.resolve({
      gatewayRef: ref.gatewayRef ?? (orderRef ? devPaymentRef(orderRef) : null),
      orderRef,
      status: settled ? 'captured' : 'pending',
      method: 'upi',
      // Null rather than a made-up figure: the amount check in
      // `PaymentsService` treats null as "the gateway did not say", and a dev
      // adapter inventing an amount that always matches would disable the one
      // check that stops a ₹1 order paying for a ₹2,000 tow.
      amountPaise: null,
      failureReason: null,
    });
  }

  refund(params: {
    gatewayRef: string;
    amountPaise: number;
    idempotencyKey: string;
    reason: string;
  }): Promise<RefundHandle> {
    this.logger.log(
      `[dev] refunded ₹${(params.amountPaise / 100).toFixed(2)} on ${params.gatewayRef} (${params.reason})`,
    );
    return Promise.resolve({
      refundRef: `rfnd_dev_${randomUUID().slice(0, 12)}`,
      status: 'processed',
    });
  }

  /** The same HMAC the real gateway uses — see `webhook-signature.ts`. */
  verifyWebhook(rawBody: Buffer, signature: string): boolean {
    return verifyWebhookSignature(rawBody, signature, this.env.PAYMENT_WEBHOOK_SECRET);
  }

  parseWebhook(payload: unknown): PaymentWebhookEvent | null {
    return parseRazorpayPaymentWebhook(payload);
  }
}

/** `order_dev_<base36 millis>_<rand>` → the matching `pay_dev_…`. */
export function devPaymentRef(orderRef: string): string {
  return `pay_dev_${orderRef.slice('order_dev_'.length)}`;
}

/** `…_<base36 millis>_<rand>` → millis, or null if it is not one of ours. */
function createdAtFrom(ref: string): number | null {
  const millis = Number.parseInt(ref.split('_')[2] ?? '', 36);
  return Number.isFinite(millis) && millis > 0 ? millis : null;
}

/**
 * The signature a dev client must send to `POST /capture`, exported so the
 * mock data sources and the e2e specs compute it the same way the adapter
 * verifies it rather than each hard-coding a string.
 */
export function devCheckoutSignature(
  orderRef: string,
  gatewayRef: string,
  secret: string,
): string {
  return createHmac('sha256', secret)
    .update(checkoutSignaturePayload(orderRef, gatewayRef))
    .digest('hex');
}
