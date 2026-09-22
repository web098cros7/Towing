import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  BookingMessage,
  DriverJob,
  JobReject,
  JobUnableReason,
  RatingDto,
  RatingSubmit,
} from '@towing/api-contracts';
import { useDriverStatusStore } from '@/features/dashboard/store/driverStatusStore';
import { track } from '@/lib/analytics/analytics';
import { offersDataSource } from './offersDataSource';
import { offersKeys } from './offers.keys';
import { markJobEnded } from '../store/jobEndedStore';

/**
 * §6.3's twenty-second window has to survive a dropped socket.
 *
 * THE POLL IS THE §19.2 FALLBACK RUNG, not the primary path — the socket frame
 * and the high-priority push are. It runs only while the driver is ONLINE,
 * because that is the only state in which an offer can exist: polling an idle
 * handset every eight seconds would burn battery to learn `null` forever.
 *
 * Eight seconds against a twenty-second offer means a driver on the fallback
 * rung still sees a typical offer with about ten seconds left — tight, and
 * honestly so. It is a degraded rung, not a replacement.
 */
const OFFER_POLL_MS = 8_000;

/**
 * The current incoming tow request, if any (§6.3, Figma driver "New Job").
 *
 * `enabled` exists for ONE caller: the takeover gate sits above the navigator,
 * so it is mounted while the driver is still on the phone-entry screen or stuck
 * in the KYC wizard — states in which this route would 401 or 403 on a loop. The
 * screens that render an offer are all behind the approval gate already and pass
 * nothing.
 */
export function useCurrentOffer(options?: { enabled?: boolean }) {
  const isOnline = useDriverStatusStore((s) => s.isOnline);
  return useQuery({
    queryKey: offersKeys.current(),
    queryFn: () => offersDataSource.getCurrentOffer(),
    enabled: options?.enabled ?? true,
    refetchInterval: isOnline ? OFFER_POLL_MS : false,
    // An offer is worthless the moment it is stale — never serve a cached one
    // from a previous foreground.
    staleTime: 0,
    refetchOnWindowFocus: true,
  });
}

/**
 * The job the driver holds, from `GET /v1/driver/jobs/current`.
 *
 * The authority on "am I on a job", ahead of anything the accept response left
 * in the cache: a job can also end from the other side (a customer cancels, an
 * admin reassigns) and the driver's phone learns that here.
 */
const JOB_POLL_MS = 15_000;

/**
 * The statuses in which a held job is still alive. `useCompleteJob`
 * deliberately caches the COMPLETED job so the net-pay screen can render —
 * and because that data is non-null, an unguarded "poll while held" check
 * would keep polling, get `null` back from the ACTIVE-scoped endpoint, and
 * flip the completion screen to "No active job" fifteen seconds later.
 */
const ACTIVE_JOB_STATUSES: ReadonlySet<string> = new Set([
  'assigned',
  'en_route',
  'arrived',
  'in_progress',
]);

/**
 * One held/finished job by id, from `GET /v1/driver/job-history/:id`.
 *
 * THE DURABLE HALF FOR THE PAYMENT CARD. The `job:payment` frame is the fast
 * half and can be missed — a backgrounded app, a dropped connection, a choice
 * made while the screen was not mounted — so the card refetches on an interval
 * while the payment is still outstanding. `poll` is false once the payment is
 * `paid`, because there is nothing left to learn.
 */
const JOB_DETAIL_POLL_MS = 5_000;

export function useJobDetail(bookingId: string | undefined, options?: { poll?: boolean }) {
  return useQuery({
    queryKey: offersKeys.detail(bookingId ?? ''),
    queryFn: () => offersDataSource.getJob(bookingId!),
    enabled: !!bookingId,
    // Stops by itself once the fetched payment is `paid`, even if the caller's
    // copy of the job has not caught up yet.
    refetchInterval: (query) =>
      options?.poll && query.state.data?.payment.status !== 'paid' ? JOB_DETAIL_POLL_MS : false,
  });
}

export function useCurrentJob() {
  return useQuery({
    queryKey: offersKeys.job(),
    queryFn: () => offersDataSource.getCurrentJob(),
    refetchOnWindowFocus: true,
    // A13: the §19.2 fallback rung for a job taken away — a missed
    // `job:revoked` still resolves within fifteen seconds. Only while a job
    // is held: polling an idle handset would burn battery to learn `null`,
    // the same reason the offer poll is gated on online state above.
    // M0-F5: "held" means an ACTIVE status, not merely non-null data — the
    // completion screen's cached `completed` job must not poll.
    refetchInterval: (query) => {
      const job = query.state.data;
      return job && ACTIVE_JOB_STATUSES.has(job.status) ? JOB_POLL_MS : false;
    },
  });
}

