import { useQuery } from '@tanstack/react-query';
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
 * about 5 mins." (21's body).
 *
 * Re-exported, not defined here: three copies of this count had drifted apart —
 * this one and `LiveEtaCard`'s had no leg reset at all, and `TripStatusStrip`'s
 * re-seeded from the outgoing leg's payload. One hook now, in the tracking
 * feature it belongs to.
 */
export { useEtaMinutes } from '@/features/tracking/hooks/useEtaMinutes';
