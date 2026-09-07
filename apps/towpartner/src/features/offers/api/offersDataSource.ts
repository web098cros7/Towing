import type {
  CallContact,
  DriverJob,
  JobReject,
  JobUnable,
  JobUnableResponse,
} from '@towing/api-contracts';
import { env } from '@/lib/env';
import type { JobOffer } from '../types';
import { offersMockSource } from './offersMockSource';
import { offersRestSource } from './offersRestSource';

/**
 * §6.3's offer surface.
 *
 * Phase 17 gave this its REST half. `getCurrentOffer` was mock-only and its own
 * header said "a realtime (Socket.io) source swaps in later" — it did, and the
 * socket sits BESIDE this rather than replacing it: a frame is not a durable
 * delivery, so a driver whose connection dropped inside the twenty-second window
 * resyncs through this route (§19.2).
 */
export interface OffersDataSource {
  /** `null` means no request is currently pending. */
  getCurrentOffer(): Promise<JobOffer | null>;
  /** `null` when the driver is idle. */
  getCurrentJob(): Promise<DriverJob | null>;
  accept(bookingId: string): Promise<DriverJob>;
  reject(bookingId: string, body?: JobReject): Promise<void>;

  // --- §5.2's execution chain (Phase 18) ----------------------------------
  // Deliberately on THIS source rather than a new one. They act on the same
  // object `getCurrentJob` returns and write the same cache key; a second data
  // source would mean two places that can disagree about what the driver holds.

  /** §5.2's `arrived`. Arms §7.4's waiting grace. */
  arrived(bookingId: string): Promise<DriverJob>;
  /** §9.2.3's OTP gate. The code is the customer's; the driver types it. */
  start(bookingId: string, otp: string): Promise<DriverJob>;
  /** §5.2's `completed`. Finalizes the fare including waiting charges. */
  complete(bookingId: string): Promise<DriverJob>;
  /** §9.2.3's unable-to-deliver. Returns the booking to §6.5's search. */
  unable(bookingId: string, body: JobUnable): Promise<JobUnableResponse>;
  /** §9.2.3's call button, behind `TelephonyPort`. */
  contact(bookingId: string): Promise<CallContact>;
}

export const offersDataSource: OffersDataSource = env.useMocks
  ? offersMockSource
  : offersRestSource;
