import type {
  CashPaymentResponse,
  CouponValidationDto,
  InvoiceLinkDto,
  PaymentCaptureRequest,
  PaymentCouponResponse,
  PaymentIntentDto,
  PaymentPurpose,
  PaymentResultDto,
  RatingStateDto,
  RatingSubmit,
  WalletDto,
  WalletTransactionDto,
} from '@towing/api-contracts';
import { bookingsMockSource } from '@/features/bookings/api/bookingsMockSource';
import { recordMockPaid } from '@/features/tracking/api/mockTripClock';
import { env } from '@/lib/env';
import type { CouponOffer } from '../types';
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
 * THE FIRST PAY OF EACH BOOKING IS DECLINED, and the next one is captured, so
 * test mode walks 27 Payment → 29 Payment Failed → 30 Payment Successful with no
 * setting to change: a fake gateway never fails on its own, and a ladder that
 * has never executed is not a ladder. `EXPO_PUBLIC_MOCK_PAYMENT_STATE=failed`
 * still declines EVERY attempt (§19.2's `COMPLETED (unpaid)` branch for good).
 *
 * THE AMOUNT IS THE BOOKING'S TOTAL, read from the mock booking, so 27's Total,
 * 29's Amount and 30's Service price agree with each other and with My Bookings.
 * A coupon applied on 28 (test mode only) comes off that total here, which the
 * real server cannot do yet (27-28 Data gap 8).
 */

/** Module-level so a capture actually changes what the next read returns. */
const paid = new Set<string>();
const rated = new Map<string, RatingStateDto['mine']>();
/** Bookings whose first capture this session has already been declined. */
const declinedOnce = new Set<string>();
/**
 * Order reference → the amount of the intent that opened it, which the capture result echoes.
 * Keyed by order, not by booking: a coupon re-creates the intent under a new key, so one
 * booking has several orders, and a capture must report the amount of the one it settles.
 */
const intentAmountByOrder = new Map<string, number>();

/** What the mock charged before the amount followed the booking. Kept as the fallback. */
const FALLBACK_TOTAL_PAISE = 200_000;

/**
 * 28's three drawn offers (`299:4081`, `299:4088`, `299:4095`), their copy
 * VERBATIM: "₹" U+20B9, "till" lower case, "Every day" lower-case d.
 */
const OFFERS: CouponOffer[] = [
  { code: 'SAVE20', title: '20% off up to ₹300', validity: 'Valid till 31 Mar' },
  { code: 'TOW100', title: 'Flat ₹100 off tows above ₹800', validity: 'Valid till 15 Apr' },
  { code: 'NIGHT50', title: '₹50 off night tows, 10 PM to 6 AM', validity: 'Every day' },
];

/**
 * The mock's coupon rules, shared by `validateCoupon` and `createIntent` so the
 * saving 28 announces is exactly what the intent takes off. Each drawn offer
 * does what its title says, except NIGHT50's night window, which nothing in the
 * system models (it is accepted at any hour here). EXPIRED stays the expired
 * branch.
 */
function mockCoupon(code: string, subtotalPaise: number): CouponValidationDto {
  const normalised = code.trim().toUpperCase();

  if (normalised === 'SAVE20') {
    const discountPaise = Math.min(Math.round(subtotalPaise * 0.2), 30_000, subtotalPaise);
    return { valid: true, code: 'SAVE20', kind: 'percent', discountPaise, reason: null };
  }

  if (normalised === 'TOW100') {
    if (subtotalPaise < 80_000) {
      return {
        valid: false,
        code: 'TOW100',
        kind: 'flat',
        discountPaise: 0,
        reason: 'below_min_order',
      };
    }
    return { valid: true, code: 'TOW100', kind: 'flat', discountPaise: 10_000, reason: null };
  }

  if (normalised === 'NIGHT50') {
    const discountPaise = Math.min(5_000, subtotalPaise);
    return { valid: true, code: 'NIGHT50', kind: 'flat', discountPaise, reason: null };
  }

  if (normalised === 'EXPIRED') {
    return { valid: false, code: 'EXPIRED', kind: 'percent', discountPaise: 0, reason: 'expired' };
  }

  // An unknown code and an inactive one give the SAME answer server-side —
  // a coupon endpoint is a code-guessing surface.
  return { valid: false, code: null, kind: null, discountPaise: 0, reason: 'invalid' };
}

/** The mock booking's total (what the server locks at confirm), or the old fixed amount. */
async function bookingTotalPaise(bookingId: string): Promise<number> {
  try {
    const booking = await bookingsMockSource.getBooking(bookingId);
    return booking?.breakdown.totalPaise ?? FALLBACK_TOTAL_PAISE;
  } catch {
    return FALLBACK_TOTAL_PAISE;
  }
}

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
  async createIntent(
    bookingId: string,
    purpose: PaymentPurpose,
    idempotencyKey: string,
    couponCode?: string | null,
  ): Promise<PaymentIntentDto> {
    await delay(300);
    if (env.mockPaymentState === 'error') throw new Error('Could not start the payment');

    const subtotalPaise =
      purpose === 'cancellation_fee' ? 15_000 : await bookingTotalPaise(bookingId);
    const coupon =
      couponCode && purpose === 'booking' ? mockCoupon(couponCode, subtotalPaise) : null;
    const discountPaise = coupon?.valid ? coupon.discountPaise : 0;
    const amountPaise = subtotalPaise - discountPaise;
    // One order per intent key, as the server keeps it: a replay under the same key is the same
    // order; a new key (28's Apply / Remove) is a new one.
    const orderRef = `order_dev_mock_${bookingId.slice(0, 8)}_${idempotencyKey.slice(0, 8)}`;
    intentAmountByOrder.set(orderRef, amountPaise);

    return {
      paymentId: `mock-payment-${bookingId}`,
      orderRef,
      publicKey: 'rzp_test_dev',
      amountPaise,
      // Test mode keeps the wallet out of the bill; the live API applies it.
      walletAppliedPaise: 0,
      walletOnly: false,
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
      // One base line for the whole subtotal: the mock booking's own lines are
      // not the point here, and nothing on 27 draws a breakdown.
      breakdown: {
        basePaise: subtotalPaise,
        nightPaise: 0,
        highwayPaise: 0,
        accidentPaise: 0,
        waitingPaise: 0,
        surgePaise: 0,
        discountPaise,
        taxPaise: 0,
        totalPaise: amountPaise,
      },
    };
  },

  async capture(bookingId: string, body: PaymentCaptureRequest): Promise<PaymentResultDto> {
    await delay(900);
    const amountPaise = intentAmountByOrder.get(body.orderRef) ?? FALLBACK_TOTAL_PAISE;

    // The first attempt per booking, or every attempt under `failed`. See the header.
    if (env.mockPaymentState === 'failed' || !declinedOnce.has(bookingId)) {
      declinedOnce.add(bookingId);
      // §19.2's honest state: the BOOKING stays `completed`, and the app has to
      // be able to render that rather than pretending the trip vanished. The
      // reason is 29's drawn sample ("Declined by bank", `292:2731`).
      return {
        paymentId: `mock-payment-${bookingId}`,
        bookingId,
        status: 'failed',
        bookingStatus: 'completed',
        amountPaise,
        invoiceAvailable: false,
        failureReason: 'Declined by bank',
      };
    }

    if (env.mockPaymentState === 'error') throw new Error('Could not confirm the payment');

    paid.add(bookingId);
    // The mock trip clock turns the mock booking `paid` from here.
    recordMockPaid(bookingId);

    return {
      paymentId: `mock-payment-${bookingId}`,
      bookingId,
      status: 'captured',
      bookingStatus: 'paid',
      amountPaise,
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

    // The three drawn offers work and EXPIRED is expired, so both branches of
    // 28 are reachable without a server. See `mockCoupon`.
    return mockCoupon(code, subtotalPaise);
  },

  async getCouponOffers(): Promise<CouponOffer[]> {
    await delay(300);
    if (env.mockCouponState === 'error') throw new Error('Could not load offers');
    return OFFERS;
  },

  /**
   * The mock applies coupons inside `createIntent` (see the header), so there
   * is nothing to do here. Resolving `null` keeps the caller's contract: the
   * mock has no server-side coupon state to return.
   */
  async applyCoupon(_bookingId: string, _code: string): Promise<PaymentCouponResponse | null> {
    await delay(200);
    return null;
  },

  /** The inverse of `applyCoupon`; the mock has no server-side coupon state. */
  async removeCoupon(_bookingId: string): Promise<PaymentCouponResponse | null> {
    await delay(200);
    return null;
  },

  /**
   * 27's Cash. The mock does NOT mark the booking paid immediately: the driver
   * confirms the cash in the driver app, so the booking is scheduled to turn
   * `paid` 8 s later. That gives test mode time to show 31b · Pay Cash to
   * Driver, then 31 · Payment Successful. The amount is the booking's total
   * (or the fallback when the booking cannot be read).
   */
  async chooseCash(bookingId: string): Promise<CashPaymentResponse> {
    await delay(400);
    if (env.mockPaymentState === 'error') throw new Error('Could not record the cash payment');

    const amountPaise = await bookingTotalPaise(bookingId);
    setTimeout(() => {
      paid.add(bookingId);
      recordMockPaid(bookingId);
    }, 8000);

    return {
      paymentId: `mock-cash-${bookingId}`,
      bookingId,
      status: 'awaiting_cash',
      amountPaise,
    };
  },

  /** The mock never opens a wallet-only intent, so this is never reached. */
  async payWithWallet(_bookingId: string): Promise<PaymentResultDto> {
    throw new Error('The mock never opens a wallet-only intent');
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
