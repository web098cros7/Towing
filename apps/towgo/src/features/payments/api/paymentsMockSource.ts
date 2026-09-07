import type {
  CouponValidationDto,
  InvoiceLinkDto,
  PaymentCaptureRequest,
  PaymentIntentDto,
  PaymentPurpose,
  PaymentResultDto,
  RatingStateDto,
  RatingSubmit,
  WalletDto,
  WalletTransactionDto,
} from '@towing/api-contracts';
import { env } from '@/lib/env';
import type { PaymentsDataSource } from './paymentsDataSource';

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * §9.1.9's flow, without a gateway, a native module or a server.
 *
 * WHY THIS HAS TO BE GENUINELY EXERCISABLE. No EAS or dev-client build has ever
 * been produced for this app, so mock mode is the only way anybody has seen
 * these screens at all — and `react-native-razorpay` is a native module that
 * cannot run in Expo Go. `autoSettles: true` is what lets the payment sheet
 * skip the SDK entirely here, so the whole chain (pay → invoice → rate) is
 * walkable on a laptop.
 *
 * `EXPO_PUBLIC_MOCK_PAYMENT_STATE=failed` reaches §19.2's `COMPLETED (unpaid)`
 * branch, which is otherwise unreachable in a mock: a fake gateway never fails
 * on its own, and a ladder that has never executed is not a ladder.
 */

/** Module-level so a capture actually changes what the next read returns. */
const paid = new Set<string>();
const rated = new Map<string, RatingStateDto['mine']>();

const transactions: WalletTransactionDto[] = [
  {
    id: 'wt1',
    // NEGATIVE, deliberately: §14.5 reversals and refunds are the first signed
    // money this app ever renders, and `formatPaise(-…)` used to produce
    // `₹-,500`.
    amountPaise: -25_000,
    type: 'refund_debit',
    reason: 'Reversed — booking refunded',
    bookingId: null,
    createdAt: '2026-08-30T09:15:00.000Z',
  },
  {
    id: 'wt2',
    amountPaise: 25_000,
    type: 'adjustment',
    reason: 'Goodwill credit',
    bookingId: null,
    createdAt: '2026-08-28T11:00:00.000Z',
  },
];

export const paymentsMockSource: PaymentsDataSource = {
  async createIntent(bookingId: string, purpose: PaymentPurpose): Promise<PaymentIntentDto> {
    await delay(500);
    if (env.mockPaymentState === 'error') throw new Error('Could not start the payment');

    const amountPaise = purpose === 'cancellation_fee' ? 15_000 : 200_000;

    return {
      paymentId: `mock-payment-${bookingId}`,
      orderRef: `order_dev_mock_${bookingId.slice(0, 8)}`,
      publicKey: 'rzp_test_dev',
      amountPaise,
      currency: 'INR',
      // The app skips the native sheet on this. See the header.
      autoSettles: true,
      // The mock never reaches a server, so nothing verifies this — but the
      // SHAPE has to match, or the sheet would take a different code path in
      // mock mode than it does against a real dev backend.
      devCheckout: {
        gatewayRef: `pay_dev_mock_${bookingId.slice(0, 8)}`,
        signature: 'mock-signature',
      },
      breakdown: {
        basePaise: 150_000,
        nightPaise: 0,
        highwayPaise: 0,
        accidentPaise: 0,
        waitingPaise: 25_000,
        surgePaise: 25_000,
        discountPaise: 0,
        taxPaise: 0,
        totalPaise: amountPaise,
      },
    };
  },

  async capture(bookingId: string, _body: PaymentCaptureRequest): Promise<PaymentResultDto> {
    await delay(900);

    if (env.mockPaymentState === 'failed') {
      // §19.2's honest state: the BOOKING stays `completed`, and the app has to
      // be able to render that rather than pretending the trip vanished.
      return {
        paymentId: `mock-payment-${bookingId}`,
        bookingId,
        status: 'failed',
        bookingStatus: 'completed',
        amountPaise: 200_000,
        invoiceAvailable: false,
        failureReason: 'Your bank declined this payment',
      };
    }

    if (env.mockPaymentState === 'error') throw new Error('Could not confirm the payment');

    paid.add(bookingId);

    return {
      paymentId: `mock-payment-${bookingId}`,
      bookingId,
      status: 'captured',
      bookingStatus: 'paid',
      amountPaise: 200_000,
      invoiceAvailable: true,
      failureReason: null,
    };
  },

  async getWallet(): Promise<WalletDto> {
    await delay(300);
    if (env.mockWalletState === 'error') throw new Error('Could not load your wallet');
    return { balancePaise: env.mockWalletState === 'empty' ? 0 : 25_000 };
  },

  async getWalletTransactions(): Promise<WalletTransactionDto[]> {
    await delay(300);
    if (env.mockWalletState === 'error') throw new Error('Could not load your wallet');
    return env.mockWalletState === 'empty' ? [] : transactions;
  },

  async validateCoupon(code: string, subtotalPaise: number): Promise<CouponValidationDto> {
    await delay(500);
    if (env.mockCouponState === 'error') throw new Error('Could not check that code');

    // One code that works and one that is expired, so both branches of the
    // sheet are reachable without a server.
    if (code.trim().toUpperCase() === 'SAVE20') {
      return {
        valid: true,
        code: 'SAVE20',
        kind: 'percent',
        discountPaise: Math.round(subtotalPaise * 0.2),
        reason: null,
      };
    }

    if (code.trim().toUpperCase() === 'EXPIRED') {
      return { valid: false, code: 'EXPIRED', kind: 'percent', discountPaise: 0, reason: 'expired' };
    }

    // An unknown code and an inactive one give the SAME answer server-side —
    // a coupon endpoint is a code-guessing surface.
    return { valid: false, code: null, kind: null, discountPaise: 0, reason: 'invalid' };
  },

  async getInvoiceLink(bookingId: string): Promise<InvoiceLinkDto> {
    await delay(400);
    if (!paid.has(bookingId)) throw new Error('An invoice is available once the trip is paid for');

    return {
      url: `https://example.invalid/invoices/${bookingId}.pdf`,
      expiresAt: new Date(Date.now() + 300_000).toISOString(),
    };
  },

  async getRating(bookingId: string): Promise<RatingStateDto> {
    await delay(250);
    return { mine: rated.get(bookingId) ?? null, canRate: true };
  },

  async submitRating(bookingId: string, body: RatingSubmit): Promise<void> {
    await delay(500);
    if (env.mockPaymentState === 'error') throw new Error('Could not save your rating');

    rated.set(bookingId, {
      bookingId,
      direction: 'customer_to_driver',
      rating: body.rating,
      review: body.review ?? null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  },
};
