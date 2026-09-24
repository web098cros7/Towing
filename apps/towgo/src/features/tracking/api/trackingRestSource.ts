import type {
  BookingShareResponse,
  BookingTracking,
  CallContact,
  CancellationQuote,
} from '@towing/api-contracts';
import { apiFetch } from '@/lib/api/client';
import type { BookingTrackingDisplay } from '@/screens/booking/tracking/trackingDisplay';
import type { TrackingDataSource } from './trackingDataSource';

export const trackingRestSource: TrackingDataSource = {
  async getTracking(bookingId: string): Promise<BookingTrackingDisplay> {
    // `inTransitAt` is on the wire: the server records the loaded truck leaving
    // the pickup. Null while loading, so 25's "In transit" time waits for it.
    return apiFetch<BookingTracking>(`bookings/${bookingId}/tracking`);
  },

  /**
   * No `idempotent: true`, and no explicit key either.
   *
   * The server already answers a second tap with the LIVE token rather than
   * minting a new one, which is a stronger guarantee than a replay cache: it
   * holds for an accidental double-tap and a genuine retry alike, and it is what
   * stops a second tap silently killing the page somebody is already watching.
   * Layering a key on top would add a cache and change nothing.
   */
  share: (bookingId: string): Promise<BookingShareResponse> =>
    apiFetch<BookingShareResponse>(`bookings/${bookingId}/share`, { method: 'POST' }),

  revokeShare: (bookingId: string): Promise<void> =>
    apiFetch<void>(`bookings/${bookingId}/share`, { method: 'DELETE' }),

  cancellationQuote: (bookingId: string): Promise<CancellationQuote> =>
    apiFetch<CancellationQuote>(`bookings/${bookingId}/cancellation-quote`),

  contact: (bookingId: string): Promise<CallContact> =>
    apiFetch<CallContact>(`bookings/${bookingId}/contact`),
};
