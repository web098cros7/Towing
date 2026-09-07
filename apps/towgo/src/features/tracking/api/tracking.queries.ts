import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { BookingTracking } from '@towing/api-contracts';
import { bookingsKeys } from '@/features/bookings/api/bookings.keys';
import { trackingDataSource } from './trackingDataSource';
import { trackingKeys } from './tracking.keys';

/**
 * §19.2's polling rung, and the cache the socket patches into.
 *
 * TEN SECONDS, matching every other §19.2 poll in the app — and it runs even
 * when the socket is up. That is deliberate rather than wasteful: §18's rule is
 * "never trust socket completeness", and a socket that silently stops delivering
 * (a proxy dropping an idle connection, a background OS freeze) looks exactly
 * like a driver who has stopped moving. The poll is what tells those apart.
 *
 * `refetchIntervalInBackground` is left OFF: a backgrounded app cannot render a
 * map, and polling from Doze is exactly the battery drain §11.8 is careful
 * about. The reconnect-and-resync on focus covers the gap.
 */
export function useTracking(bookingId: string, enabled = true) {
  return useQuery({
    queryKey: trackingKeys.live(bookingId),
    queryFn: () => trackingDataSource.getTracking(bookingId),
    enabled,
    refetchInterval: enabled ? 10_000 : false,
    // A tracking payload is stale the moment it lands — it describes where
    // somebody was, not where they are.
    staleTime: 0,
  });
}

/**
 * §11.7's share link.
 *
 * `retry: false`, because a share is a user intent rather than a background
 * read: if it fails the customer should be told and given the button back,
 * not silently retried into a link they no longer want to send.
 */
export function useShareTrip(bookingId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => trackingDataSource.share(bookingId),
    retry: false,
    onSuccess: (share) => {
      queryClient.setQueryData(trackingKeys.share(bookingId), share);
      // `shared` lives on the tracking payload and drives the button's state.
      queryClient.setQueryData<BookingTracking>(trackingKeys.live(bookingId), (previous) =>
        previous ? { ...previous, shared: true } : previous,
      );
    },
  });
}

export function useRevokeShare(bookingId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => trackingDataSource.revokeShare(bookingId),
    retry: false,
    onSuccess: () => {
      queryClient.setQueryData(trackingKeys.share(bookingId), null);
      queryClient.setQueryData<BookingTracking>(trackingKeys.live(bookingId), (previous) =>
        previous ? { ...previous, shared: false } : previous,
      );
    },
  });
}

/**
 * §9.1.7's "shows fee before confirming".
 *
 * FETCHED WHEN THE SHEET OPENS, not with the screen. The quote depends on the
 * clock — §3.5's tiers are 0–2 min, 2–10 min, and beyond — so a value fetched on
 * mount and shown five minutes later would quote the wrong tier at exactly the
 * moment the customer commits to it.
 */
export function useCancellationQuote(bookingId: string, enabled: boolean) {
  return useQuery({
    queryKey: trackingKeys.cancellationQuote(bookingId),
    queryFn: () => trackingDataSource.cancellationQuote(bookingId),
    enabled,
    staleTime: 0,
    gcTime: 0,
  });
}

/**
 * §9.1.7's call button.
 *
 * ON DEMAND, never eagerly. With a masked-calling provider this route BINDS a
 * proxy number out of a finite pool, so fetching it on mount would burn a DID
 * for every customer who opened the tracking screen and never called. Without
 * one it returns a real personal number, which is not a thing to put in a query
 * cache before somebody has asked for it.
 */
export function useContact(bookingId: string, enabled: boolean) {
  return useQuery({
    queryKey: trackingKeys.contact(bookingId),
    queryFn: () => trackingDataSource.contact(bookingId),
    enabled,
    staleTime: 60_000,
  });
}

/**
 * The §18 resync, used by the socket's reconnect loop.
 *
 * INVALIDATES BOTH the tracking payload and the booking detail. A socket that
 * was down may have missed a status change, and status lives on the detail —
 * refetching only the tracking data would leave a customer whose trip has been
 * completed still watching a "driver on the way" header.
 */
export function useTrackingResync(bookingId: string): () => void {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: trackingKeys.live(bookingId) });
    void queryClient.invalidateQueries({ queryKey: bookingsKeys.detail(bookingId) });
  };
}
