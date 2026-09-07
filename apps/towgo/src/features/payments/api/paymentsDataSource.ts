import { env } from '@/lib/env';
import { paymentsMockSource } from './paymentsMockSource';
import { paymentsRestSource } from './paymentsRestSource';
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

/**
 * §9.1.9's payment, wallet, coupon, invoice and rating surface.
 *
 * ONE DATA SOURCE FOR ALL FIVE rather than five files of boilerplate: they are
 * the same customer's money, they invalidate each other (a capture makes an
 * invoice available and can move a wallet balance), and splitting them would
 * mean five mocks that have to agree about one booking's state.
 */
export interface PaymentsDataSource {
  /**
   * Opens the gateway order the Razorpay sheet runs against.
   *
   * `idempotencyKey` IS A PARAMETER, minted once per sheet session by the
   * caller. `apiFetch`'s `idempotent: true` mints one per CALL, which would
   * make a retry a second order — the `createBooking` distinction, and the
   * reason `client.ts` carries a long comment about two fare-locked bookings.
   */
  createIntent(
    bookingId: string,
    purpose: PaymentPurpose,
    idempotencyKey: string,
  ): Promise<PaymentIntentDto>;

  /** Hands the sheet's result back for verification and settlement. */
  capture(
    bookingId: string,
    body: PaymentCaptureRequest,
    idempotencyKey: string,
  ): Promise<PaymentResultDto>;

  getWallet(): Promise<WalletDto>;
  getWalletTransactions(): Promise<WalletTransactionDto[]>;

  validateCoupon(code: string, subtotalPaise: number): Promise<CouponValidationDto>;

  /** §9.1.10's invoice download — a signed URL, opened with `Linking`. */
  getInvoiceLink(bookingId: string): Promise<InvoiceLinkDto>;

  getRating(bookingId: string): Promise<RatingStateDto>;
  submitRating(bookingId: string, body: RatingSubmit): Promise<void>;
}

export const paymentsDataSource: PaymentsDataSource = env.useMocks
  ? paymentsMockSource
  : paymentsRestSource;
