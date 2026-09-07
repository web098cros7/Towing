import { createHmac, timingSafeEqual } from 'node:crypto';
import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { ExternalCallPolicy } from '../../common/http/external-call.policy';
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
 * Razorpay's payment gateway (Standard Checkout).
 *
 * ⚠ THIS ADAPTER HAS NEVER RUN. No merchant account exists (SETUP-CHECKLIST
 * item 12), so order creation, the checkout-signature format, the webhook
 * envelope and the refund call are all written from Razorpay's documentation
 * and have never touched the live API. `RazorpayRouteAdapter` has been in
 * exactly this state since Track A Phase 7, and this file follows its shape
 * deliberately: everything that CAN be exercised without credentials — the
 * signature verification, the webhook parsing, the payload shapes — is shared
 * with `DevPaymentAdapter` rather than written twice, so the half that can be
 * tested locally is tested locally.
 *
 * THE BREAKER VENDOR IS `razorpay_pg`, NOT `razorpay_route`. RazorpayX (payouts)
 * and the payment gateway are separate products with independent availability;
 * one breaker for both would mean a payout backlog stops customers paying.
 */
@Injectable()
export class RazorpayPaymentsAdapter implements PaymentGatewayPort, OnModuleInit {
  readonly name = 'razorpay';

  /** The circuit-breaker key. Deliberately distinct from `razorpay_route`. */
  private readonly vendor = 'razorpay_pg';

