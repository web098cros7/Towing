import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { BookingCreate } from '@towing/api-contracts';
import { useMemo } from 'react';
import { ErrorCodes } from '@towing/api-contracts';
import { ApiClientError } from '@/lib/api/errors';
import { newIdempotencyKey } from '@/lib/api/idempotency';
import { paymentsDataSource } from '@/features/payments/api/paymentsDataSource';
import { CheckoutDismissedError, openCheckout } from '@/features/payments/razorpay';
import { isActiveBooking, type Booking } from '../types';
import { bookingsDataSource } from './bookingsDataSource';
import { bookingsKeys } from './bookings.keys';

/**
 * §9.1.10's trip history — "history paginates".
 *
 * `useInfiniteQuery` over the server's cursor envelope, the same shape
 * `notifications.queries.ts` already uses. `flat` is exposed because every
 * consumer wants the rows, not the pages.
 *
 * `enabled: false` skips the request (default on); pages already in the cache
 * are still returned.
 */
export function useBookings(options: { enabled?: boolean } = {}) {
  const query = useInfiniteQuery({
    queryKey: bookingsKeys.list(),
    queryFn: ({ pageParam }: { pageParam?: string }) => bookingsDataSource.getBookings(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: options.enabled ?? true,
  });

  const items = useMemo(
    () => query.data?.pages.flatMap((page) => page.items) ?? [],
    [query.data],
  );

  return { ...query, items };
}

/**
 * §9.1.10's ACTIVE TRIP — the trip in flight, if there is one.
 *
 * Derived from the same feed rather than fetched separately: there is at most
 * one (§3.8), it is always the newest, and a second request would be a second
 * source of truth for a fact the list already carries.
 *
 * This is what makes an in-flight trip recoverable. Before Phase 15, leaving
 * the tracking screen lost the trip entirely — nothing anywhere else in the app
 * knew it existed.
 *
 * `enabled: false` skips the feed request for a screen that already knows its
 * trip (26 Emergency opened with a `bookingId`); `booking` is then whatever the
 * cache already holds.
 */
export function useActiveBooking(options: { enabled?: boolean } = {}): {
  booking: Booking | null;
  isPending: boolean;
} {
  const { items, isPending } = useBookings(options);
  const booking = useMemo(() => items.find(isActiveBooking) ?? null, [items]);
  return { booking, isPending };
}

/**
 * One booking's full detail.
 *
 * `refetchInterval` is §19.2's "apps poll REST for state every 10s" fallback,
 * and in Phase 15 it is the ONLY way a status change reaches the app — there is
 * no customer socket until Phase 18. Polling stops once the trip is terminal so
 * a finished booking does not keep waking the radio.
 */
export function useBooking(bookingId: string, options: { poll?: boolean } = {}) {
  return useQuery({
    queryKey: bookingsKeys.detail(bookingId),
    queryFn: () => bookingsDataSource.getBooking(bookingId),
    refetchInterval: (query) => {
      if (!options.poll) return false;
      const data = query.state.data;
      return data && isActiveBooking(data) ? 10_000 : false;
    },
  });
}

/**
 * §3.4's confirm.
 *
 * THE IDEMPOTENCY KEY IS MINTED ONCE PER ATTEMPT, in `mutationFn`, and reused
 * by every retry of that attempt. §19.4 requires a replay to carry the ORIGINAL
 * key; a key generated per HTTP call would turn a token refresh mid-confirm
 * into two fare-locked bookings.
 */
export function useCreateBooking() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: BookingCreate) =>
      bookingsDataSource.createBooking(input, newIdempotencyKey()),
    onSuccess: (booking) => {
      queryClient.setQueryData(bookingsKeys.detail(booking.id), booking);
      void queryClient.invalidateQueries({ queryKey: bookingsKeys.list() });
    },
  });
}

/** §3.5 — free branches only until Phase 19 can collect a fee. */
/**
 * Thrown when the customer closes the payment sheet for a cancellation fee.
 * Not a failure: they chose not to pay, so the trip simply goes on. Callers
 * keep the cancel sheet open and say nothing.
 */
