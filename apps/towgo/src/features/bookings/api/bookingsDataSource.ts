import type { PaymentCaptureRequest } from '@towing/api-contracts';
import type { BookingCancelResponse, BookingCreate, BookingOtpResponse } from '@towing/api-contracts';
import { env } from '@/lib/env';
import type { Booking, BookingDetail } from '../types';
import { bookingsMockSource } from './bookingsMockSource';
import { bookingsRestSource } from './bookingsRestSource';

export interface BookingsPage {
  items: Booking[];
  nextCursor: string | null;
}

export interface BookingsDataSource {
  /** §9.1.10's paginated history. */
  getBookings(cursor?: string): Promise<BookingsPage>;
  /** `null` means no such booking (REST 404). A thrown error means the request failed. */
  getBooking(bookingId: string): Promise<BookingDetail | null>;
  /**
   * §3.4's confirm. `idempotencyKey` is the CALLER's, minted once per confirm
   * attempt — see `useCreateBooking`.
   */
  createBooking(input: BookingCreate, idempotencyKey: string): Promise<BookingDetail>;
  /**
   * `payment` is the checkout result for a chargeable cancellation's fee
   * (`purpose: 'cancellation_fee'`), sent on the second call once the first
   * was refused with `cancellation_requires_payment`.
   */
  cancelBooking(
    bookingId: string,
    reason?: string,
    payment?: PaymentCaptureRequest,
  ): Promise<BookingCancelResponse>;
  /** §9.1.7 — only valid once a driver is assigned. */
  getOtp(bookingId: string): Promise<BookingOtpResponse>;
  /** L17: a new collection code, for when the driver has locked the old one. */
  renewOtp(bookingId: string): Promise<BookingOtpResponse>;
  /** §9.1.6's "retry / widen" — re-searches the SAME booking, keeping its locked fare. */
  retrySearch(bookingId: string): Promise<BookingDetail>;
}

/**
 * Phase 15 gave this its REST half. It was the only feature data source in the
 * app hard-wired to its mock — every other one (`services`, `pricing`,
 * `profile`, `vehicles`, `addresses`, `notifications`) has had the
 * `env.useMocks` ternary since Phase 12.
 */
export const bookingsDataSource: BookingsDataSource = env.useMocks
  ? bookingsMockSource
  : bookingsRestSource;