  private readonly logger = new Logger(RazorpayPaymentsAdapter.name);

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly policy: ExternalCallPolicy,
  ) {}

  /**
   * ⚠ Credentials are validated HERE, not in the constructor — Nest
   * instantiates every provider in the module regardless of which one the
   * factory selects, so a constructor that threw on missing keys would break
   * the dev path for everyone who has never heard of Razorpay.
   */
  onModuleInit(): void {
    if (this.env.PAYMENT_GATEWAY !== 'razorpay') return;

    if (!this.env.RAZORPAY_KEY_ID || !this.env.RAZORPAY_KEY_SECRET) {
      throw new Error(
        'PAYMENT_GATEWAY=razorpay requires RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET',
      );
    }

    this.logger.log(`Razorpay payments adapter active against ${this.env.RAZORPAY_BASE_URL}`);
  }

  /**
   * `RAZORPAY_KEY_ID`/`_SECRET` are optional in the schema because the dev
   * gateway needs neither, so the type is `string | undefined` even though
   * `onModuleInit` has already refused to boot without them when this adapter
   * is the one bound. These narrow it at the point of use, and throw rather
   * than fall back to `''` — an empty secret would produce a wrong HMAC that
   * fails closed, which is safe but would surface as "every payment signature
   * is invalid" instead of "the key is missing".
   */
  private get keyId(): string {
    const value = this.env.RAZORPAY_KEY_ID;
    if (!value) throw new Error('RAZORPAY_KEY_ID is not configured');
    return value;
  }

  private get keySecret(): string {
    const value = this.env.RAZORPAY_KEY_SECRET;
    if (!value) throw new Error('RAZORPAY_KEY_SECRET is not configured');
    return value;
  }

  async createIntent(params: CreateIntentParams): Promise<PaymentIntentHandle> {
    const order = await this.call<{ id: string; amount: number }>(
      'POST',
      '/v1/orders',
      {
        amount: params.amountPaise,
        currency: 'INR',
        receipt: params.paymentId,
        // `1` is auto-capture. Manual capture would mean a second vendor call
        // on the hot path and an authorized-but-never-captured state to
        // reconcile, for no gain — see the port's header.
        payment_capture: 1,
        notes: {
          paymentId: params.paymentId,
          bookingId: params.bookingId,
          purpose: params.purpose,
        },
      },
      params.idempotencyKey,
    );

    return {
      orderRef: order.id,
      // The PUBLISHABLE key id. Sent per-request rather than baked into the
      // mobile binary so rotating it needs no store release.
      publicKey: this.keyId,
      amountPaise: params.amountPaise,
      currency: 'INR',
      autoSettles: false,
      // Only Razorpay's own sheet can produce a valid checkout signature.
      devCheckout: null,
    };
  }

  /**
   * `HMAC-SHA256(order_id|payment_id, KEY_SECRET)`.
   *
   * NOTE THE SECRET — the API key secret, not `PAYMENT_WEBHOOK_SECRET`. Two
   * different keys for two different handshakes, and swapping them is the
   * classic failure in this integration: everything verifies in a sandbox
   * where both happen to be set to the same value, then nothing verifies in
   * production.
   */
  verifyCheckout(params: { orderRef: string; gatewayRef: string; signature: string }): boolean {
    const expected = Buffer.from(
      createHmac('sha256', this.keySecret)
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

  async fetchPayment(ref: {
    gatewayRef: string | null;
    orderRef: string | null;
  }): Promise<PaymentHandle> {
    // A safe GET, so it may retry — unlike `createIntent` and `refund`, which
    // move money and are `attempts: 1`.
    if (ref.gatewayRef) {
      const payment = await this.call<RazorpayPayment>(
        'GET',
        `/v1/payments/${ref.gatewayRef}`,
        undefined,
        undefined,
        2,
      );
      return toHandle(payment);
    }

    if (!ref.orderRef) {
      return { gatewayRef: null, orderRef: null, status: 'pending', method: null, amountPaise: null };
    }

    // The webhook-first race: an order exists but we have never seen a payment
    // id for it. Razorpay can list the attempts against the order.
    const listed = await this.call<{ items?: RazorpayPayment[] }>(
      'GET',
      `/v1/orders/${ref.orderRef}/payments`,
      undefined,
      undefined,
      2,
    );

    const captured = (listed.items ?? []).find((item) => item.status === 'captured');
    const latest = captured ?? (listed.items ?? [])[0];

    if (!latest) {
      return {
        gatewayRef: null,
        orderRef: ref.orderRef,
        status: 'pending',
        method: null,
        amountPaise: null,
      };
    }

    return toHandle(latest);
  }

  async refund(params: {
    gatewayRef: string;
    amountPaise: number;
    idempotencyKey: string;
    reason: string;
  }): Promise<RefundHandle> {
    const refund = await this.call<{ id: string; status?: string }>(
      'POST',
      `/v1/payments/${params.gatewayRef}/refund`,
      { amount: params.amountPaise, notes: { reason: params.reason } },
      params.idempotencyKey,
    );

    return {
      refundRef: refund.id,
      status: mapRefundStatus(refund.status ?? ''),
    };
  }

  verifyWebhook(rawBody: Buffer, signature: string): boolean {
    return verifyWebhookSignature(rawBody, signature, this.env.PAYMENT_WEBHOOK_SECRET);
  }

  parseWebhook(payload: unknown): PaymentWebhookEvent | null {
    return parseRazorpayPaymentWebhook(payload);
  }

  /**
   * Through `ExternalCallPolicy` for the breaker and the per-vendor metrics.
   *
   * `attempts` DEFAULTS TO 1 and callers that move money leave it there: a
   * blind retry inside the adapter would create a second order or issue a
   * second refund. Only the read path raises it.
   */
  private async call<T>(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
    idempotencyKey?: string,
    attempts = 1,
  ): Promise<T> {
    const auth = Buffer.from(`${this.keyId}:${this.keySecret}`).toString('base64');

    return this.policy.run<T>(
      { vendor: this.vendor, attempts, timeoutMs: this.env.RAZORPAY_TIMEOUT_MS },
      async (signal) => {
        const response = await fetch(`${this.env.RAZORPAY_BASE_URL}${path}`, {
          method,
          headers: {
            Authorization: `Basic ${auth}`,
            'Content-Type': 'application/json',
            ...(idempotencyKey ? { 'X-Razorpay-Idempotency': idempotencyKey } : {}),
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          signal,
        });

        const text = await response.text();

        if (!response.ok) {
          // Logged and stored on `payments.failure_reason`, so it must never
          // carry the request body — that would put a customer's contact
          // details in a log line.
          throw new Error(
            `Razorpay ${method} ${path} failed (${response.status}): ${text.slice(0, 300)}`,
          );
        }

        return JSON.parse(text) as T;
      },
    );
  }
}

interface RazorpayPayment {
  id: string;
  order_id?: string;
  status?: string;
  method?: string;
  amount?: number;
  error_description?: string;
}

function toHandle(payment: RazorpayPayment): PaymentHandle {
  return {
    gatewayRef: payment.id,
    orderRef: payment.order_id ?? null,
    status: mapPaymentStatus(payment.status ?? ''),
    method: mapMethod(payment.method ?? ''),
    amountPaise: typeof payment.amount === 'number' ? payment.amount : null,
    failureReason: payment.error_description ?? null,
  };
}

function mapPaymentStatus(raw: string): PaymentHandle['status'] {
  switch (raw) {
    case 'captured':
      return 'captured';
    case 'authorized':
      return 'authorized';
    case 'failed':
      return 'failed';
    default:
      // `created`, and anything Razorpay adds later. Mapping the unknown to
      // `pending` rather than `failed` is the safe direction: the sweep asks
      // again in five minutes, whereas a wrong `failed` tells a customer their
      // money did not arrive when it may well have.
      return 'pending';
  }
}

function mapMethod(raw: string): PaymentHandle['method'] {
  switch (raw) {
    case 'upi':
      return 'upi';
    case 'card':
      return 'card';
    case 'wallet':
      return 'wallet';
    default:
      // netbanking, emi, paylater, … `payment_method` has four values and
      // §29.4 owns widening it; until then an unmapped method is recorded as
      // null rather than mislabelled as a card.
      return null;
  }
}

function mapRefundStatus(raw: string): RefundHandle['status'] {
  switch (raw) {
    case 'processed':
      return 'processed';
    case 'failed':
      return 'failed';
    default:
      return 'pending';
  }
}
