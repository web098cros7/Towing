import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { BookingTracking } from '@towing/api-contracts';
import { trackingDataSource } from '@/features/tracking/api/trackingDataSource';
import { trackingKeys } from '@/features/tracking/api/tracking.keys';

/**
 * The tracking payload for Booking Details: the driver, the vehicle, the ETA and
 * the timeline instants. `GET /v1/bookings/:id` carries none of those.
 *
 * THE SAME CACHE ENTRY AS `useTracking` (`trackingKeys.live`), so 18 underneath
 * and this screen read one payload. It differs in one way: it polls every 10 s
 * only while the booking is live, and reads once for a finished booking, which
 * `useTracking` cannot do (it polls whenever it is enabled).
 */
export function useBookingTracking(bookingId: string, enabled: boolean, live: boolean) {
  return useQuery({
    queryKey: trackingKeys.live(bookingId),
    queryFn: () => trackingDataSource.getTracking(bookingId),
    enabled,
    refetchInterval: enabled && live ? 10_000 : false,
    staleTime: 0,
  });
}

/**
 * The minute count behind "Arriving in 5 mins" (status card) and "…reach you in
 * about 5 mins." (21's body). ONE count for both, so 20 and 21 always agree.
 *
 * Exactly 18's heading rule (`LiveEtaCard`): the server's `etaSeconds`, ticked down
 * every second between polls and re-seeded on every new server value; a later
 * `null` keeps the last known count. The design draws only the plural and no
 * "arriving now", so the count floors at 1 and stays "mins". `null` until an ETA
 * is known.
 */
export function useEtaMinutes(tracking: BookingTracking | undefined): number | null {
  const etaSeconds = tracking?.etaSeconds ?? null;
  const [remaining, setRemaining] = useState<number | null>(etaSeconds);

  useEffect(() => {
    if (etaSeconds !== null) setRemaining(etaSeconds);
  }, [etaSeconds, tracking?.at]);

  const counting = remaining !== null;
  useEffect(() => {
    if (!counting) return;
    const timer = setInterval(() => {
      setRemaining((previous) => (previous === null ? null : Math.max(0, previous - 1)));
    }, 1_000);
    return () => clearInterval(timer);
  }, [counting]);

  return remaining === null ? null : Math.max(1, Math.round(remaining / 60));
}
