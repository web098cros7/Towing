import { Inject, Injectable, Logger } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { DB, type Database } from '../../db/db.module';
import { drivers } from '../../db/schema';

/**
 * `drivers.completion_rate` and `drivers.total_trips` — their first writers.
 *
 * WHY THIS MATTERS MORE THAN IT LOOKS. §6.2 gives completion rate 10 % of the
 * dispatch score and `candidate-selection.service.ts` still carries the comment
 * saying "`completion_rate` and `rating` are still the fixture … 25 % of this
 * score is currently a fixture". Every driver in the system has been scored on a
 * seeded number since Phase 3. This retires half of that; Phase 19's rating
 * rollup retires the rest. A wrong number here changes which driver is offered a
 * job, and through that their income.
 *
 * RECOMPUTED FROM A ROLLING WINDOW, NEVER INCREMENTED — the shape
 * `DispatchRepo.recomputeAcceptanceRate` established in Phase 17, copied
 * deliberately. An incremental counter is wrong twice over: it drifts silently
 * if any single update is lost (and these run inside a transition that can
 * legitimately roll back), and it can never forget, so a driver who failed three
 * deliveries in their first month carries them forever against a rate that is
 * supposed to describe how they are doing NOW. A recompute is self-healing: run
 * it twice, run it after a crash, run it a month late — the answer is the same.
 *
 * `total_trips` IS a counter, and that is not an inconsistency. It is a lifetime
 * total by definition (§9.2.2 shows it on the driver's card as "128 trips"), so
 * there is no window to recompute over — but it is still derived, not
 * incremented: a `COUNT(*)` over completed bookings cannot double-count on a
 * retry the way `total_trips = total_trips + 1` can.
 */

/**
 * §6.2's "rolling 30-day". Same window `recomputeAcceptanceRate` uses, and they
 * should stay the same — two dispatch inputs measuring different periods would
 * make the composite score hard to reason about for no benefit.
 */
const WINDOW_DAYS = 30;

@Injectable()
export class DriverStatsService {
  private readonly logger = new Logger(DriverStatsService.name);

  constructor(@Inject(DB) private readonly db: Database) {}

  /**
   * Recompute both numbers for one driver.
   *
   * CALLED AFTER THE TRANSITION COMMITS, not inside it. The plan called for it
   * "inside the same transition service so the numbers reconcile against
   * `booking_status_history`" — they do, because they are computed from the
   * committed booking rows the history describes. Running the aggregate INSIDE
   * the transaction would have it read the row it is in the middle of writing,
   * and would hold the driver row's lock across two more table scans on the hot
   * path of finishing a job.
   *
   * NEVER THROWS. A completion is committed by the time this runs; a failed
   * statistics update must not turn a successful job into an error on the
   * driver's screen. The next completion recomputes from scratch anyway — which
   * is exactly what "self-healing" buys.
   */
  async recompute(driverId: string): Promise<void> {
    try {
      // Two statements rather than one CTE-fed UPDATE, and deliberately: the
      // aggregate is a read the DB planner can serve from
      // `idx_bookings_driver_outcome`, while folding it into the UPDATE would put
      // two correlated subqueries inside a `SET` clause and make the plan much
      // harder to reason about for no gain. They are also not required to be
      // atomic with each other — both are absolute recomputes, so the worst a
      // torn pair can produce is one number being a few seconds fresher.
      /**
       * TWO SOURCES, AND THE SPLIT IS FORCED BY `unable` CLEARING `driver_id`.
       *
       * The first version of this counted both failure kinds off `bookings`
       * scoped to `driver_id = $1`. That silently could not work, and the e2e
       * test is what found it: `JobExecutionService.unable` nulls `driver_id` in
       * the same UPDATE as the transition — correctly, because the booking goes
       * back into §6.5's search and the next driver's assignment overwrites the
       * column anyway. So the one failure the completion rate exists to punish
       * was invisible to it, and every driver stayed at 100 %.
       *
       * `dispatch_attempts` is the durable, driver-scoped record of that: the
       * `unable` row written by `DispatchRepo.recordUnable` survives the
       * re-dispatch, cannot be overwritten, and carries its own timestamp. It
       * turns out to be load-bearing rather than merely an audit trail.
       *
       * Driver-initiated CANCELLATIONS still come off `bookings` — a cancel does
       * not clear `driver_id`, so the attribution survives there.
       */
      const rows = await this.db.execute<{
        completed: number;
        cancelled: number;
        lifetime: number;
      }>(sql`
        select
          count(*) filter (
            where updated_at >= now() - make_interval(days => ${WINDOW_DAYS})
              and status in ('completed', 'paid')
          )::int as completed,
          -- §3.5: "Driver cancellations and 'unable to deliver' ... are logged
          -- separately, count against acceptance/completion rate". A CUSTOMER
          -- cancel is not the driver's fault and is deliberately absent from
          -- BOTH sides of the ratio, so a driver working a flaky area is not
          -- ranked down for it.
          count(*) filter (
            where updated_at >= now() - make_interval(days => ${WINDOW_DAYS})
              and status = 'cancelled'
              and cancelled_by = 'driver'
          )::int as cancelled,
          -- LIFETIME, not windowed: §9.2.2 renders it as a career total on the
          -- driver's card. A COUNT rather than an increment, so a retried
          -- completion cannot inflate it.
          count(*) filter (where status in ('completed', 'paid'))::int as lifetime
        from bookings
        where driver_id = ${driverId}
      `);

      const unableRows = await this.db.execute<{ unable: number }>(sql`
        select count(*)::int as unable
          from dispatch_attempts
         where driver_id = ${driverId}
           and outcome = 'unable'
           and offered_at >= now() - make_interval(days => ${WINDOW_DAYS})
      `);

      const row = rows[0];
      if (!row) return;

      const completed = Number(row.completed);
      const failed = Number(row.cancelled) + Number(unableRows[0]?.unable ?? 0);
      const resolved = completed + failed;

      // NULL, not 100, when there is no signal. `score()` in
      // `candidate-selection.service.ts` maps a null to its NEUTRAL midpoint; a
      // hard-coded 100 would hand every brand-new driver a perfect completion
      // record and rank them above people who have actually earned one.
      const completionRate =
        resolved === 0 ? null : ((completed / resolved) * 100).toFixed(2);

      await this.db
        .update(drivers)
        .set({
          completionRate,
          totalTrips: Number(row.lifetime),
          updatedAt: new Date(),
        })
        .where(eq(drivers.id, driverId));
    } catch (error) {
      this.logger.warn(`driver stat recompute failed for ${driverId}: ${String(error)}`);
    }
  }
}
