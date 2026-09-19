import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import {
  resolveDispatchConfig,
  type DispatchConfig,
  type ServiceType,
} from '@towing/api-contracts';
import { eq } from 'drizzle-orm';
import { NotificationService } from '../../common/notifications/notification.service';
import { QUEUE, type QueuePort } from '../../common/queue/queue.port';
import { DB, type Database } from '../../db/db.module';
import { serviceZones } from '../../db/schema';
import { BookingStateMachineService } from '../bookings/booking-state-machine.service';
import { CustomerGateway } from '../bookings/customer.gateway';
import { PresenceStore } from '../driver-presence/presence-store';
import { CandidateSelectionService, type SelectionResult } from './candidate-selection.service';
import { KillSwitchService } from '../../common/killswitch/killswitch.service';
import { DispatchRepo, type DispatchBookingRow } from './dispatch.repo';
import { OfferService } from './offer.service';

/**
 * §6.4's progressive-radius search — the wave runner.
 *
 * DURABLE AND SINGLE-OWNER, which is the architectural decision the plan locked
 * before the first line of code. Wave position lives on the booking row, offer
 * timers are BullMQ delayed jobs, and a Redis lock keeps two workers off the
 * same search. Twenty-second offer timers as in-process `setTimeout` over N
 * stateless Fargate tasks produce double-assignment — two drivers against one
 * fare-locked booking — which corrupts the ledger rather than degrading UX.
 *
 * ⚠ `runWave` AND `expireOffer` ARE PLAIN PUBLIC METHODS, and the queue workers
 * below are one-line delegations to them. That is not incidental: the entire
 * test suite runs with `QUEUE_ENABLED=false` (see `test/setup.ts` — a live
 * worker on the shared test Redis would race every spec), so the engine has to
 * be drivable without BullMQ. It is also the better shape — the specs exercise
 * the real logic rather than the queue's delivery semantics, which
 * `queue.e2e.spec.ts` already covers on its own.
 */

/**
 * How long one wave may hold its lock.
 *
 * Covers selection plus N offers — a few hundred milliseconds in practice. Far
 * shorter than the offer timeout, because this lock protects the ACT of
 * advancing a wave, not the twenty seconds a driver spends deciding.
 */
const SEARCH_LOCK_TTL_MS = 15_000;

/**
 * How long an EMPTY wave waits before the next rung.
 *
 * §6.4 says an empty wave "advances immediately", and the first implementation
 * read that literally: `nextDelayMs = 0`. It re-enqueues instantly, finds
 * nothing again, re-enqueues instantly — a hot loop that ran a booking to WAVE
 * 3992 in under two minutes, hammering Redis and Postgres the whole way. The
 * unit test asserting `nextDelayMs === 0` was perfectly satisfied; only
 * `pnpm bench:dispatch` against a live backend showed it.
 *
 * What the rule actually means is "do not wait out a twenty-second offer
 * timeout that nobody is holding" — the alternative that motivates it. Two
 * seconds still walks the whole five-rung ladder in ten seconds instead of a
 * hundred, which is the entire benefit, and it cannot spin: past the last rung
 * a search re-checks twice a second at worst until its deadline, and the only
 * thing that changes in the meantime is a driver coming online, which happens
 * at human speed.
 */
const EMPTY_WAVE_DELAY_MS = 2_000;

/**
 * What one wave did.
 *
 * RETURNED RATHER THAN ONLY LOGGED, and the reason is testability: the entire
 * suite runs with `QUEUE_ENABLED=false`, so the `dispatch.search` re-enqueue is
 * a no-op and `nextDelayMs` would be invisible to every spec. "An empty wave
 * advances immediately" is a real §6.4 rule with a real cost when it regresses —
 * a quiet zone would burn an eighth of its search deadline per empty wave — and
 * a rule nothing can assert is a rule that will quietly stop being true.
 *
 * It doubles as the shape the log line is built from, so the two cannot drift.
 */
