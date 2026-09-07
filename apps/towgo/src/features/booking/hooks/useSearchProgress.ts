import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { bookingsKeys } from '@/features/bookings/api/bookings.keys';
import {
  bookingSocketEnabled,
  connectBookingSocket,
  disconnectBookingSocket,
} from '@/lib/realtime/bookingSocket';

/**
 * §9.1.6's live search state.
 *
 * TWO CHANNELS, ONE SHAPE. The socket pushes `search:progress` the instant a
 * wave advances; `GET /bookings/:id` carries the same wave, radius and count on
 * its ten-second poll (§19.2). This hook prefers whichever is FRESHER rather
 * than picking a winner, so a customer on a working socket sees every wave and
 * a customer whose socket never connected still sees real progress — and
 * neither is ever shown invented progress, which is the acceptance criterion.
 *
 * THE OLD `useSearchSimulation` LIVED HERE. It was a `setTimeout` ladder that
 * pretended to contact drivers and produced a match after 6.5 seconds for a
 * booking that had never been created; Phase 15 deleted it and left the screen
 * honestly saying "searching" forever. This is what finally replaces it.
 */

export interface SearchProgress {
  wave: number;
  radiusKm: number;
  driversContacted: number;
  deadlineAt: string | null;
}

/**
 * Takes the POLLED search block rather than the whole booking.
 *
 * The hook reads exactly one field, and depending on the full `BookingDetail`
 * would tie it to TowGo's local booking type — which is a different (nullable)
 * shape from the contract's. One narrow parameter keeps it usable from either.
 */
export function useSearchProgress(
  bookingId: string,
  polled: SearchProgress | null | undefined,
): SearchProgress | null {
  const queryClient = useQueryClient();
  const [live, setLive] = useState<SearchProgress | null>(null);

  useEffect(() => {
    if (!bookingSocketEnabled) return;

    void connectBookingSocket(bookingId, {
      onSearchProgress: (progress) => {
        setLive({
          wave: progress.wave,
          radiusKm: progress.radiusKm,
          driversContacted: progress.driversContacted,
          deadlineAt: progress.deadlineAt,
        });
      },
      onBookingStatus: () => {
        /**
         * INVALIDATE RATHER THAN PATCH. The status frame carries only the new
         * status, and the screen needs the whole booking to hand off to
         * tracking — the driver, the OTP availability, the assignment time.
         * Writing the status into the cache alone would leave the rest of the
         * object describing a search that has ended.
         */
        void queryClient.invalidateQueries({ queryKey: bookingsKeys.detail(bookingId) });
      },
      /**
       * Both no-ops HERE, and that is correct rather than lazy: the search
       * screen has no driver to place and no arrival to estimate. The socket is
       * a shared singleton whose handler set is replaced per screen, so the
       * tracking screen supplies real implementations when it takes over —
       * see `useLiveTracking`.
       */
      onLocationUpdate: () => undefined,
      onEtaUpdate: () => undefined,
      /**
       * §18's resync. Phase 17 had no equivalent, so a search screen whose
       * socket connected late showed whatever the initial fetch had until the
       * next wave — up to twenty seconds of a stale radius.
       */
      onResync: () => {
        void queryClient.invalidateQueries({ queryKey: bookingsKeys.detail(bookingId) });
      },
    });

    return () => disconnectBookingSocket();
  }, [bookingId, queryClient]);

  if (!polled && !live) return null;
  if (!live) return polled ?? null;
  if (!polled) return live;

  // Whichever is further along. A poll that started before the last socket
  // frame would otherwise show the search going backwards a wave.
  return polled.wave > live.wave ? polled : live;
}
