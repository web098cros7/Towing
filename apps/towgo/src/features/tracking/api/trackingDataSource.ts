import type {
  BookingShareResponse,
  BookingTracking,
  CallContact,
  CancellationQuote,
} from '@towing/api-contracts';
import { env } from '@/lib/env';
import { trackingMockSource } from './trackingMockSource';
import { trackingRestSource } from './trackingRestSource';

/**
 * §9.1.7's live tracking, §11.7's share link, §3.5's fee preview and §9.2.3's
 * call button — the four things the rebuilt TrackingScreen needs that no
 * existing feature owns.
 *
 * A SEPARATE FEATURE FROM `bookings/`, on the split that already exists in this
 * app between `features/booking/` (composing a request) and `features/bookings/`
 * (the booking resource). Tracking is a third thing: a live view of a booking
 * that is already in flight, polled at a different cadence, invalidated by a
 * socket, and gone the moment the trip ends.
 */
export interface TrackingDataSource {
  /** §19.2's polling rung. Carries exactly what the `/customer` socket pushes. */
  getTracking(bookingId: string): Promise<BookingTracking>;
  /** §11.7 — mints, or returns the live link. Idempotent server-side. */
  share(bookingId: string): Promise<BookingShareResponse>;
  revokeShare(bookingId: string): Promise<void>;
  /** §9.1.7's "shows fee before confirming". */
  cancellationQuote(bookingId: string): Promise<CancellationQuote>;
  /** §9.1.7's call button. `masked: false` means the app MUST warn first. */
  contact(bookingId: string): Promise<CallContact>;
}

export const trackingDataSource: TrackingDataSource = env.useMocks
  ? trackingMockSource
  : trackingRestSource;
