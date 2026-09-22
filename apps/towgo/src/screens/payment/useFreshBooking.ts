import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { bookingsKeys } from '@/features/bookings/api/bookings.keys';
import { bookingsDataSource } from '@/features/bookings/api/bookingsDataSource';
import type { BookingDetail } from '@/features/bookings/types';

/**
 * The booking as the server has it NOW, for 27's money lines: the Service price, the subtotal a
 * coupon is checked against, and 29's Reference ID.
 *
 * `useBooking`'s key and source, so the capture's invalidation and the payment session's
 * `fetchQuery` share this entry, but read afresh on every mount (`staleTime: 0`,
 * `refetchOnMount: 'always'`), and NOTHING is returned until a read that finished after this
 * screen mounted: the query cache is persisted to disk, and a price painted from yesterday's copy
 * looks like an answer. Until then (or if the read fails) the lines keep their placeholder bars
 * and no coupon can be checked.
 */
export function useFreshBooking(bookingId: string): BookingDetail | undefined {
  const [mountedAt] = useState(() => Date.now());
  const { data, dataUpdatedAt } = useQuery({
    queryKey: bookingsKeys.detail(bookingId),
    queryFn: () => bookingsDataSource.getBooking(bookingId),
    staleTime: 0,
    refetchOnMount: 'always',
  });
  return data && dataUpdatedAt >= mountedAt ? data : undefined;
}