export class CancellationFeeNotPaidError extends Error {
  constructor() {
    super('The cancellation fee was not paid');
    this.name = 'CancellationFeeNotPaidError';
  }
}

/**
 * Cancel a trip, paying §3.5's fee first when there is one (B15/B17).
 *
 * THE SERVER DECIDES WHETHER A FEE IS DUE, at the moment of the cancel — not
 * the quote the sheet showed a few seconds earlier, which a driver moving can
 * have changed. So the first call goes without payment; a chargeable tier is
 * refused with `cancellation_requires_payment`, and only then is the fee
 * collected (`purpose: 'cancellation_fee'`, the same checkout 27 uses) and the
 * cancel sent again carrying it. Before this, every chargeable cancel ended at
 * that refusal and a "Could not cancel" alert.
 *
 * No new screen: the fee and its tier are already on 21's sheet, and the
 * payment sheet is Razorpay's own.
 */
export function useCancelBooking() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ bookingId, reason }: { bookingId: string; reason?: string }) => {
      try {
        return await bookingsDataSource.cancelBooking(bookingId, reason);
      } catch (error) {
        if (
          !(error instanceof ApiClientError) ||
          error.code !== ErrorCodes.CANCELLATION_REQUIRES_PAYMENT
        ) {
          throw error;
        }
      }

      const intent = await paymentsDataSource.createIntent(
        bookingId,
        'cancellation_fee',
        newIdempotencyKey(),
      );
      let payment;
      try {
        payment = await openCheckout(intent);
      } catch (error) {
        if (error instanceof CheckoutDismissedError) throw new CancellationFeeNotPaidError();
        throw error;
      }
      return bookingsDataSource.cancelBooking(bookingId, reason, payment);
    },
    onSuccess: (_result, { bookingId }) => {
      void queryClient.invalidateQueries({ queryKey: bookingsKeys.detail(bookingId) });
      void queryClient.invalidateQueries({ queryKey: bookingsKeys.list() });
    },
  });
}

/**
 * §9.1.6's "retry / widen" (Phase 17).
 *
 * RE-SEARCHES THE SAME BOOKING, which is why the button exists at all: the fare
 * was locked at confirm, and starting a new booking would re-quote the customer
 * — possibly at a higher surge — for the platform's own failure to find anyone.
 * `no_drivers_found → searching` is a legal §5.1 transition precisely so this
 * can work.
 */
export function useRetrySearch() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (bookingId: string) => bookingsDataSource.retrySearch(bookingId),
    onSuccess: (_result, bookingId) => {
      void queryClient.invalidateQueries({ queryKey: bookingsKeys.detail(bookingId) });
      void queryClient.invalidateQueries({ queryKey: bookingsKeys.list() });
    },
  });
}

/**
 * §9.1.7's OTP card. `enabled` mirrors the server's own rule so the app never
 * fires a request it knows will 409.
 */
export function useBookingOtp(
  bookingId: string,
  available: boolean,
  /** L17: how often to re-read while the code is on screen, to notice a lock. */
  refetchIntervalMs?: number,
) {
  return useQuery({
    queryKey: bookingsKeys.otp(bookingId),
    queryFn: () => bookingsDataSource.getOtp(bookingId),
    enabled: available,
    // The server rotates a lapsed code; refetching inside the window returns
    // the same one, so this is cheap and keeps a long trip's card live.
    staleTime: 5 * 60 * 1000,
    refetchInterval: available && refetchIntervalMs ? refetchIntervalMs : false,
  });
}

/**
 * L17: ask for a new collection code. The answer replaces the cached code at
 * once, so the six digits on 24 change the moment the new code exists.
 */
export function useRenewBookingOtp(bookingId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => bookingsDataSource.renewOtp(bookingId),
    onSuccess: (fresh) => queryClient.setQueryData(bookingsKeys.otp(bookingId), fresh),
  });
}
