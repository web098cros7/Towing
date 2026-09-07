import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { jobStatusSchema, type JobStatus } from '@towing/api-contracts';
import { describe, expect, it } from 'vitest';
import {
  ACTIVE_JOB_STATUSES,
  BookingStateMachineService,
  LEGAL_TRANSITIONS,
  OPEN_BOOKING_STATUSES,
  TERMINAL_BOOKING_STATUSES,
} from './booking-state-machine.service';

/**
 * §5.1's transition table, asserted as a table.
 *
 * The behavioural half (history rows, 409s, row locking) is in
 * `bookings-cancel.e2e.spec.ts` and will grow with Phase 17. What lives here is
 * the SHAPE: that the machine covers every status, that it agrees with the
 * database constraint built from the same set, and that nothing is reachable
 * that §5.1 does not draw.
 */

const ALL_STATUSES = jobStatusSchema.options;

describe('LEGAL_TRANSITIONS covers §5.1 exhaustively', () => {
  it('has an entry for every booking status', () => {
    // A new status added to the enum without a row here would otherwise be a
    // runtime `undefined.includes(...)` on the first transition attempt.
    expect(Object.keys(LEGAL_TRANSITIONS).sort()).toEqual([...ALL_STATUSES].sort());
  });

  it('only ever targets real statuses', () => {
    for (const [from, targets] of Object.entries(LEGAL_TRANSITIONS)) {
      for (const to of targets) {
        expect(ALL_STATUSES, `${from} → ${to}`).toContain(to);
      }
    }
  });

  it('never allows a self-transition', () => {
    for (const [from, targets] of Object.entries(LEGAL_TRANSITIONS)) {
      expect(targets, `${from} → ${from}`).not.toContain(from);
    }
  });

  it('leaves the terminal states terminal', () => {
    for (const status of TERMINAL_BOOKING_STATUSES) {
      expect(LEGAL_TRANSITIONS[status], status).toEqual([]);
    }
  });
});

describe('the §5.1 forward path is walkable end to end', () => {
  it('searching → assigned → en_route → arrived → in_progress → completed → paid', () => {
    const happyPath: JobStatus[] = [
      'searching',
      'assigned',
      'en_route',
      'arrived',
      'in_progress',
      'completed',
      'paid',
    ];

    for (let i = 0; i < happyPath.length - 1; i += 1) {
      const from = happyPath[i]!;
      const to = happyPath[i + 1]!;
      expect(BookingStateMachineService.isLegal(from, to), `${from} → ${to}`).toBe(true);
    }
  });

  it('cannot skip a step', () => {
    // The one that matters most: §5.1 reaches IN_PROGRESS only through OTP
    // verification, so a driver must not be able to jump ARRIVED.
    expect(BookingStateMachineService.isLegal('en_route', 'in_progress')).toBe(false);
    expect(BookingStateMachineService.isLegal('searching', 'en_route')).toBe(false);
    expect(BookingStateMachineService.isLegal('in_progress', 'paid')).toBe(false);
    // Nothing reaches a booking's end without going through the driver's chain.
    expect(BookingStateMachineService.isLegal('assigned', 'completed')).toBe(false);
    expect(BookingStateMachineService.isLegal('arrived', 'completed')).toBe(false);
  });

  /**
   * The one skip that IS legal, and why (Phase 18).
   *
   * §5.2's `arriving` step is derived from MOVEMENT — `EnRouteWatcher` fires
   * `en_route` when the driver gets 150 m from where they accepted. A driver
   * offered a vehicle parked fifty metres away never trips that, so refusing
   * `assigned → arrived` would 409 them on a job they are standing next to.
   *
   * What stops this being a loophole for starting §7.4's waiting clock early is
   * NOT the table — it is `JobExecutionService.arrived`'s proximity check
   * against the driver's last fix, which guards `en_route → arrived` exactly as
   * much. Asserted in `job-execution.e2e.spec.ts`.
   */
  it('lets a driver who was already at the pickup mark arrival directly', () => {
    expect(BookingStateMachineService.isLegal('assigned', 'arrived')).toBe(true);
  });

  /**
   * ONE BACKWARD EDGE EXISTS, AND IT IS ENUMERATED HERE RATHER THAN EXCUSED.
   *
   * This test asserted a strict forward-only order until Phase 18, which added
   * §5.2's `unable_to_deliver` branch: a driver who cannot deliver — customer
   * not there, wrong address, refused — puts the booking back into §6.5's
   * search. §3.5 requires it ("trigger automatic re-dispatch", "never charge the
   * customer"), and neither alternative is acceptable: cancelling ends a trip the
   * customer never cancelled, and staying put strands them.
   *
   * The allowance is a LITERAL SET, not a relaxed rule. Anything that runs
   * backwards and is not in this set still fails, so the next phase that wants
   * an edge has to come here and say which one.
   */
  const LEGAL_BACKWARD_EDGES = new Set([
    // §5.2's unable-to-deliver, from each state a driver can hold a job in.
    'assigned→searching',
    'en_route→searching',
    'arrived→searching',
  ]);

  it('never runs backwards, except for §5.2 unable-to-deliver', () => {
    const order: JobStatus[] = [
      'searching',
      'assigned',
      'en_route',
      'arrived',
      'in_progress',
      'completed',
      'paid',
    ];
    for (let i = 0; i < order.length; i += 1) {
      for (let j = 0; j < i; j += 1) {
        const from = order[i]!;
        const to = order[j]!;
        const expected = LEGAL_BACKWARD_EDGES.has(`${from}→${to}`);
        expect(
          BookingStateMachineService.isLegal(from, to),
          expected
            ? `${from} → ${to} is §5.2's unable-to-deliver and must stay legal`
            : `${from} must not go back to ${to}`,
        ).toBe(expected);
      }
    }
  });

  /**
   * The cycle §5.2 introduces is bounded, and this says by what.
   *
   * `assigned → searching → assigned` is a genuine loop in a table that is
   * otherwise a DAG. What stops a booking bouncing between drivers forever is
   * not the transition table — it is `bookings.dispatch_deadline_at`, which
   * `DispatchService.redispatch` extends rather than clears, so the search runs
   * out of time and lands on `no_drivers_found` like any other.
   *
   * Asserted here because the guarantee lives in two files and the one somebody
   * reads first is this one.
   */
  it('leaves in_progress with no way back to searching', () => {
    // Past the OTP the vehicle is on the truck. There is no honest re-dispatch
    // from here — the branch out is `disputed`, which is ops review.
    expect(BookingStateMachineService.isLegal('in_progress', 'searching')).toBe(false);
    expect(BookingStateMachineService.isLegal('in_progress', 'disputed')).toBe(true);
  });
});

