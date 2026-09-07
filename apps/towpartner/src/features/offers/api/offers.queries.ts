import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { DriverJob, JobReject, JobUnableReason } from '@towing/api-contracts';
import { useDriverStatusStore } from '@/features/dashboard/store/driverStatusStore';
import { track } from '@/lib/analytics/analytics';
import { offersDataSource } from './offersDataSource';
import { offersKeys } from './offers.keys';

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
export function useCurrentJob() {
  return useQuery({
    queryKey: offersKeys.job(),
    queryFn: () => offersDataSource.getCurrentJob(),
    refetchOnWindowFocus: true,
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
    onSuccess: () => {
      queryClient.setQueryData(offersKeys.job(), null);
      // The driver is available again, so an offer may already be waiting.
      void queryClient.invalidateQueries({ queryKey: offersKeys.current() });
    },
  });
}