export type WaveOutcome =
  | { ran: false; reason: 'locked' | 'unknown_booking' | 'not_searching' | 'scheduled' | 'paused' }
  | { ran: false; reason: 'gave_up'; wave: number }
  | {
      ran: true;
      wave: number;
      radiusKm: number;
      considered: number;
      offered: number;
      /** 0 when the wave was empty — see the §6.4 rule above. */
      nextDelayMs: number;
      degraded: boolean;
    };

@Injectable()
export class DispatchService implements OnModuleInit {
  private readonly logger = new Logger(DispatchService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(QUEUE) private readonly queue: QueuePort,
    private readonly repo: DispatchRepo,
    private readonly selection: CandidateSelectionService,
    private readonly offers: OfferService,
    private readonly presence: PresenceStore,
    private readonly killSwitch: KillSwitchService,
    private readonly machine: BookingStateMachineService,
    private readonly customerGateway: CustomerGateway,
    private readonly notifications: NotificationService,
  ) {}

  /**
   * The workers, replacing Phase 15's no-op that logged and returned.
   *
   * Both bodies are one line by design — see the class docblock.
   */
  onModuleInit(): void {
    this.queue.process('dispatch.search', async ({ bookingId }) => {
      await this.runWave(bookingId);
    });

    this.queue.process('dispatch.offer-timeout', async ({ bookingId, driverId }) => {
      await this.expireOffer(bookingId, driverId);
    });

    this.queue.process('dispatch.revoke', async ({ bookingId, reason, holderDriverId }) => {
      await this.revokeBooking(bookingId, reason, holderDriverId);
    });
  }

  /**
   * The `dispatch.revoke` worker body, extracted so tests can drive it
   * directly (the suite runs queue-off).
   *
   * Revokes every live offer, then — M0-F6 — tells the holder, if the
   * canceller named one. A cancelled booking's holder keeps an `accepted`
   * attempt `revokeAll` will never move, so without the second step their
   * screen sits on a dead job until the 15 s poll notices.
   */
  async revokeBooking(
    bookingId: string,
    reason: 'cancelled' | 'paused',
    holderDriverId?: string,
  ): Promise<void> {
    await this.offers.revokeAll(bookingId, reason);
    if (holderDriverId) this.offers.notifyHolderRevoked(holderDriverId, bookingId);
  }

  /**
   * Advances one booking's search by one wave.
   *
   * RE-ENTRANT AND SELF-SCHEDULING. Each call does exactly one rung and enqueues
   * its own successor, so a task that dies mid-search loses at most the wave it
   * was running — the booking row still knows where it got to, and the next
   * `dispatch.search` job resumes from there. That is §19.7's game day: kill the
   * worker mid-wave and the search continues at the correct rung with the
   * correct exclusions.
   */
  async runWave(bookingId: string): Promise<WaveOutcome> {
    // Serialise wave runners. Losing the lock means another worker is running
    // the very wave this call wanted to run, so returning is correct — queueing
    // behind it would produce a duplicate wave a moment later.
    if (!(await this.presence.takeSearchLock(bookingId, SEARCH_LOCK_TTL_MS))) {
      this.logger.debug(`wave for ${bookingId} skipped — another worker holds the lock`);
      return { ran: false, reason: 'locked' };
    }

    try {
      return await this.runWaveLocked(bookingId);
    } finally {
      await this.presence.releaseSearchLock(bookingId);
    }
  }