/**
 * Accept.
 *
 * NO OPTIMISTIC UPDATE, deliberately. The server's accept is a four-check
 * transaction and losing it is an ordinary outcome, not an edge case — another
 * driver taking the booking first is exactly what a progressive-radius search
 * with three concurrent offers per wave produces. Showing an assigned job and
 * then snatching it back would be worse than the half-second wait.
 */
export function useAcceptOffer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (bookingId: string) => offersDataSource.accept(bookingId),
    onSuccess: (job: DriverJob) => {
      queryClient.setQueryData(offersKeys.job(), job);
      // The offer is spent either way — it is now a job.
      queryClient.setQueryData(offersKeys.current(), null);
    },
    onError: () => {
      // A 409 means somebody else has it, so the offer is gone too. Refetch
      // rather than assume: the server may already be offering a NEW booking.
      void queryClient.invalidateQueries({ queryKey: offersKeys.current() });
    },
  });
}

/**
 * Decline.
 *
 * FIRE AND FORGET FROM THE UI'S POINT OF VIEW — the cache is cleared before the
 * request resolves. A driver who declined has moved on, and a decline that fails
 * on the wire still expires server-side twenty seconds later; making them watch
 * a spinner to find that out would be the one thing worse than the extra wait.
 */
export function useRejectOffer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ bookingId, reason }: { bookingId: string; reason?: string }) =>
      offersDataSource.reject(bookingId, (reason ? { reason } : {}) as JobReject),
    onMutate: () => {
      queryClient.setQueryData(offersKeys.current(), null);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: offersKeys.current() });
    },
  });
}

/**
 * §5.2's execution chain (Phase 18).
 *
 * ALL FOUR SHARE ONE `onSuccess`: write the returned job into `offersKeys.job()`.
 * The server answers every transition with the whole `DriverJob` precisely so the
 * screen can re-render against the server's view without a refetch — waiting
 * charges start accruing at `arrived`, the navigation target flips at `start`,
 * and the earnings become final at `complete`. Patching a status string instead
 * would leave the rest of the object describing the previous step.
 *
 * NO OPTIMISTIC UPDATES. Each of these can legitimately fail — a wrong OTP, a
 * proximity refusal, a job taken away by an admin — and showing the next state
 * before the server agrees would mean rolling a driver backwards at the kerbside.
 * The accept mutation made the same call for the same reason.
 */
export function useArriveAtJob() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (bookingId: string) => offersDataSource.arrived(bookingId),
    onSuccess: (job: DriverJob) => queryClient.setQueryData(offersKeys.job(), job),
  });
}

export function useStartJob() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ bookingId, otp }: { bookingId: string; otp: string }) =>
      offersDataSource.start(bookingId, otp),
    onSuccess: (job: DriverJob) => {
      queryClient.setQueryData(offersKeys.job(), job);
      // §22.1. Emitted here rather than in the screen because the OTP gate can
      // fail several times before it passes, and only the pass is a job start.
      track('job_started');
    },
  });
}

export function useCompleteJob() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (bookingId: string) => offersDataSource.complete(bookingId),
    onSuccess: (job: DriverJob) => {
      // The completed job, not null: §9.2.3's completion screen renders the
      // final gross → commission → net from it. `GET /driver/jobs/current` is
      // scoped to ACTIVE statuses and would return null, so a refetch here would
      // erase the screen the driver is looking at.
      queryClient.setQueryData(offersKeys.job(), job);
      track('job_completed');
    },
  });
}

/**
 * §9.2.3's unable-to-deliver.
 *
 * CLEARS THE JOB RATHER THAN STORING ONE. The booking has gone back to §6.5's
 * search and belongs to nobody; leaving the last job in the cache would show a
 * driver an active job they are no longer on, and let them tap Complete on it.
 */
export function useUnableToDeliver() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ bookingId, reason, note }: { bookingId: string; reason: JobUnableReason; note?: string }) =>
      offersDataSource.unable(bookingId, { reason, ...(note ? { note } : {}) }),
    onSuccess: (_result, { bookingId }) => {
      // Named before the job is cleared, so the job screen says the driver
      // ended it rather than reading the empty cache as "taken away".
      markJobEnded({ bookingId, reason: 'unable' });
      queryClient.setQueryData(offersKeys.job(), null);
      // The driver is available again, so an offer may already be waiting.
      void queryClient.invalidateQueries({ queryKey: offersKeys.current() });
    },
  });
}

