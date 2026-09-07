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
import { apiFetch } from '@/lib/api/client';
import type { PaymentsDataSource } from './paymentsDataSource';

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
   */
  createIntent(
    bookingId: string,
    purpose: PaymentPurpose,
    idempotencyKey: string,
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