  private async runWaveLocked(bookingId: string): Promise<WaveOutcome> {
    const booking = await this.repo.booking(bookingId);
    if (!booking) {
      this.logger.warn(`dispatch.search for unknown booking ${bookingId}`);
      return { ran: false, reason: 'unknown_booking' };
    }

    // A booking that has moved on — accepted, cancelled, or already given up —
    // is not an error. Delayed jobs outlive the state that scheduled them, and
    // this is the ordinary way a search stops.
    if (booking.status !== 'searching') return { ran: false, reason: 'not_searching' };

    // §9.1.5's "schedule for later". The enqueue carried a delay, but a
    // re-enqueue after a cancel or a restart may not have — so the guard lives
    // here too, where it cannot be bypassed.
    if (booking.scheduledAt && booking.scheduledAt.getTime() > Date.now()) {
      await this.queue.enqueue(
        'dispatch.search',
        { bookingId },
        { jobId: `dispatch-${bookingId}-scheduled`, delayMs: booking.scheduledAt.getTime() - Date.now() },
      );
      return { ran: false, reason: 'scheduled' };
    }

    // §19.8. Checked at the START of every wave rather than only at booking
    // creation, so flipping the switch stops searches already in flight — which
    // is the entire point of having it.
    if (await this.isPaused(booking)) {
      this.logger.log(`booking ${bookingId} held — dispatch paused for its zone or band`);
      // A12: drivers holding an offer for a search that just stopped must be
      // told now — otherwise they sit out their twenty seconds and pay for it
      // in acceptance rate. Revoke before rescheduling; both are idempotent.
      await this.offers.revokeAll(bookingId, 'paused');
      // Re-check shortly rather than failing the booking. A pause is an
      // operator's temporary decision, and a customer whose search was killed by
      // it would have to re-book at whatever surge applies then.
      await this.reschedule(bookingId, 30_000, 'paused');
      return { ran: false, reason: 'paused' };
    }

    const config = await this.configFor(booking);
    const ladder = booking.longDistance ? config.bandCRadiusLadderKm : config.radiusLadderKm;

    // First wave: stamp the deadline. It is written once and never extended, so
    // a search cannot be kept alive by repeated re-entry.
    const wave = (booking.searchWave ?? 0) + 1;
    const deadlineAt =
      booking.dispatchDeadlineAt ?? new Date(Date.now() + config.maxSearchSeconds * 1_000);

    /**
     * THE DEADLINE TERMINATES A SEARCH, NOT THE LADDER — and the arithmetic is
     * worth stating because it is counter-intuitive: 5 rungs × 3 offers × 20 s
     * is 300 s of sequential offers against a ~180 s deadline. The ladder never
     * gets to exhaust itself in the default configuration. Anyone tuning
     * `maxSearchSeconds` upward should know they are the binding constraint.
     */
    if (Date.now() >= deadlineAt.getTime()) {
      await this.giveUp(booking, 'deadline');
      return { ran: false, reason: 'gave_up', wave };
    }

    // Past the last rung, keep searching at the widest radius until the deadline
    // rather than giving up early — the ladder is a widening schedule, not a
    // budget.
    const radiusKm = ladder[Math.min(wave, ladder.length) - 1] ?? ladder[ladder.length - 1]!;

    // W5: the wave log measures the whole decision — selection plus offers.
    const waveStartedAt = Date.now();
    const selected = await this.selection.select(booking, radiusKm, config.offersPerWave);
    await this.repo.setWaveState(bookingId, wave, booking.dispatchDeadlineAt ? null : deadlineAt);

    let offered = 0;
    const offeredDriverIds: string[] = [];
    for (const candidate of selected.candidates) {
      // `offer` returns false when another search won the driver between
      // selection and the lock — ordinary in a busy zone, not an error.
      if (await this.offers.offer(booking, candidate, wave, radiusKm, config.offerTimeoutSeconds)) {
        offered += 1;
        offeredDriverIds.push(candidate.driverId);
      }
    }

    // W5: ONE row per wave, AFTER the offers, never inside the loop — the log
    // is an observer and must not slow a wave down. `writeWaveLog` swallows its
    // own failures for the same reason.
    await this.writeWaveLog({
      booking,
      wave,
      radiusKm,
      config,
      selected,
      offered,
      offeredDriverIds,
      durationMs: Date.now() - waveStartedAt,
      ladderLength: ladder.length,
    });

    await this.announceProgress(booking, wave, radiusKm, deadlineAt);

    /**
     * AN EMPTY WAVE ADVANCES FAST — see `EMPTY_WAVE_DELAY_MS` for why it is a
     * short floor rather than zero, and what happened when it was zero.
     *
     * Waiting out a twenty-second offer timeout nobody is holding would burn an
     * eighth of the entire search deadline on nothing, and at wave 1 in a quiet
     * zone that is the common case rather than the edge case.
     */
    const nextDelayMs = offered === 0 ? EMPTY_WAVE_DELAY_MS : config.offerTimeoutSeconds * 1_000;
    await this.reschedule(bookingId, nextDelayMs, `wave-${wave}`);

    // The wave log carries the ids now, so the line stays a compact tally.
    const excludedCounts = Object.fromEntries(
      Object.entries(selected.excluded).map(([reason, detail]) => [reason, detail.count]),
    );
    this.logger.log(
      `booking ${bookingId} wave ${wave} @ ${radiusKm}km: ${selected.considered} in range, ${selected.eligible} eligible, ${offered} offered` +
        (selected.degraded ? ' (postgis fallback)' : '') +
        (Object.keys(excludedCounts).length > 0 ? ` — excluded ${JSON.stringify(excludedCounts)}` : ''),
    );

    return {
      ran: true,
      wave,
      radiusKm,
      considered: selected.considered,
      offered,
      nextDelayMs,
      degraded: selected.degraded,
    };
  }

