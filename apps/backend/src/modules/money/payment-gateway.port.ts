/**
 * §14.2's payment gateway, behind a port — the sibling of
 * `PayoutProviderPort` and deliberately shaped like it.
 *
 * MONEY IN AND MONEY OUT ARE DIFFERENT VENDORS. Razorpay's payment gateway and
 * RazorpayX Route are separate products with separate dashboards, separate
 * webhook secrets and independent availability. Folding them into one port
 * would give them one circuit breaker, and a payout backlog would then stop
 * customers paying — precisely the coupling §19.2's ladder distinguishes when
 * it says "Razorpay down → bookings complete as COMPLETED (unpaid)", which is
 * a statement about the gateway and not about payouts.
 *
 * THERE IS DELIBERATELY NO `capture()`. Razorpay Standard Checkout with
 * `payment_capture: 1` captures at the customer's confirm; the server never
 * instructs a capture, it *learns* that one happened — from the client's
 * callback and, authoritatively, from the webhook and `fetchPayment`. Manual
 * capture would add a vendor call to the hot path and a whole extra failure
 * mode (authorized but never captured) for nothing. `POST /payments/:id/capture`
 * keeps the route name the plan gave it, but its real job is verify-and-settle.
 */

export const PAYMENT_GATEWAY = Symbol('PAYMENT_GATEWAY');

export type PaymentPurposeValue = 'booking' | 'cancellation_fee';

export interface CreateIntentParams {
  /** Our `payments.id`, echoed into the vendor's notes so a webhook finds us. */
  paymentId: string;
  bookingId: string;
  purpose: PaymentPurposeValue;
  amountPaise: number;
  customer: {
    userId: string;
    name: string | null;
    contact: string | null;
    email: string | null;
  };
  /** Sent as the vendor's idempotency header AND stored on the row. */
  idempotencyKey: string;
}

export interface PaymentIntentHandle {
  /** Razorpay `order_…`. The client SDK opens its sheet against this. */
  orderRef: string;
  /** The PUBLISHABLE key id the app needs. NEVER the secret. */
  publicKey: string;
  amountPaise: number;
  currency: 'INR';
  /**
   * True for the dev gateway. The app skips the native sheet entirely and
   * calls `capture` directly, which is what makes the whole chain demoable in
   * Expo Go with no Razorpay account and no native module loaded.
   */
  autoSettles: boolean;
  /**
   * Dev gateway only: a checkout result it will accept. Null for Razorpay,
   * where only its own sheet can produce one. See the contract's note.
   */
  devCheckout: { gatewayRef: string; signature: string } | null;
}

export interface PaymentHandle {
  /** `pay_…`, once a payment object exists at all. */
  gatewayRef: string | null;
  orderRef: string | null;
  status: 'pending' | 'authorized' | 'captured' | 'failed';
  method: 'upi' | 'card' | 'wallet' | null;
  amountPaise: number | null;
  failureReason?: string | null;
}

export interface PaymentWebhookEvent {
  eventId: string;
  eventType: string;
  gatewayRef: string | null;
  orderRef: string | null;
  /** Ours, read back out of the vendor's notes. */
  paymentId: string | null;
  /** Ours, the fallback when notes are missing. */
  bookingId: string | null;
  status: 'authorized' | 'captured' | 'failed' | 'refunded' | 'unknown';
  amountPaise: number | null;
  method: string | null;
  failureReason?: string | null;
}

export interface RefundHandle {
  refundRef: string;
  status: 'pending' | 'processed' | 'failed';
  failureReason?: string | null;
}

export interface PaymentGatewayPort {
  /** `'dev' | 'razorpay'` — recorded on `payments.provider`. */
  readonly name: string;

  createIntent(params: CreateIntentParams): Promise<PaymentIntentHandle>;

