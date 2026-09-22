import type {
  BookingMessage,
  DriverJob,
  JobOfferEvent,
  JobPaymentEvent,
  JobRevokedEvent,
} from '@towing/api-contracts';
import { queryClient } from '@/providers/queryClient';
import { offersKeys } from '../api/offers.keys';
import { markJobEnded } from '../store/jobEndedStore';
import { markChatUnread } from '../store/chatUnreadStore';
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
  //
  // The three reasons that mean "you no longer hold this job" are handled by
  // SETTING the held job to null rather than invalidating it: an invalidation
  // leaves the stale job on screen until the refetch lands, and the driver
  // would keep reading an address for a job that is already gone. The ended
  // store records WHY, so the job screen can say so instead of falling back to
  // a generic empty state. `offersKeys.current()` is invalidated too — the
  // driver is free, and the next offer must not be blocked by a stale one.
  if (
    event.reason === 'cancelled' ||
    event.reason === 'reassigned' ||
    event.reason === 'fleet_suspended'
  ) {
    const held = queryClient.getQueryData<DriverJob | null>(offersKeys.job());
    if (held?.bookingId === event.bookingId) {
      markJobEnded({ bookingId: event.bookingId, reason: event.reason });
      queryClient.setQueryData<DriverJob | null>(offersKeys.job(), null);
      void queryClient.invalidateQueries({ queryKey: offersKeys.current() });
    }
  }
}

/**
 * A `chat:message` frame, merged into the transcript for its booking.
 *
 * THE UNREAD MARK COMES FIRST, AND BEFORE THE "ONLY IF THE QUERY EXISTS"
 * RETURN. A customer message that arrives while the chat screen is closed has
 * no cache entry to merge into — that is the whole point of the early return —
 * but it is exactly the message the driver needs a badge for. The store
 * ignores the mark when the chat is open, so a frame for the screen the driver
 * is reading is a no-op and the badge does not flicker on and off.
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
  if (message.senderType === 'customer') {
    markChatUnread(message.bookingId);
  }

  const key = offersKeys.messages(message.bookingId);
  const existing = queryClient.getQueryData<BookingMessage[]>(key);
  if (!existing) return;
  if (existing.some((m) => m.id === message.id)) return;

  queryClient.setQueryData<BookingMessage[]>(key, [...existing, message]);
}

/**
 * A `job:payment` frame, patched into the cached job and its detail entry.
 *
 * NEVER CREATES CACHE ENTRIES. The frame is the fast half of the pair — the
 * durable half is `useJobDetail`'s poll — so a frame for a booking whose detail
 * query was never opened must not seed one: the next open would then render a
 * partial object the GET is about to overwrite anyway.
 */
export function applyJobPayment(event: JobPaymentEvent): void {
  const held = queryClient.getQueryData<DriverJob | null>(offersKeys.job());
  if (held && held.bookingId === event.bookingId) {
    const patched: DriverJob = { ...held, payment: event.payment };
    queryClient.setQueryData(offersKeys.job(), patched);
  }

  const detailKey = offersKeys.detail(event.bookingId);
  const detail = queryClient.getQueryData<DriverJob>(detailKey);
  if (detail) {
    queryClient.setQueryData(detailKey, { ...detail, payment: event.payment });
  }
}
