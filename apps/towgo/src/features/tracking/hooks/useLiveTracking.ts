import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  PRESENCE_OFFLINE_MS,
  PRESENCE_STALE_MS,
  presenceFor,
  type BookingTracking,
} from '@towing/api-contracts';
import { bookingsKeys } from '@/features/bookings/api/bookings.keys';
import {
  bookingSocketEnabled,
  connectBookingSocket,
  disconnectBookingSocket,
  onBookingSocketState,
  type BookingSocketState,
} from '@/lib/realtime/bookingSocket';
import { trackingKeys } from '../api/tracking.keys';
import { useTracking } from '../api/tracking.queries';

/**
 * §9.1.7's live tracking, assembled: the poll, the socket, and §11.6's honesty
 * states.
 *
 * THE SOCKET PATCHES, THE POLL REPLACES, AND THE SPLIT IS THE POINT.
 *
 *  · `location:update` and `eta:update` are PATCHED into the cached payload with
 *    `setQueryData`. They are single facts about an object the client already
 *    holds, and refetching a whole tracking payload three times a second to
 *    learn a new latitude would defeat the socket entirely.
 *  · `booking:status` INVALIDATES instead. A status change moves several fields
 *    at once — `arrivedAt` appears, the ETA leg flips, the driver card may go —
 *    and patching one of them would leave the rest describing the previous
 *    state. The same call `useSearchProgress` makes, for the same reason.
 *
 * §11.6's thresholds are NEVER redefined here. `PRESENCE_STALE_MS`,
 * `PRESENCE_OFFLINE_MS` and `presenceFor` come from `@towing/api-contracts`, so
 * the customer app, the driver app and the fleet console cannot disagree about
 * when a driver has gone quiet.
 */

export interface LiveTracking {
  tracking: BookingTracking | undefined;
  isLoading: boolean;
  isError: boolean;
  /** §11.6: `live` | `stale` (ghost + "reconnecting…") | `offline` (support banner). */
  presence: 'live' | 'stale' | 'offline';
  /** Age of the last fix in milliseconds, or null when there has never been one. */
  fixAgeMs: number | null;
  /** The socket's own state, for the connection chip. */
  connection: BookingSocketState;
}

export function useLiveTracking(bookingId: string, enabled = true): LiveTracking {
  const queryClient = useQueryClient();
  const query = useTracking(bookingId, enabled);
  const [connection, setConnection] = useState<BookingSocketState>('polling');

  /**
   * A ticking clock, so staleness is recomputed even when nothing arrives.
   *
   * THE WHOLE POINT OF §11.6 IS THE ABSENCE OF DATA. A marker goes ghost because
   * no ping has come for fifteen seconds — which is precisely the case in which
   * nothing re-renders the component. Deriving `presence` from `tracking.at`
   * alone would leave a dead driver looking live forever, because the last render
   * happened while they were still live.
   *
   * One second, because the thresholds are 15 s and 60 s and a second of
   * imprecision at those distances is invisible.
   */
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return;
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [enabled]);

  // Handlers in a ref so the socket effect's dependency list stays empty — the
  // pattern the fleet console's `RealtimeProvider` uses. Without it, every
  // render tears the socket down and mints a fresh ticket.
  const patch = useRef<(next: Partial<BookingTracking>) => void>(() => undefined);
  patch.current = (next) => {
    queryClient.setQueryData<BookingTracking>(trackingKeys.live(bookingId), (previous) =>
      previous ? { ...previous, ...next } : previous,
    );
  };

  useEffect(() => {
    if (!enabled) return;
    const unsubscribe = onBookingSocketState(setConnection);
    return unsubscribe;
  }, [enabled]);

  useEffect(() => {
    if (!enabled || !bookingSocketEnabled) return;

    void connectBookingSocket(bookingId, {
      onSearchProgress: () => undefined,
      onBookingStatus: () => {
        void queryClient.invalidateQueries({ queryKey: trackingKeys.live(bookingId) });
        void queryClient.invalidateQueries({ queryKey: bookingsKeys.detail(bookingId) });
      },
      onLocationUpdate: (position) => {
        patch.current({
          position: {
            lat: position.lat,
            lng: position.lng,
            headingDeg: position.headingDeg,
            speedKph: position.speedKph,
            lowAccuracy: position.lowAccuracy,
            // The PING's timestamp, carried through untouched. Stamping it with
            // arrival time here would make a driver whose phone died look live
            // for as long as the app kept the last frame.
            at: position.at,
          },
        });
      },
      onEtaUpdate: (eta) => {
        patch.current({ etaSeconds: eta.etaSeconds, etaSource: eta.source });
      },
      onResync: () => {
        void queryClient.invalidateQueries({ queryKey: trackingKeys.live(bookingId) });
      },
    });

    return () => disconnectBookingSocket();
  }, [bookingId, enabled, queryClient]);

  const fixAgeMs = useMemo(() => {
    const at = query.data?.position?.at;
    if (!at) return null;
    return Math.max(0, now - Date.parse(at));
  }, [query.data?.position?.at, now]);

  const presence = useMemo(() => {
    const at = query.data?.position?.at;
    // No fix at all is `offline` rather than `live`. A driver who has never
    // pinged is not a driver whose position is fresh — that is the empty-set
    // trap that makes an app confidently draw a marker at (0, 0).
    if (!at) return 'offline' as const;
    return presenceFor(Date.parse(at), now);
  }, [query.data?.position?.at, now]);

  return {
    tracking: query.data,
    isLoading: query.isLoading,
    isError: query.isError,
    presence,
    fixAgeMs,
    connection,
  };
}

/** Re-exported so a screen never reaches past the contract for a threshold. */
export { PRESENCE_OFFLINE_MS, PRESENCE_STALE_MS };