  /**
   * Expires one unanswered offer. Idempotent — see `OfferService.expire`.
   *
   * It does NOT advance the wave: the wave's own successor job is already
   * scheduled for the same instant, and having both advance would double every
   * search's pace. This only releases the driver and records the silence.
   */
  async expireOffer(bookingId: string, driverId: string): Promise<void> {
    await this.offers.expire(bookingId, driverId);
  }

  /**
   * §6.5's re-dispatch, after an assigned driver drops out.
   *
   * SEARCH RESUMES AT THE STORED WAVE, not at 2 km. A customer whose driver
   * cancelled four minutes in must not be sent back to the start of the ladder
   * for someone else's decision — and the canceller is already in the exclusion
   * set from their own `dispatch_attempts` row, so they cannot be re-offered.
   *
   * The deadline is EXTENDED here, and this is the one place it may be: the
   * original one was budgeted for the original search, and the customer has
   * already spent it once through no fault of their own.
   */
  async redispatch(bookingId: string, reason: string): Promise<void> {
    const booking = await this.repo.booking(bookingId);
    if (!booking || booking.status !== 'searching') return;

    const config = await this.configFor(booking);
    await this.repo.setWaveState(
      bookingId,
      booking.searchWave ?? 1,
      new Date(Date.now() + config.maxSearchSeconds * 1_000),
    );

    this.logger.log(`re-dispatching ${bookingId} from wave ${booking.searchWave ?? 1} (${reason})`);
    // Delay 0 — a re-dispatch goes to the front. The customer has already
    // waited through one full search.
    await this.reschedule(bookingId, 0, `redispatch-${reason}`);
  }

