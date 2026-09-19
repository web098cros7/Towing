'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import type {
  AdminBookingCancelBody,
  AdminBookingReassignBody,
  AdminBookingTransitionBody,
} from '@towing/api-contracts';
import { adminBookingsKeys } from './adminBookings.keys';
import { adminBookingsDataSource } from './adminBookingsDataSource';

/**
 * W8's booking interventions.
 *
 * `retry: false` on every write, for the same reason Finance's decisions have
 * it: React Query retries on TIMEOUTS, and a reassign that timed out may well
 * have landed — the offer may already be on a driver's phone. The operator
 * retries from a refreshed detail, not from a blind replay.
 *
 * All of them invalidate the whole namespace: an intervention changes the list
 * (a row leaves `assigned`), the detail (status, history, compensation) and,
 * for cancel, the ops feed.
 */
function useBookingInvalidation() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: adminBookingsKeys.all });
  };
}

export function useCancelBooking(bookingId: string) {
  const invalidate = useBookingInvalidation();
  return useMutation({
    mutationFn: (body: AdminBookingCancelBody) => adminBookingsDataSource.cancel(bookingId, body),
    retry: false,
    onSuccess: invalidate,
  });
}

export function useReassignBooking(bookingId: string) {
  const invalidate = useBookingInvalidation();
  return useMutation({
    mutationFn: (body: AdminBookingReassignBody) =>
      adminBookingsDataSource.reassign(bookingId, body),
    retry: false,
    onSuccess: invalidate,
  });
}

export function useTransitionBooking(bookingId: string) {
  const invalidate = useBookingInvalidation();
  return useMutation({
    mutationFn: (body: AdminBookingTransitionBody) =>
      adminBookingsDataSource.transition(bookingId, body),
    retry: false,
    onSuccess: invalidate,
  });
}

/** §14.2's recheck. Safe to retry server-side (it re-reads the gateway), but
 * the operator still gets one click — a retry storm against the gateway for a
 * stuck payment is exactly what the intervention exists to inspect. */
export function useRecheckPayment(bookingId: string) {
  const invalidate = useBookingInvalidation();
  return useMutation({
    mutationFn: () => adminBookingsDataSource.recheckPayment(bookingId),
    retry: false,
    onSuccess: invalidate,
  });
}

export function useRemindPayment(bookingId: string) {
  const invalidate = useBookingInvalidation();
  return useMutation({
    mutationFn: () => adminBookingsDataSource.remindPayment(bookingId),
    retry: false,
    onSuccess: invalidate,
  });
}
