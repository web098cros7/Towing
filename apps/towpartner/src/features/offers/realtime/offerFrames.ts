import type { DriverJob, JobOfferEvent, JobRevokedEvent } from '@towing/api-contracts';
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
