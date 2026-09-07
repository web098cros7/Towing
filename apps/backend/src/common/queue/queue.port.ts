/**
 * Background-job seam (plan's locked decision: "BullMQ behind a `QueuePort`;
 * Redis already required; SQS/EventBridge becomes an adapter swap on AWS").
 *
 * This port — not the compliance worker or the CSV import that sit on top of it
 * — is the hard prerequisite for Track B Phases 13, 17 and 19:
 *   · 13 needs queue-backed notification fan-out with retries and a DLQ (§12.3).
 *   · 17 needs dispatch offer timers that are DURABLE and SINGLE-OWNER across N
 *     Fargate tasks. In-process `setTimeout` over N tasks double-assigns a
 *     fare-locked booking, which corrupts the ledger rather than degrading UX.
 *   · 19 needs a reconciliation sweep that runs ONCE, not N times against the
 *     same uncaptured payment.
 *
 * Everything here is therefore designed around durability and single-ownership,
 * not around convenience.
 */

export const QUEUE = Symbol('QUEUE');

/**
 * The registry of every background job. Adding an entry here is what makes a
 * job typed end-to-end — `enqueue` will not accept a payload that does not
 * match, and a handler cannot claim the wrong shape.
 *
 * Named `domain.action` so the BullMQ queue names are readable in redis-cli and
 * in any future dashboard.
 */
export interface JobPayloads {
  /** Hourly compliance sweep: expiry transitions + 30-day alerts (§9.3.4). */
  'compliance.sweep': { reason: 'cron' | 'manual' };
  /** Bulk truck CSV import too large to process in the request (§9.3.4). */
  'trucks.bulk-import': { fleetId: string; importId: string };
  /**
   * Recompute one `(fleet, IST day, driver)` cell of the earnings projection.
   * Absolute, not a delta — see `earnings-projector.ts` for why that matters
   * under at-least-once delivery.
   */
  'earnings.project': { fleetId: string; day: string; driverId: string };
  /** Nightly ledger reconciliation + projection audit (§14.1 "reconciled nightly"). */
  'earnings.reconcile': { reason: 'cron' | 'manual'; days?: number };
  /** §19.3's missed-webhook sweep: ask the provider about non-terminal payouts. */
  'payouts.reconcile': { reason: 'cron' | 'manual' };
  /**
   * The dev adapter's settle timer. A durable delayed job rather than a
   * `setTimeout`, so the local lifecycle demo runs the same path production
   * does and cannot outlive the process that scheduled it.
   */
  'payouts.dev-settle': { payoutId: string; providerRef: string };
  /**
   * §19.3's payment status sweep. THE REASON THIS PORT EXISTS AT ALL, per this
   * file's own header: implemented as a `setInterval` or `@Cron` it would run N
   * times concurrently across N Fargate tasks against the same uncaptured
   * payment. `schedule()` keys the timer in Redis, so every task converges on
   * one.
   */
  'payments.reconcile': { reason: 'cron' | 'manual' };
  /**
   * The dev gateway's settle timer — only enqueued when
   * `PAYMENT_DEV_SETTLE_MS > 0`, because the default of 0 captures inline and
   * needs no job at all.
   */
  'payments.dev-settle': { paymentId: string; gatewayRef: string };
  /**
   * §14.2's invoice PDF, off the hot path per §19.5 ("invoice generation … so
   * the booking hot path never blocks on a slow side effect"). Collapsed on
   * `invoice:<bookingId>` and idempotent on `bookings.invoice_key`, so a
   * redelivery re-serves the same bytes rather than rendering a second,
   * subtly different document.
   */
  'invoice.generate': { bookingId: string };
  /** §12.2's weekly earnings summary for every driver who earned last week. */
  'earnings.weekly-digest': { reason: 'cron' | 'manual' };
  /**
   * §12.3's fan-out. One job per event: resolve recipients, write the delivery
   * rows, then enqueue one `notifications.deliver.*` per row.
   */
  'notifications.fanout': { eventId: string };
  /**
   * ONE JOB NAME PER CHANNEL, which — given one BullMQ queue per job name —
   * means one queue per channel. That is the point: a 400-truck compliance
   * sweep flooding the email queue must not delay a KYC push, and each channel
   * gets its own retry budget because "SMS provider is down" and "APNs is slow"
   * are unrelated failures.
   */
  'notifications.deliver.push': { deliveryId: string };
  'notifications.deliver.sms': { deliveryId: string };
  'notifications.deliver.whatsapp': { deliveryId: string };
  'notifications.deliver.email': { deliveryId: string };
  /**
   * Asks Expo what actually happened to a batch of tickets.
   *
   * Expo's send endpoint returns a TICKET, not an outcome; `DeviceNotRegistered`
   * — the only signal that an app was uninstalled and its token is dead —
   * arrives minutes later from `getReceipts`. Without this job stale tokens are
   * never pruned and every "the device self-heals" claim is false.
   */
  'notifications.push-receipts': { deliveryIds: string[] };
  /**
   * Repairs what a crash between a commit and an enqueue strands: events with
   * no `fanned_out_at` and deliveries still `queued` past their grace window.
   */
  'notifications.sweep': { reason: 'cron' | 'manual' };

