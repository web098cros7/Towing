'use client';

import { useQuery } from '@tanstack/react-query';
import type { AdminBookingsQuery } from '@towing/api-contracts';
import { adminBookingsKeys } from './adminBookings.keys';
import { adminBookingsDataSource } from './adminBookingsDataSource';

/**
 * The bookings list. `staleTime: 0` + refetch-on-focus, like Finance's queue:
 * two operators can be working the same exception list, and a row somebody
 * else has already cancelled must not keep a live button — the API's 409 is
 * the real guard, but a stale list makes that error look like a bug.
 */
export function useAdminBookings(query: AdminBookingsQuery) {
  return useQuery({
    queryKey: adminBookingsKeys.list(query),
    queryFn: () => adminBookingsDataSource.list(query),
    staleTime: 0,
    refetchOnWindowFocus: true,
  });
}

export function useAdminBooking(bookingId: string | null) {
  return useQuery({
    queryKey: adminBookingsKeys.detail(bookingId ?? ''),
    queryFn: () => adminBookingsDataSource.detail(bookingId as string),
    enabled: Boolean(bookingId),
    staleTime: 0,
    refetchOnWindowFocus: true,
  });
}

/**
 * The invoice link is minted ON DEMAND — `enabled` stays false until the
 * operator asks for it. Every mint lands in the audit trail server-side
 * (`booking.invoice.view`), so fetching on page load would write audit rows
 * for views nobody took.
 */
export function useAdminBookingInvoice(bookingId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: adminBookingsKeys.invoice(bookingId ?? ''),
    queryFn: () => adminBookingsDataSource.invoice(bookingId as string),
    enabled: Boolean(bookingId) && enabled,
    staleTime: 5 * 60 * 1000,
    gcTime: 0,
  });
}
