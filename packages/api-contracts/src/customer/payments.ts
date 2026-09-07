import { z } from 'zod';
import { paiseSchema, unsignedPaiseSchema } from '../common/money';
import { fareBreakdownSchema } from './pricing-estimate';

/**
 * §9.1.9 / §14.2 — the customer's payment.
 *
 * TWO ROUTES, AND THE SPLIT IS THE DESIGN. `POST /v1/payments/:bookingId/intent`
 * asks the server to open an order with the gateway; the app then runs the
 * Razorpay sheet against it and comes back to
 * `POST /v1/payments/:bookingId/capture` with what the sheet returned.
 *
 * **The client's word is never the authority.** `capture` verifies the
 * checkout signature and then asks the gateway itself what happened before a
 * single ledger leg is written. A client that says "captured" about an order it
 * invented, or about a ₹1 order presented against a ₹2,000 tow, gets a 4xx and
 * zero rows — see `PaymentsService`.
 */

/**
 * `booking` is the fare. `cancellation_fee` is §3.5's charge, which is a
 * genuinely separate collection against the same booking and therefore its own
 * `payments` row — `uq_payments_one_captured_per_booking` is scoped so the two
 * can coexist.
 */
export const paymentPurposeSchema = z.enum(['booking', 'cancellation_fee']);
export type PaymentPurpose = z.infer<typeof paymentPurposeSchema>;

export const paymentIntentRequestSchema = z.object({
  purpose: paymentPurposeSchema.default('booking'),
});
export type PaymentIntentRequest = z.infer<typeof paymentIntentRequestSchema>;

export const paymentIntentSchema = z.object({
  /** Our `payments.id`. The app echoes it back on capture. */
  paymentId: z.uuid(),
  /** The gateway's order handle (Razorpay `order_…`) the sheet opens against. */
  orderRef: z.string().min(1),
  /**
   * The PUBLISHABLE key id, never the secret.
   *
   * Delivered per-request rather than baked into the app at build time, so
   * rotating the merchant key needs no store release — the same argument
   * `PUBLIC_TRACK_BASE_URL` makes, and it matters more here because a mobile
   * binary can take a week to replace.
   */
  publicKey: z.string().min(1),
  amountPaise: unsignedPaiseSchema,
  currency: z.literal('INR'),
  /**
   * True on the dev gateway: there is no real sheet to open, so the app skips
   * the native module entirely and calls `capture` directly. This is what makes
   * the whole chain demoable in Expo Go with no Razorpay account.
   */
  autoSettles: z.boolean(),
  /**
   * The checkout result the DEV gateway will accept, precomputed server-side.
   *
   * ⚠ ONLY EVER PRESENT WHEN `autoSettles` IS TRUE, and null against the real
   * gateway — where the signature comes from Razorpay's own sheet and could not
   * be produced here without handing the merchant secret to a phone.
   *
   * It exists because the dev adapter verifies a REAL HMAC keyed on
   * `PAYMENT_WEBHOOK_SECRET` (deliberately — a dev adapter that verified
   * nothing would leave `INVALID_PAYMENT_SIGNATURE` untested until the day a
   * merchant account existed). The client cannot compute that, and should not
   * be able to. So the server, which already knows the secret, computes it.
   */
  devCheckout: z
    .object({ gatewayRef: z.string(), signature: z.string() })
    .nullable()
    .default(null),
  /**
   * The locked fare, so the sheet renders the breakdown — including the GST and
   * coupon lines — without a second round trip.
   */
  breakdown: fareBreakdownSchema,
});
export type PaymentIntentDto = z.infer<typeof paymentIntentSchema>;

/**
 * Exactly what Razorpay's checkout handler hands back. All three are required:
 * the signature is HMAC-SHA256 over `orderRef|gatewayRef`, so verifying it
 * needs both refs and proves the pair was produced by the merchant account
 * rather than assembled by the caller.
 */
export const paymentCaptureRequestSchema = z.object({
  gatewayRef: z.string().min(1),
  orderRef: z.string().min(1),
  signature: z.string().min(1),
});
export type PaymentCaptureRequest = z.infer<typeof paymentCaptureRequestSchema>;

export const paymentStatusSchema = z.enum(['pending', 'authorized', 'captured', 'failed', 'refunded']);
export type PaymentStatusValue = z.infer<typeof paymentStatusSchema>;

export const paymentResultSchema = z.object({
  paymentId: z.uuid(),
  bookingId: z.uuid(),
  status: paymentStatusSchema,
  /** `paid` once settled. Stays `completed` on a failure — §19.2's honest state. */
  bookingStatus: z.string(),
  amountPaise: unsignedPaiseSchema,
  /** Whether the booking's invoice is ready to download yet. */
  invoiceAvailable: z.boolean(),
  failureReason: z.string().nullable(),
});
export type PaymentResultDto = z.infer<typeof paymentResultSchema>;

/** §9.1.10's invoice download. A signed URL, not a redirect — see `InvoiceController`. */
export const invoiceLinkSchema = z.object({
  url: z.url(),
  expiresAt: z.iso.datetime(),
});
export type InvoiceLinkDto = z.infer<typeof invoiceLinkSchema>;

/**
 * §9.1.9's in-app wallet. Read-only in Phase 19: rows arrive as refunds and
 * adjustments, never as a top-up — top-up is a whole second payment flow the
 * plan does not ask for and §9.1.9 does not describe.
 */
export const walletSchema = z.object({
  /** Signed. A wallet can legitimately go negative once §14.5 reversals land. */
  balancePaise: paiseSchema,
});
export type WalletDto = z.infer<typeof walletSchema>;

/**
 * One ledger row as a person reads it.
 *
 * `amountPaise` IS SIGNED and this is the first customer-facing surface in the
 * product to render signed money — which is why `formatPaise` had to be fixed
 * for negatives in the same phase.
 */
export const walletTransactionSchema = z.object({
  id: z.uuid(),
  amountPaise: paiseSchema,
  type: z.string(),
  reason: z.string().nullable(),
  bookingId: z.uuid().nullable(),
  createdAt: z.iso.datetime(),
});
export type WalletTransactionDto = z.infer<typeof walletTransactionSchema>;