  /**
   * §6 progressive-radius search for one booking (Phase 15 enqueues, Phase 17
   * searches).
   *
   * DURABLE AND SINGLE-OWNER, which is the whole reason it is a queue job and
   * not an in-process timer: N Fargate tasks each running their own
   * `setTimeout` would double-offer a fare-locked booking, and a task recycling
   * mid-search would drop it silently with the customer still watching a radar
   * animation.
   *
   * Carries the booking id and NOTHING ELSE — no radius ladder, no deadline.
   * Those live on the zone (`service_zones.dispatch_config`) and the booking
   * row, and a snapshot taken at confirm would be a second source of truth that
   * an admin's §6.7 edit could not reach.
   *
   * RE-ENTRANT AND SELF-SCHEDULING as of Phase 17: each run does exactly one
   * rung of the §6.4 ladder and enqueues its own successor, so a task that dies
   * mid-search loses at most that wave — the booking row still knows where it
   * got to, and the next job resumes from there.
   */
  'dispatch.search': { bookingId: string };

  /**
   * §6.3's twenty-second offer expiry (Phase 17).
   *
   * THE JOB THAT MAKES DOUBLE-ASSIGNMENT IMPOSSIBLE, and the reason it is a
   * queue job is worth stating plainly: an in-process `setTimeout` lives on ONE
   * Fargate task. That task recycles during a deploy, an autoscale event, or a
   * crash — and the offer it was holding is then never expired, so the driver's
   * lock never releases and the booking waits out its whole deadline against a
   * driver who stopped looking at their phone twenty seconds in.
   *
   * IDEMPOTENT AND SINGLE-ATTEMPT. It fires against an offer that may already
   * have been accepted, rejected or revoked; `OfferService.expire` only moves a
   * row still marked `offered`, so every one of those is a no-op. `attempts: 1`
   * because retrying an expiry buys nothing — the offer is either resolved
   * already or the next wave passes over it regardless.
   */
  'dispatch.offer-timeout': { bookingId: string; driverId: string; wave: number };
}

export type JobName = keyof JobPayloads;

export interface EnqueueOptions {
  /**
   * Idempotency key. BullMQ refuses a second job with the same id while the
   * first is still known, which is what makes "enqueue on every request" safe.
   */
  jobId?: string;
  /** Run no earlier than this many ms from now (Phase 17's offer timers). */
  delayMs?: number;
  /** Total attempts including the first. Beyond this the job lands in the DLQ. */
  attempts?: number;
  /** Base delay for exponential backoff between attempts. */
  backoffMs?: number;
}

export type JobHandler<N extends JobName> = (payload: JobPayloads[N]) => Promise<void>;

/** Counts behind the §12.3 depth alarm; `failed` is the DLQ depth. */
export interface QueueStats {
  name: JobName;
  waiting: number;
  active: number;
  delayed: number;
  /** Attempts exhausted — these are the jobs a human has to look at. */
  failed: number;
  completed: number;
}

export interface QueuePort {
  enqueue<N extends JobName>(
    name: N,
    payload: JobPayloads[N],
    options?: EnqueueOptions,
  ): Promise<void>;

  /**
   * Registers a cron schedule for a job.
   *
   * MUST be safe to call from every task on boot: the adapter deduplicates by
   * schedule key in Redis so N tasks produce ONE timer. That is the property
   * `@nestjs/schedule` cannot give us — it would run the sweep N times.
   */
  schedule<N extends JobName>(name: N, payload: JobPayloads[N], cron: string): Promise<void>;

  /** Starts a worker for this job. Call once per process, during module init. */
  process<N extends JobName>(name: N, handler: JobHandler<N>): void;

  /** Snapshot for `/v1/health` and the depth alarm. */
  stats(): Promise<QueueStats[]>;

  /**
   * Fires once per job that has exhausted every attempt — i.e. per job that
   * has just landed in the DLQ (`removeOnFail: false`).
   *
   * It exists because the alternative is counting dead letters from a domain
   * table's own `attempts` column, which increments on EVERY invocation: an
   * operator retrying a dead-lettered job would increment it again and the
   * §12.3 depth alarm would be measuring something other than what it claims.
   * BullMQ already knows `attemptsMade >= opts.attempts` in its `failed`
   * handler, so this surfaces the fact rather than re-deriving it.
   */
  onDeadLetter(listener: (job: JobName, jobId: string, error: string) => void): void;
}
