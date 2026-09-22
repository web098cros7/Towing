import type {
  BookingMessage,
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

  /**
   * Trip chat (Phase 20).
   *
   * The GET is the durable half of the pair: the socket frame is the fast path
   * and can be missed, so the screen refetches on an interval and this route is
   * what makes the transcript eventually correct. Reading it also marks the
   * customer's messages read server-side, which is why it is not cached.
   */
  async messages(bookingId: string): Promise<BookingMessage[]> {
    const { items } = await apiFetch<{ items: BookingMessage[] }>(`jobs/${bookingId}/messages`);
    return items;
  },

  /**
   * Sends one message.
   *
   * `Idempotency-Key` IS CARRIED HERE, unlike the §5.2 chain above, and the
   * difference is the point: a chat message is not a state transition, so a
   * double-tap that sends two identical lines is a bug rather than a graceful
   * 409. The key makes the second tap a no-op on the server, which is what the
   * driver meant by it.
   */
  async sendMessage(bookingId: string, body: string): Promise<BookingMessage> {
    return apiFetch<BookingMessage>(`jobs/${bookingId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ body }),
      idempotent: true,
    });
  },

  /**
   * §9.2.4's cash-collected confirmation.
   *
   * 200 means the booking is now `paid`; 409 means the customer chose to pay in
   * the app and the driver should not be collecting anything. The screen turns
   * that 409 into a specific message rather than a generic failure — it is a
   * correct answer, not an error.
   */
  async cashCollected(bookingId: string): Promise<{ bookingId: string; bookingStatus: string }> {
    return apiFetch<{ bookingId: string; bookingStatus: string }>(
      `jobs/${bookingId}/cash-collected`,
      {
        method: 'POST',
        body: JSON.stringify({}),
        idempotent: true,
      },
    );
  },
};
