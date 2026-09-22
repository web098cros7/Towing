import type {
  BookingMessage,
  DriverJob,
  JobOfferEvent,
  JobRevokedEvent,
} from '@towing/api-contracts';
import { queryClient } from '@/providers/queryClient';
import { offersKeys } from '../api/offers.keys';
import type { JobOffer } from '../types';

/**
 * The `/driver` socket's job frames, applied to the query cache.
 *
 * MODULE FUNCTIONS RATHER THAN CALLBACKS FROM A COMPONENT, and that matters
 * here more than it looks. The socket is connected inside `usePresence`, which
 * lives on the home screen; handlers closed over that component's render would
 * keep working only for as long as it stayed mounted, and an offer arriving
 * while the driver was reading their earnings would land in a closure nobody was
 * listening to. Nothing below touches React.
 *
 * The cache is the single meeting point for the socket, the §19.2 poll and the
 * push tap — so the takeover gate watches one thing and cannot be shown twice
 * for the same offer by two different deliveries.
 */

export function applyJobOffer(offer: JobOfferEvent): void {
  const existing = queryClient.getQueryData<JobOffer | null>(offersKeys.current());
  // Idempotent: the socket frame and the poll routinely deliver the same offer
  // within a second of each other, and re-setting it would restart the ring.
  if (existing?.bookingId === offer.bookingId) return;

  queryClient.setQueryData<JobOffer | null>(offersKeys.current(), offer);
}

export function applyJobRevoked(event: JobRevokedEvent): void {
  queryClient.setQueryData<JobOffer | null>(offersKeys.current(), (previous) =>
    // Only the offer that was revoked. A late frame for a booking the driver
    // already declined must not clear the NEXT offer out from under them.
    previous && previous.bookingId === event.bookingId ? null : (previous ?? null),
  );

  // A13: a job taken away from the other side — a customer cancel emits
  // `job:revoked` with `cancelled` to the holder (M0-F6; admin reassign will
  // wire the same job in W8) — must leave the driver's screen, not linger
  // until something else refetches. Scoped to the held booking: a revoked
  // offer for a searching booking the driver never held must not evict their
  // active job.
  if (event.reason === 'cancelled') {
    const held = queryClient.getQueryData<DriverJob | null>(offersKeys.job());
    if (held?.bookingId === event.bookingId) {
      void queryClient.invalidateQueries({ queryKey: offersKeys.job() });
    }
  }
}

/**
 * A `chat:message` frame, merged into the transcript for its booking.
 *
 * ONLY IF THE QUERY EXISTS. A frame for a booking whose chat screen was never
 * opened — or was closed — must not create a cache entry: the next open would
 * then render a one-message transcript that the GET is about to overwrite
 * anyway, and the merge would have been pointless work. `getQueryData` returning
 * `undefined` is the signal that nobody is listening.
 *
 * THE ID CHECK IS THE WHOLE POINT. The driver's own send writes the message into
 * the cache from the POST response, and the socket echoes it back a moment
 * later; without the check the driver would see their own line twice.
 */
export function applyChatMessage(message: BookingMessage): void {
  const key = offersKeys.messages(message.bookingId);
  const existing = queryClient.getQueryData<BookingMessage[]>(key);
  if (!existing) return;
  if (existing.some((m) => m.id === message.id)) return;

  queryClient.setQueryData<BookingMessage[]>(key, [...existing, message]);
}