/**
 * Trip chat (Phase 20).
 *
 * THE POLL IS THE DURABLE HALF. The socket frame is the fast path and can be
 * missed — a backgrounded app, a dropped connection, a message sent while the
 * screen was not mounted — so the transcript is refetched on an interval and the
 * socket only makes it feel instant. Five seconds is the same order as the job
 * poll and is what makes a missed frame a five-second delay rather than a
 * message the driver never sees.
 *
 * The GET also marks the customer's messages read server-side, which is why it
 * is not cached across mounts: opening the screen is the read receipt.
 */
const MESSAGES_POLL_MS = 5_000;

export function useJobMessages(bookingId: string) {
  return useQuery({
    queryKey: offersKeys.messages(bookingId),
    queryFn: () => offersDataSource.messages(bookingId),
    refetchInterval: MESSAGES_POLL_MS,
    refetchOnWindowFocus: true,
  });
}

/**
 * Sends one message.
 *
 * THE CACHE IS APPENDED TO ON SUCCESS, not invalidated. The POST returns the
 * created `BookingMessage`, so writing it in is exact — and it means the
 * driver's own line appears the instant the server accepts it rather than on the
 * next five-second poll. The id check is what stops the socket frame that
 * arrives a moment later from duplicating it.
 */
export function useSendJobMessage(bookingId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: string) => offersDataSource.sendMessage(bookingId, body),
    onSuccess: (message: BookingMessage) => {
      queryClient.setQueryData<BookingMessage[]>(offersKeys.messages(bookingId), (previous) => {
        const list = previous ?? [];
        if (list.some((m) => m.id === message.id)) return list;
        return [...list, message];
      });
    },
  });
}

/**
 * §9.2.4's cash-collected confirmation.
 *
 * PATCHES THE CACHED JOB RATHER THAN CLEARING IT. The booking is now `paid`, but
 * the driver is still looking at the completed card — clearing the job would
 * flip the screen to "No active job" the instant the cash was recorded, which is
 * the one moment the driver wants to see "Paid". The card shows the paid state
 * and the driver leaves with Done.
 */
export function useCashCollected() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (bookingId: string) => offersDataSource.cashCollected(bookingId),
    onSuccess: (_result, bookingId) => {
      queryClient.setQueryData<DriverJob | null>(offersKeys.job(), (previous) =>
        previous && previous.bookingId === bookingId
          ? {
              ...previous,
              status: 'paid',
              payment: { ...previous.payment, method: 'cash', status: 'paid' },
            }
          : previous,
      );
      queryClient.setQueryData<DriverJob>(offersKeys.detail(bookingId), (previous) =>
        previous
          ? {
              ...previous,
              status: 'paid',
              payment: { ...previous.payment, method: 'cash', status: 'paid' },
            }
          : previous,
      );
    },
  });
}

/**
 * Rating the customer.
 *
 * THE DRIVER'S RATING IS AN OPS SIGNAL, NOT A PUBLIC SCORE. The server's
 * `recomputeDriverRating` rolls up only the customer→driver direction, so what
 * the driver writes here never reaches the customer's profile — it goes to
 * MiTow's ops team. The sheet says so in as many words, because a driver who
 * believes the rating is public rates differently from one who knows it is a
 * private note.
 *
 * OPT-IN, NEVER AUTOMATIC. The customer app opens its rating sheet by itself on
 * the payment-success screen; the driver's equivalent card is read at a kerbside
 * with the next job waiting, so nothing may slide over it uninvited. The rail
 * renders a button and the driver taps it if they want to.
 */

/** Whether this driver has already rated this booking's customer. */
export function useCustomerRatingState(bookingId: string | undefined) {
  return useQuery({
    queryKey: offersKeys.rating(bookingId!),
    queryFn: () => offersDataSource.customerRating(bookingId!),
    enabled: !!bookingId,
  });
}

/**
 * Rate the customer.
 *
 * UPSERTS, SO A RETRY IS SAFE — the endpoint amends rather than duplicating, so
 * `retry: false` is about not hammering a 409 (the booking is not yet
 * `completed`/`paid`) rather than about duplicate protection. On success the
 * cache is written directly from the returned `RatingDto` so the rail's button
 * flips to "You rated N★ · Change" without a refetch.
 */
export function useRateCustomer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ bookingId, body }: { bookingId: string; body: RatingSubmit }) =>
      offersDataSource.rateCustomer(bookingId, body),
    retry: false,
    onSuccess: (data: RatingDto) => {
      queryClient.setQueryData(offersKeys.rating(data.bookingId), {
        mine: data,
        canRate: true,
      });
    },
  });
}
