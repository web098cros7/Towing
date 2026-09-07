import { Injectable, Logger } from '@nestjs/common';
import { ErrorCodes, type JobStatus } from '@towing/api-contracts';
import { and, eq } from 'drizzle-orm';
import { ApiException } from '../../common/errors/api-exception';
import { FleetEventsService } from '../../common/events/fleet-events.service';
import type { DatabaseExecutor } from '../../db/db.module';
import { bookingStatusHistory, bookings } from '../../db/schema';

/**
 * §5.1's customer booking state machine — THE single place a booking's status
 * changes.
 *
 * Every downstream subsystem calls this and nothing else writes
 * `bookings.status`: Phase 17's dispatch, Phase 18's job execution, Phase 19's
 * capture, Phase 20's admin cancel/reassign/dispute. Built any other way, each
 * of them invents its own transition rules, and they disagree the first time
 * two of them touch the same booking — which is exactly the moment nobody is
 * looking.
 *
 * Three things happen together or not at all: the guard, the status write, and
 * the `booking_status_history` row. A history row written outside this service
 * is a history that can lie.
 */

/**
 * A booking that is under way — the states in which a customer has a live trip
 * and cannot start another (§3.8), and in which a driver is committed.
 *
 * OWNED HERE because it was previously copy-pasted as a private const into
 * `dashboard.service.ts` and `positions.repo.ts` (the latter's comment even
 * said "Same set `DashboardService` calls active"). Two copies drift silently;
 * three would have been certain. Note `searching` is deliberately NOT in this
 * set — the fleet surfaces that use it mean "a driver is on this job", and
 * during search there is no driver.
 */
export const ACTIVE_JOB_STATUSES = ['assigned', 'en_route', 'arrived', 'in_progress'] as const;

/**
 * Every state in which the customer has a booking in flight, including the
 * search. This is the §3.8 one-active-booking set, and it must stay in step
 * with `uq_bookings_one_active_per_user`'s WHERE clause in migration 0012 —
 * `booking-state-machine.spec.ts` asserts they match.
 */
export const OPEN_BOOKING_STATUSES = ['searching', ...ACTIVE_JOB_STATUSES] as const;

/**
 * Nothing leaves these. A booking here is finished.
 *
 * `no_drivers_found` is deliberately NOT among them. §9.1.6 gives that screen a
 * "retry / widen" action, and re-entering the search on the SAME booking is
 * what preserves the fare locked at confirm — making the customer start a new
 * booking would re-quote them, potentially at a higher surge, for the
 * platform's own failure to find anyone.
 */
export const TERMINAL_BOOKING_STATUSES = ['paid', 'cancelled'] as const satisfies readonly JobStatus[];

/**
 * §5.1's transition table, transcribed.
 *
 * | From | Event | To |
 * | searching    | driver accepts        | assigned          |
 * | searching    | timeout/no drivers    | no_drivers_found  |
 * | assigned     | driver moves          | en_route          |
 * | en_route     | driver arrives        | arrived           |
 * | arrived      | OTP verified          | in_progress       |
 * | in_progress  | driver completes      | completed         |
 * | completed    | payment captured      | paid              |
 * | any active   | cancel                | cancelled         |
 * | in_progress  | failure               | disputed          |
 * | assigned/en_route/arrived | unable to deliver | searching |
 *
 * `disputed` keeps an edge to `completed` and `paid`: §5.1 sends a dispute to
 * "ops review", and a review that cannot resolve anything is not a review —
 * Phase 20 needs a way back out. `no_drivers_found` keeps an edge back to
 * `searching` for §9.1.6's "retry / widen" prompt, which is the loop the
 * diagram draws at the top.
 *
 * PHASE 18 ADDS THREE EDGES BACK TO `searching`, and they are the only ones this
 * table gained after Phase 15. §5.2's `unable_to_deliver` branch — customer not
 * there, wrong address, refused — has to put the booking back into §6.5's search:
 * §3.5 says it "never charges the customer" and triggers "automatic re-dispatch",
 * so the customer's vehicle is still broken and the platform still owes them a
 * driver. Cancelling would end a trip they never cancelled; leaving it
 * `in_progress` would strand it.
 *
 * They are a genuine cycle in a table that is otherwise a DAG, which is worth
 * being deliberate about: `bookings.dispatch_deadline_at` is what terminates it.
 * `redispatch` extends the deadline rather than clearing it, so a booking cannot
 * loop through drivers indefinitely — it runs out of time and lands on
 * `no_drivers_found` like any other unsuccessful search.
 */