  /**
   * Razorpay's checkout handshake: `HMAC-SHA256(orderRef|gatewayRef,
   * key_secret)`. Pure, no I/O, constant-time — the same contract
   * `verifyWebhook` has.
   *
   * NOTE THE SECRET: this uses the API key secret, NOT the webhook secret.
   * They are different keys for different handshakes and swapping them is the
   * classic bug in this integration.
   */
  verifyCheckout(params: { orderRef: string; gatewayRef: string; signature: string }): boolean;

  /**
   * The AUTHORITATIVE status. Never trust the client's word about money: a
   * caller that says "captured" may be replaying, confused, or lying, and only
   * the gateway knows which.
   */
  fetchPayment(ref: { gatewayRef: string | null; orderRef: string | null }): Promise<PaymentHandle>;

  refund(params: {
    gatewayRef: string;
    amountPaise: number;
    idempotencyKey: string;
    reason: string;
  }): Promise<RefundHandle>;

  verifyWebhook(rawBody: Buffer, signature: string): boolean;

  /** `null` means "not one of ours" — the controller 200s and moves on. */
  parseWebhook(payload: unknown): PaymentWebhookEvent | null;
}

/**
 * Razorpay's payment/refund webhook envelope, parsed by BOTH adapters so a
 * captured production payload replays verbatim against a dev environment.
 *
 * Shape: `{ id, event, payload: { payment: { entity: {…} } } }`, and for
 * refunds `{ payload: { refund: { entity: {…} }, payment: { entity: {…} } } }`.
 *
 * Returns null for anything not prefixed `payment.` or `refund.` — including
 * every `payout.*` event, which belongs to `PayoutProviderPort`. The webhook
 * controller tries both parsers precisely because this one is allowed to be
 * uninterested.
 */
export function parseRazorpayPaymentWebhook(payload: unknown): PaymentWebhookEvent | null {
  if (!payload || typeof payload !== 'object') return null;
  const body = payload as Record<string, unknown>;

  const event = typeof body.event === 'string' ? body.event : null;
  if (!event || !(event.startsWith('payment.') || event.startsWith('refund.'))) return null;

  const container = body.payload as Record<string, unknown> | undefined;
  const entity = (container?.payment as Record<string, unknown> | undefined)?.entity as
    | Record<string, unknown>
    | undefined;

  if (!entity) return null;

  const notes = (entity.notes ?? {}) as Record<string, unknown>;
  const gatewayRef = typeof entity.id === 'string' ? entity.id : null;

  return {
    eventId:
      typeof body.id === 'string' && body.id ? body.id : `${event}:${gatewayRef ?? 'unknown'}`,
    eventType: event,
    gatewayRef,
    orderRef: typeof entity.order_id === 'string' ? entity.order_id : null,
    paymentId: typeof notes.paymentId === 'string' ? notes.paymentId : null,
    bookingId: typeof notes.bookingId === 'string' ? notes.bookingId : null,
    status: mapPaymentEventStatus(event, typeof entity.status === 'string' ? entity.status : ''),
    amountPaise: typeof entity.amount === 'number' ? entity.amount : null,
    method: typeof entity.method === 'string' ? entity.method : null,
    failureReason:
      typeof entity.error_description === 'string' ? entity.error_description : null,
  };
}

function mapPaymentEventStatus(event: string, raw: string): PaymentWebhookEvent['status'] {
  // A `refund.*` event is about the refund, whatever the payment entity says.
  if (event.startsWith('refund.')) return 'refunded';

  switch (raw) {
    case 'captured':
      return 'captured';
    case 'authorized':
      return 'authorized';
    case 'failed':
      return 'failed';
    case 'refunded':
      return 'refunded';
    default:
      // `created` and anything Razorpay adds later. Not an error — the sweep
      // asks the gateway directly within five minutes.
      return 'unknown';
  }
}

/**
 * `HMAC-SHA256(order_id|payment_id, key_secret)` — Razorpay's documented
 * checkout-response verification, shared by both adapters for the same reason
 * `webhook-signature.ts` is shared: the path is then exercised on every local
 * run rather than only once real credentials exist.
 */
export function checkoutSignaturePayload(orderRef: string, gatewayRef: string): string {
  return `${orderRef}|${gatewayRef}`;
}