describe('§5.1 branches', () => {
  it('allows cancel from every ACTIVE state and from searching', () => {
    // "any active | cancel | CANCELLED".
    for (const status of OPEN_BOOKING_STATUSES) {
      expect(BookingStateMachineService.isLegal(status, 'cancelled'), status).toBe(true);
    }
  });

  it('does NOT allow cancelling a delivered job', () => {
    // Once the tow has happened, the remedy is a dispute or a refund, not a
    // cancellation — cancelling would erase a job a driver is owed for.
    expect(BookingStateMachineService.isLegal('completed', 'cancelled')).toBe(false);
    expect(BookingStateMachineService.isLegal('paid', 'cancelled')).toBe(false);
  });

  it('reaches no_drivers_found only from searching, and allows a retry back', () => {
    for (const status of ALL_STATUSES) {
      const expected = status === 'searching';
      expect(BookingStateMachineService.isLegal(status, 'no_drivers_found'), status).toBe(expected);
    }
    // §9.1.6's "retry / widen" prompt — the loop the §5.1 diagram draws.
    expect(BookingStateMachineService.isLegal('no_drivers_found', 'searching')).toBe(true);
  });

  it('reaches disputed only from in_progress or completed, and can be resolved', () => {
    expect(BookingStateMachineService.isLegal('in_progress', 'disputed')).toBe(true);
    expect(BookingStateMachineService.isLegal('completed', 'disputed')).toBe(true);
    expect(BookingStateMachineService.isLegal('searching', 'disputed')).toBe(false);
    expect(BookingStateMachineService.isLegal('assigned', 'disputed')).toBe(false);

    // Ops review has to be able to finish. A dispute with no exit is a booking
    // that can never be paid and never be closed.
    expect(LEGAL_TRANSITIONS.disputed.length).toBeGreaterThan(0);
  });
});

describe('the status sets agree with each other and with the database', () => {
  it('OPEN = ACTIVE + searching, and none of them is terminal', () => {
    expect([...OPEN_BOOKING_STATUSES].sort()).toEqual([...ACTIVE_JOB_STATUSES, 'searching'].sort());
    for (const status of OPEN_BOOKING_STATUSES) {
      expect(TERMINAL_BOOKING_STATUSES, status).not.toContain(status);
    }
  });

  it('accounts for every status exactly once', () => {
    // The four groups: open (a trip in flight), terminal (finished), and two
    // resting states that are neither — `completed` awaits settlement, and
    // `disputed` awaits a human. `no_drivers_found` is open-ish: §9.1.6 can
    // retry straight back into the search.
    const resting = ['completed', 'disputed', 'no_drivers_found'];
    const accounted = new Set<string>([
      ...OPEN_BOOKING_STATUSES,
      ...TERMINAL_BOOKING_STATUSES,
      ...resting,
    ]);
    expect([...ALL_STATUSES].filter((s) => !accounted.has(s))).toEqual([]);
    expect(accounted.size).toBe(ALL_STATUSES.length);
  });

  it('matches `uq_bookings_one_active_per_user` in migration 0012', () => {
    // THE ASSERTION THAT KEEPS TWO SOURCES OF TRUTH HONEST. The §3.8 guard in
    // `BookingsService` reads `OPEN_BOOKING_STATUSES`; the partial unique index
    // has its own copy of the same list in SQL. If they ever disagree, one of
    // two things happens — a customer is refused a booking the database would
    // have allowed, or the guard passes and the INSERT dies with a raw
    // constraint violation instead of a readable error.
    const sql = readFileSync(
      resolve(__dirname, '../../../drizzle/0012_booking_lifecycle.sql'),
      'utf8',
    );

    const clause = /CREATE UNIQUE INDEX "uq_bookings_one_active_per_user"[\s\S]*?WHERE "status" IN \(([^)]*)\)/.exec(
      sql,
    );
    expect(clause, 'the index must exist in 0012').not.toBeNull();

    const inSql = clause![1]!
      .split(',')
      .map((s) => s.trim().replace(/'/g, ''))
      .filter(Boolean)
      .sort();

    expect(inSql).toEqual([...OPEN_BOOKING_STATUSES].sort());
  });
});