export const LEGAL_TRANSITIONS: Record<JobStatus, readonly JobStatus[]> = {
  searching: ['assigned', 'no_drivers_found', 'cancelled'],
  // `assigned → arrived` skips `en_route`, and it is not a loophole — it is the
  // driver who was already there. §5.2's `arriving` step is derived from
  // MOVEMENT (`EnRouteWatcher`, 150 m), so a driver offered a vehicle parked
  // fifty metres away never trips it and would otherwise be refused when they
  // tapped "Mark arrived" on a job they are standing next to. Writing a
  // synthetic `en_route` history row for a journey nobody made would be worse:
  // the history would claim a trip that did not happen.
  //
  // The abuse this appears to open — marking arrival early to start §7.4's
  // waiting clock — is closed server-side in `JobExecutionService.arrived` by a
  // proximity check against the driver's last fix, which guards the
  // `en_route → arrived` edge equally. The table was never the thing stopping it.
  assigned: ['en_route', 'arrived', 'searching', 'cancelled'],
  en_route: ['arrived', 'searching', 'cancelled'],
  arrived: ['in_progress', 'searching', 'cancelled'],
  in_progress: ['completed', 'disputed', 'cancelled'],
  completed: ['paid', 'disputed'],
  disputed: ['completed', 'paid', 'cancelled'],
  // Terminal.
  paid: [],
  cancelled: [],
  no_drivers_found: ['searching'],
};

export type BookingActor = 'customer' | 'driver' | 'fleet_owner' | 'admin' | 'system';

export interface TransitionParams {
  bookingId: string;
  to: JobStatus;
  actor: BookingActor;
  note?: string | null;
  /** Extra columns to write in the same UPDATE — cancellation details, OTP flags. */
  patch?: Partial<typeof bookings.$inferInsert>;
}

export interface TransitionResult {
  id: string;
  from: JobStatus;
  to: JobStatus;
  fleetId: string | null;
}

@Injectable()
export class BookingStateMachineService {
  private readonly logger = new Logger(BookingStateMachineService.name);

  constructor(private readonly fleetEvents: FleetEventsService) {}

  static isLegal(from: JobStatus, to: JobStatus): boolean {
    return LEGAL_TRANSITIONS[from].includes(to);
  }

  /**
   * Move a booking, inside a transaction the CALLER owns.
   *
   * `tx` rather than an injected db handle, deliberately: a transition is never
   * the only thing happening. Phase 17 assigns a driver and locks a truck in the
   * same breath; Phase 19 credits a ledger. Letting this open its own
   * transaction would put the status change outside theirs, and a rollback
   * would leave a booking claiming to be `assigned` with nobody assigned.
   */
  async transition(tx: DatabaseExecutor, params: TransitionParams): Promise<TransitionResult> {
    const { bookingId, to, actor } = params;

    // FOR UPDATE, not a bare read: two dispatch workers racing to accept the
    // same booking must serialise here, or both read `searching` and both
    // believe they won.
    const [current] = await tx
      .select({ id: bookings.id, status: bookings.status, fleetId: bookings.fleetId })
      .from(bookings)
      .where(eq(bookings.id, bookingId))
      .for('update');

    if (!current) throw ApiException.notFound('Booking not found');

    const from = current.status;
    if (!BookingStateMachineService.isLegal(from, to)) {
      throw new ApiException(
        409,
        ErrorCodes.INVALID_BOOKING_STATE,
        `A booking cannot go from ${from} to ${to}`,
        { from, to, allowed: LEGAL_TRANSITIONS[from] },
      );
    }

    // The WHERE still pins the status we read. The row lock makes this
    // redundant against another transaction — it is not redundant against a
    // caller that passes a stale id, and it costs nothing.
    const [updated] = await tx
      .update(bookings)
      .set({ ...params.patch, status: to, updatedAt: new Date() })
      .where(and(eq(bookings.id, bookingId), eq(bookings.status, from)))
      .returning({ id: bookings.id });

    if (!updated) {
      throw ApiException.conflict('The booking changed while this request was in flight');
    }

    await tx.insert(bookingStatusHistory).values({
      bookingId,
      status: to,
      actor,
      note: params.note ?? null,
    });

    return { id: bookingId, from, to, fleetId: current.fleetId };
  }

  /**
   * Tell the fleet console a booking moved. Call AFTER the caller's transaction
   * commits — a socket message about a change that then rolls back is worse
   * than no message.
   *
   * A `searching` booking has no `fleet_id` (nothing is assigned until Phase
   * 17), so in Phase 15 this is correct-by-construction dead code. It is wired
   * now because the alternative is Phase 17 remembering to add it to a
   * transition service it did not write.
   */
  async announce(result: TransitionResult): Promise<void> {
    if (!result.fleetId) return;
    try {
      await this.fleetEvents.emit(result.fleetId, {
        kind: 'booking_status',
        bookingId: result.id,
        status: result.to,
      });
    } catch (error) {
      this.logger.warn(`booking status broadcast failed for ${result.id}: ${String(error)}`);
    }
  }
}