  /**
   * W8's `offer_to_driver` reassign (§6.5 step 6): one EXCLUSIVE offer to an
   * operator's chosen, eligibility-checked driver.
   *
   * The engine's own rules still apply — the driver must survive
   * `CandidateSelectionService.select` at the widest ladder rung (an operator's
   * explicit choice is not radius-limited the way an automatic wave is, but it
   * is still gated on KYC, suspension, zone restrictions, presence and the
   * already-offered set), and `OfferService.offer`'s lock still decides whether
   * the offer is real.
   *
   * THE EXCLUSIVE WINDOW is the successor scheduled for exactly this offer's
   * expiry: while the offer is open, the next wave is not due, so nobody else
   * is asked. (A wave runs when its predecessor's offers resolve or expire by
   * design — a booking whose assigned driver was reassigned has no live wave,
   * and the successor this method schedules is the only one in flight.)
   *
   * Returns the exclusion reason when it refuses, so the console can say WHY
   * (offline, suspended, already asked, lock lost) rather than a bare 422.
   */
  async adminOfferToDriver(
    bookingId: string,
    driverId: string,
  ): Promise<{ offered: boolean; exclusion?: string; wave: number; radiusKm: number }> {
    const booking = await this.repo.booking(bookingId);
    if (!booking || booking.status !== 'searching') {
      return { offered: false, exclusion: 'not_searching', wave: 0, radiusKm: 0 };
    }

    const config = await this.configFor(booking);
    const ladder = booking.longDistance ? config.bandCRadiusLadderKm : config.radiusLadderKm;
    const wave = booking.searchWave ?? 1;
    const radiusKm = ladder[ladder.length - 1]!;

    // A wide limit, not `offersPerWave`: the operator named a driver who may
    // not be in the top of the score ranking, and the question here is
    // eligibility, not rank.
    const selected = await this.selection.select(booking, radiusKm, 50);
    const candidate = selected.candidates.find((entry) => entry.driverId === driverId);
    if (!candidate) {
      const exclusion =
        Object.entries(selected.excluded).find(([, detail]) =>
          detail.driverIds.includes(driverId),
        )?.[0] ?? 'not_eligible';
      return { offered: false, exclusion, wave, radiusKm };
    }

    const offered = await this.offers.offer(
      booking,
      candidate,
      wave,
      radiusKm,
      config.offerTimeoutSeconds,
    );
    if (offered) {
      // The exclusive window: the next wave waits out the offer just sent.
      await this.reschedule(bookingId, config.offerTimeoutSeconds * 1_000, 'admin-offer-to-driver');
    }
    return { offered, exclusion: offered ? undefined : 'offer_locked', wave, radiusKm };
  }

  /**
   * §5.1's `searching → no_drivers_found`.
   *
   * NOT TERMINAL, deliberately: §9.1.6 gives that screen a "retry / widen"
   * action, and re-entering the search on the SAME booking is what preserves the
   * fare locked at confirm. Making the customer start again would re-quote them,
   * possibly at a higher surge, for the platform's own failure to find anyone.
   */
  private async giveUp(booking: DispatchBookingRow, reason: string): Promise<void> {
    const result = await this.db.transaction((tx) =>
      this.machine.transition(tx, {
        bookingId: booking.id,
        to: 'no_drivers_found',
        actor: 'system',
        note: `dispatch gave up: ${reason}`,
      }),
    );

    await this.machine.announce(result);
    this.customerGateway.emitBookingStatus(booking.id, 'no_drivers_found');

    try {
      await this.notifications.emit('booking.no_drivers_found', {
        bookingId: booking.id,
        userId: booking.userId,
        reference: `TW-${booking.id.slice(0, 8).toUpperCase()}`,
      });
    } catch (error) {
      this.logger.warn(`no-drivers notification failed for ${booking.id}: ${String(error)}`);
    }

    this.logger.log(`booking ${booking.id} → no_drivers_found (${reason})`);
  }

  /** §9.1.6's live wave state, to the socket and (via the row) to the poll. */
  private async announceProgress(
    booking: DispatchBookingRow,
    wave: number,
    radiusKm: number,
    deadlineAt: Date,
  ): Promise<void> {
    try {
      const driversContacted = await this.repo.driversContacted(booking.id);
      this.customerGateway.emitSearchProgress(booking.id, {
        bookingId: booking.id,
        wave,
        radiusKm,
        driversContacted,
        deadlineAt: deadlineAt.toISOString(),
        at: new Date().toISOString(),
      });

      // §12.2's *search widening* row — the customer is told the search is
      // reaching further, not left watching a spinner. Only from wave 2: wave 1
      // IS the search starting, and a "we're widening" push a second after
      // "we're looking" reads as panic.
      if (wave > 1) {
        await this.notifications.emit('booking.search_widening', {
          bookingId: booking.id,
          userId: booking.userId,
          radiusKm,
          driversContacted,
        });
      }
    } catch (error) {
      // Progress reporting must never fail a wave. The customer seeing a stale
      // radius is a cosmetic problem; a search that stopped is not.
      this.logger.warn(`search progress broadcast failed for ${booking.id}: ${String(error)}`);
    }
  }

