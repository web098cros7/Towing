import type {
  CashPaymentResponse,
  CouponOffer as ApiCouponOffer,
  CouponOffersResponse,
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
import { apiFetch } from '@/lib/api/client';
import { formatPaise } from '@/utils/format';
import type { CouponOffer } from '../types';
import type { PaymentsDataSource } from './paymentsDataSource';

/**
 * The contract's `CouponOffer` (code, kind, percent, flatPaise, maxDiscountPaise,
 * minOrderPaise, expiresAt) mapped to the app's display-only `CouponOffer`
 * (code, title, validity). The title is built from the contract's numbers so
 * the drawn copy ("20% off up to ₹300") is what the server actually offers.
 */
function toAppOffer(offer: ApiCouponOffer): CouponOffer {
  let title: string;
  if (offer.kind === 'percent') {
    const percent = offer.percent ?? 0;
    title = `${percent}% off`;
    if (offer.maxDiscountPaise) title += ` up to ${formatPaise(offer.maxDiscountPaise)}`;
  } else {
    title = `Flat ${formatPaise(offer.flatPaise ?? 0)} off`;
  }
  if (offer.minOrderPaise > 0) {
    title += ` on trips above ${formatPaise(offer.minOrderPaise)}`;
  }

  const validity = offer.expiresAt
    ? `Valid till ${new Date(offer.expiresAt).toLocaleDateString('en-IN', {
        day: 'numeric',
        month: 'short',
      })}`
    : 'Every day';

  return { code: offer.code, title, validity };
}

export const paymentsRestSource: PaymentsDataSource = {
  /**
   * ⚠ AN EXPLICIT `Idempotency-Key` HEADER, not `idempotent: true`.
   *
   * The two are different semantics and `client.ts` documents the distinction:
   * `idempotent: true` means "a fresh intent each attempt, mint per call", and
   * an explicit header means "this is one intent, reuse the key across every
   * retry". A payment is emphatically the second — the same argument
   * `createBooking` makes, and `client.ts` carries a comment about the two
   * fare-locked bookings that resulted from getting it wrong once.
   *
   * ⚠ `couponCode` IS IGNORED, deliberately: the coupon is applied through
   * `applyCoupon` (which folds it into the booking's fare and closes any open
   * intent) BEFORE this call, so the intent already charges the discounted
   * total. `paymentIntentRequestSchema` is `{ purpose }` and would drop the
   * field anyway.
   */
  createIntent(
    bookingId: string,
    purpose: PaymentPurpose,
    idempotencyKey: string,
    _couponCode?: string | null,
  ): Promise<PaymentIntentDto> {
    return apiFetch<PaymentIntentDto>(`payments/${bookingId}/intent`, {
      method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify({ purpose }),
    });
  },

  capture(
    bookingId: string,
    body: PaymentCaptureRequest,
    idempotencyKey: string,
  ): Promise<PaymentResultDto> {
    return apiFetch<PaymentResultDto>(`payments/${bookingId}/capture`, {
      method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify(body),
    });
  },

  getWallet(): Promise<WalletDto> {
    return apiFetch<WalletDto>('wallet');
  },

  async getWalletTransactions(): Promise<WalletTransactionDto[]> {
    const { items } = await apiFetch<{ items: WalletTransactionDto[] }>('wallet/transactions');
    return items;
  },

  /**
   * NO IDEMPOTENCY KEY. Validation is a pure read that happens to be a POST
   * (the code goes in the body rather than a URL, where it would land in access
   * logs), and a cached replay would return a stale discount for a subtotal
   * that has since changed.
   */
  validateCoupon(code: string, subtotalPaise: number): Promise<CouponValidationDto> {
    return apiFetch<CouponValidationDto>('coupons/validate', {
      method: 'POST',
      body: JSON.stringify({ code, subtotalPaise }),
    });
  },

  /**
   * The live offers list. Each contract offer is mapped to the app's display
   * shape by `toAppOffer`; the server's numbers drive the title and validity.
   */
  async getCouponOffers(): Promise<CouponOffer[]> {
    const { items } = await apiFetch<CouponOffersResponse>('coupons/offers');
    return items.map(toAppOffer);
  },

  /**
   * 28's Apply. The server folds the coupon into the booking's fare and closes
   * any open intent; the NEXT intent charges the new total. Idempotent so a
   * retry does not double-apply.
   */
  applyCoupon(bookingId: string, code: string): Promise<PaymentCouponResponse> {
    return apiFetch<PaymentCouponResponse>(`payments/${bookingId}/coupon`, {
      method: 'POST',
      body: JSON.stringify({ code }),
      idempotent: true,
    });
  },

  /** 28's Remove. No body; idempotent so a retry is safe. */
  removeCoupon(bookingId: string): Promise<PaymentCouponResponse> {
    return apiFetch<PaymentCouponResponse>(`payments/${bookingId}/coupon`, {
      method: 'DELETE',
      idempotent: true,
    });
  },

  /**
   * 27's Cash. The booking becomes `paid` when the DRIVER confirms the cash;
   * the caller polls the booking until it does.
   */
  chooseCash(bookingId: string): Promise<CashPaymentResponse> {
    return apiFetch<CashPaymentResponse>(`payments/${bookingId}/cash`, {
      method: 'POST',
      idempotent: true,
    });
  },

  /**
   * Confirms a wallet-only intent (`intent.walletOnly`): the wallet covers the
   * whole bill, so no gateway sheet opens. Idempotent so a retry is safe.
   */
  payWithWallet(bookingId: string): Promise<PaymentResultDto> {
    return apiFetch<PaymentResultDto>(`payments/${bookingId}/wallet`, {
      method: 'POST',
      idempotent: true,
    });
  },

  getInvoiceLink(bookingId: string): Promise<InvoiceLinkDto> {
    return apiFetch<InvoiceLinkDto>(`bookings/${bookingId}/invoice`);
  },

  getRating(bookingId: string): Promise<RatingStateDto> {
    return apiFetch<RatingStateDto>(`bookings/${bookingId}/rating`);
  },

  /**
   * NO IDEMPOTENCY KEY, deliberately. `uq_ratings_booking_direction` makes a
   * repeat an UPSERT rather than a second row — a stronger mechanism than a
   * replayed cached response, and one that lets a customer genuinely change
   * their mind rather than silently no-op.
   */
  async submitRating(bookingId: string, body: RatingSubmit): Promise<void> {
    await apiFetch<unknown>(`bookings/${bookingId}/rate`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },
};
