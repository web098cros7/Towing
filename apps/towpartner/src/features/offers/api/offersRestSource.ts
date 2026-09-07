import type {
  CallContact,
  CurrentJobResponse,
  CurrentOfferResponse,
  DriverJob,
  JobAcceptResponse,
  JobReject,
  JobTransitionResponse,
  JobUnable,
  JobUnableResponse,
} from '@towing/api-contracts';
import { apiFetch } from '@/lib/api/client';
import type { JobOffer } from '../types';
import type { OffersDataSource } from './offersDataSource';

export const offersRestSource: OffersDataSource = {
  async getCurrentOffer(): Promise<JobOffer | null> {
    const { offer } = await apiFetch<CurrentOfferResponse>('driver/offers/current');
    return offer;
  },

  async getCurrentJob(): Promise<DriverJob | null> {
    const { job } = await apiFetch<CurrentJobResponse>('driver/jobs/current');
    return job;
  },

  /**
   * NO `Idempotency-Key`, and NOT enqueued on failure.
   *
   * The offer already has a stronger mechanism: a double tap finds its
   * `dispatch_attempts` row no longer `offered` and takes the same graceful 409
   * a losing racer does, which is the correct answer to "did my first tap work?"
   * either way. And a queued accept replayed on reconnect would be accepting a
   * job that expired minutes ago — the one mutation that must NOT survive being
   * offline.
   */
  async accept(bookingId: string): Promise<DriverJob> {
    const { job } = await apiFetch<JobAcceptResponse>(`jobs/${bookingId}/accept`, {
      method: 'POST',
    });
    return job;
  },

  async reject(bookingId: string, body: JobReject = {}): Promise<void> {
    await apiFetch<void>(`jobs/${bookingId}/reject`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },

  /**
   * §5.2's chain (Phase 18).
   *
   * NONE OF THEM CARRY AN `Idempotency-Key`, and none is `enqueueOnFailure`.
   * The reasoning is the accept's, applied one question at a time:
   *
   *  · A key would replay a cached 200 for the SAME key and do nothing for a
   *    genuine double-tap, which sends two. The state machine's `FOR UPDATE` plus
   *    its legal-transition guard already answers the second tap with a graceful
   *    409, which is the correct answer to "did my first tap work?" either way.
   *  · Queueing them for replay on reconnect would be worse than the accept's
   *    case, not better. "Would this be wrong if it landed four minutes later?"
   *    is yes for every one of them: a `complete` replayed after the driver has
   *    already completed it on another device, an `arrived` replayed after the
   *    trip started, an `unable` replayed after the booking was re-dispatched to
   *    somebody else. The driver retries by tapping again, on a screen that is
   *    showing them the current truth.
   */
  async arrived(bookingId: string): Promise<DriverJob> {
    const { job } = await apiFetch<JobTransitionResponse>(`jobs/${bookingId}/arrived`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
    return job;
  },

  async start(bookingId: string, otp: string): Promise<DriverJob> {
    const { job } = await apiFetch<JobTransitionResponse>(`jobs/${bookingId}/start`, {
      method: 'POST',
      body: JSON.stringify({ otp }),
    });
    return job;
  },

  async complete(bookingId: string): Promise<DriverJob> {
    const { job } = await apiFetch<JobTransitionResponse>(`jobs/${bookingId}/complete`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
    return job;
  },

  async unable(bookingId: string, body: JobUnable): Promise<JobUnableResponse> {
    return apiFetch<JobUnableResponse>(`jobs/${bookingId}/unable`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },

  async contact(bookingId: string): Promise<CallContact> {
    return apiFetch<CallContact>(`jobs/${bookingId}/contact`);
  },
};