  /** §6.7's per-zone config, through the one sanctioned reader of the JSONB. */
  private async configFor(booking: DispatchBookingRow): Promise<DispatchConfig> {
    const [zone] = booking.zoneId
      ? await this.db
          .select({ dispatchConfig: serviceZones.dispatchConfig })
          .from(serviceZones)
          .where(eq(serviceZones.id, booking.zoneId))
          .limit(1)
      : [];

    // A NULL `dispatch_config` — an un-tuned zone, or a booking with no zone at
    // all — resolves to Phase 14's typed defaults rather than to constants here.
    return resolveDispatchConfig(zone?.dispatchConfig ?? null, booking.serviceType as ServiceType);
  }

  private async isPaused(booking: DispatchBookingRow): Promise<boolean> {
    if (await this.killSwitch.isZonePaused(booking.zoneId)) return true;
    if (booking.longDistance && (await this.killSwitch.isLongDistanceDisabled())) return true;
    return false;
  }

  /**
   * W5: writes the wave's decision record (§9.4.6).
   *
   * SKIPPED FOR EMPTY WAVES PAST THE LAST RUNG. A quiet booking re-checks its
   * widest radius every two seconds until the deadline; one row per check would
   * bury every wave that could have matched somebody. Waves at or before the
   * last rung still log their emptiness — "wave 3 found nobody in 8 km" is an
   * answer the inspector exists to give.
   *
   * FAILURES ARE SWALLOWED, deliberately: the offers are already out and the
   * search is already rescheduled by the time this runs, so a failed insert can
   * only lose an audit row — throwing here would fail a wave that worked.
   */
  private async writeWaveLog(params: {
    booking: DispatchBookingRow;
    wave: number;
    radiusKm: number;
    config: DispatchConfig;
    selected: SelectionResult;
    offered: number;
    offeredDriverIds: string[];
    durationMs: number;
    ladderLength: number;
  }): Promise<void> {
    const {
      booking,
      wave,
      radiusKm,
      config,
      selected,
      offered,
      offeredDriverIds,
      durationMs,
      ladderLength,
    } = params;

    if (offered === 0 && wave > ladderLength) return;

    const offeredSet = new Set(offeredDriverIds);
    try {
      await this.repo.recordWaveLog({
        bookingId: booking.id,
        wave,
        radiusKm,
        considered: selected.considered,
        eligible: selected.eligible,
        offered,
        degraded: selected.degraded,
        weights: selected.weights,
        config,
        excluded: selected.excluded,
        candidates: selected.ranked.map((candidate) => ({
          driverId: candidate.driverId,
          distanceM: Math.round(candidate.distanceMeters),
          proximity: round4(candidate.terms.proximity),
          rating: round4(candidate.terms.rating),
          acceptance: round4(candidate.terms.acceptance),
          completion: round4(candidate.terms.completion),
          score: round2(candidate.score),
          offered: offeredSet.has(candidate.driverId),
        })),
        durationMs,
      });
    } catch (error) {
      // An inspector with a gap beats a search that stopped — see the docblock.
      this.logger.warn(`wave log write failed for ${booking.id} wave ${wave}: ${String(error)}`);
    }
  }

  /**
   * Schedules the next wave.
   *
   * The `jobId` includes a discriminator so BullMQ does not deduplicate the next
   * wave against the one that just ran — its collision rule refuses a repeated
   * id while the first job is still known, and `removeOnComplete` keeps
   * completed jobs for an hour. A bare `dispatch-{bookingId}` would silently
   * drop every wave after the first.
   */
  private async reschedule(bookingId: string, delayMs: number, discriminator: string): Promise<void> {
    await this.queue.enqueue(
      'dispatch.search',
      { bookingId },
      { jobId: `dispatch-${bookingId}-${discriminator}`, delayMs, attempts: 2 },
    );
  }
}

/** 4 dp is finer than any term needs to be and keeps the stored JSON compact. */
function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

/** The score as the ranking used it, to two decimals. */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
