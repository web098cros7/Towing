import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PaymentCaptureRequest, PaymentPurpose, RatingSubmit } from '@towing/api-contracts';
import { bookingsKeys } from '@/features/bookings/api/bookings.keys';
import { trackingKeys } from '@/features/tracking/api/tracking.keys';
import { paymentsDataSource } from './paymentsDataSource';
import { couponKeys, invoiceKeys, ratingKeys, walletKeys } from './payments.keys';

/**
 * ⚠ EVERY MONEY QUERY HERE IS `staleTime: 0, gcTime: 0`.
 *
 * The query cache is MMKV-PERSISTED with a global 24-hour `gcTime`, so without
 * this a customer reopening the app sees yesterday's wallet balance painted
 * instantly and confidently. A stale balance that looks like an answer is worse
 * than a spinner. This is the same shape `useCancellationQuote` uses, and for
 * the same reason its docstring gives: a number fetched once and shown five
 * minutes later can be the wrong number at exactly the moment somebody acts on
 * it.
 */

export function useWallet() {
  return useQuery({
    queryKey: walletKeys.balance(),
    queryFn: () => paymentsDataSource.getWallet(),
    staleTime: 0,
    gcTime: 0,
  });
}

export function useWalletTransactions() {
  return useQuery({
    queryKey: walletKeys.transactions(),
    queryFn: () => paymentsDataSource.getWalletTransactions(),
    staleTime: 0,
    gcTime: 0,
  });
}

/** `enabled`-gated on the sheet being open — nothing is fetched until it is. */
export function useRatingState(bookingId: string, enabled: boolean) {
  return useQuery({
    queryKey: ratingKeys.forBooking(bookingId),
    queryFn: () => paymentsDataSource.getRating(bookingId),
    enabled,
    staleTime: 0,
    gcTime: 0,
  });
}

export function useCreatePaymentIntent() {
  return useMutation({
    mutationFn: ({
      bookingId,
      purpose,
      idempotencyKey,
      couponCode,
    }: {
      bookingId: string;
      purpose: PaymentPurpose;
      idempotencyKey: string;
      /** 28's applied code. Honoured by the mock only; see `PaymentsDataSource.createIntent`. */
      couponCode?: string | null;
    }) => paymentsDataSource.createIntent(bookingId, purpose, idempotencyKey, couponCode),
    // A retried intent is safe under the same key, but react-query retries on
    // TIMEOUT too — and a timed-out intent may well have opened an order.
    retry: false,
  });
}

/**
 * Verify-and-settle.
 *
 * Invalidates the booking, the tracking payload AND the wallet, because a
 * capture moves all three: the booking becomes `paid`, the tracking status
 * follows it, and a §14.5 refund or adjustment can land in the wallet.
 */
export function useCapturePayment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      bookingId,
      body,
      idempotencyKey,
    }: {
      bookingId: string;
      body: PaymentCaptureRequest;
      idempotencyKey: string;
    }) => paymentsDataSource.capture(bookingId, body, idempotencyKey),
    retry: false,
    onSuccess: (_result, variables) => {
      void queryClient.invalidateQueries({ queryKey: bookingsKeys.detail(variables.bookingId) });
      void queryClient.invalidateQueries({ queryKey: trackingKeys.live(variables.bookingId) });
      void queryClient.invalidateQueries({ queryKey: walletKeys.all });
      void queryClient.invalidateQueries({ queryKey: invoiceKeys.forBooking(variables.bookingId) });
    },
  });
}

/**
 * §9.4.11's coupon check.
 *
 * A MUTATION RATHER THAN A QUERY, deliberately: it is a POST with a
 * side-effect-free body, but it must fire when the customer taps "Apply" and
 * never on its own. A query keyed on the code would re-run on every keystroke
 * against a rate-limited, code-guessing-sensitive endpoint.
 */
export function useValidateCoupon() {
  return useMutation({
    mutationFn: ({ code, subtotalPaise }: { code: string; subtotalPaise: number }) =>
      paymentsDataSource.validateCoupon(code, subtotalPaise),
    retry: false,
  });
}

/**
 * 28 · Apply Coupon's "Available offers", read while 27 is up (the sheet is
 * mounted with it), so they are in before the sheet first slides in.
 * `staleTime: 0, gcTime: 0` like the money reads above: an offer's eligibility
 * is about THIS trip, now.
 */
export function useCouponOffers(enabled: boolean) {
  return useQuery({
    queryKey: couponKeys.offers(),
    queryFn: () => paymentsDataSource.getCouponOffers(),
    enabled,
    staleTime: 0,
    gcTime: 0,
  });
}

/**
 * 28's Apply. The server folds the coupon into the booking's fare and closes
 * any open intent, so the booking detail is invalidated: the bill re-reads the
 * recomputed fare, and the next intent charges the new total.
 */
export function useApplyPaymentCoupon() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ bookingId, code }: { bookingId: string; code: string }) =>
      paymentsDataSource.applyCoupon(bookingId, code),
    retry: false,
    onSuccess: (_result, variables) => {
      void queryClient.invalidateQueries({ queryKey: bookingsKeys.detail(variables.bookingId) });
    },
  });
}

/** 28's Remove. Same invalidation as `useApplyPaymentCoupon`. */
export function useRemovePaymentCoupon() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ bookingId }: { bookingId: string }) =>
      paymentsDataSource.removeCoupon(bookingId),
    retry: false,
    onSuccess: (_result, variables) => {
      void queryClient.invalidateQueries({ queryKey: bookingsKeys.detail(variables.bookingId) });
    },
  });
}

/**
 * 27's Cash. The booking becomes `paid` when the DRIVER confirms the cash, so
 * the booking detail is invalidated: the caller polls it until it does.
 */
export function useChooseCash() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ bookingId }: { bookingId: string }) =>
      paymentsDataSource.chooseCash(bookingId),
    retry: false,
    onSuccess: (_result, variables) => {
      void queryClient.invalidateQueries({ queryKey: bookingsKeys.detail(variables.bookingId) });
    },
  });
}

/**
 * Confirms a wallet-only intent. Invalidates the booking and the wallet, since
 * the wallet balance moves and the booking becomes `paid`.
 */
export function useWalletPay() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ bookingId }: { bookingId: string }) =>
      paymentsDataSource.payWithWallet(bookingId),
    retry: false,
    onSuccess: (_result, variables) => {
      void queryClient.invalidateQueries({ queryKey: bookingsKeys.detail(variables.bookingId) });
      void queryClient.invalidateQueries({ queryKey: walletKeys.all });
    },
  });
}

/** §9.1.10's download. Fetched on tap; the URL expires in five minutes. */
export function useInvoiceLink() {
  return useMutation({
    mutationFn: (bookingId: string) => paymentsDataSource.getInvoiceLink(bookingId),
    retry: false,
  });
}

export function useSubmitRating() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ bookingId, body }: { bookingId: string; body: RatingSubmit }) =>
      paymentsDataSource.submitRating(bookingId, body),
    retry: false,
    onSuccess: (_result, variables) => {
      void queryClient.invalidateQueries({ queryKey: ratingKeys.forBooking(variables.bookingId) });
    },
  });
}
