import { sql } from 'drizzle-orm';
import type { DatabaseExecutor } from '../../db/db.module';

/**
 * How one driver is paid for a job (0042, Ehsan 24 Sep).
 *
 * - `independent`: no fleet. The driver gets the whole payout.
 * - `share`: a fleet driver on a split. `driverSharePct` of the payout, the
 *   fleet the rest.
 * - `salary`: a fleet driver whose owner keeps the payout and pays them a
 *   salary. The driver gets nothing per job.
 *
 * ONE RULE, used by the offer card, the job screens and settlement, so the
 * number a driver accepts on and the number they are paid cannot come from two
 * different places. Before this, the offer showed the whole payout while
 * settlement paid a fleet driver with no `fleet_driver_shares` row 0 %.
 */
export type DriverPayTerms =
  { model: 'independent' } | { model: 'share'; driverSharePct: number } | { model: 'salary' };

/** The driver share `computeSettlement` takes: null = independent, 0 = salary. */
export function sharePctOf(terms: DriverPayTerms): number | null {
  switch (terms.model) {
    case 'independent':
      return null;
    case 'salary':
      return 0;
    case 'share':
      return terms.driverSharePct;
  }
}

/**
 * The terms locked on a booking at acceptance, or null for a booking accepted
 * before 0042 (the caller then resolves the current ones).
 */
export function lockedPayTerms(booking: {
  driverPayModel: string | null;
  driverSharePct: string | number | null;
}): DriverPayTerms | null {
  switch (booking.driverPayModel) {
    case 'independent':
      return { model: 'independent' };
    case 'salary':
      return { model: 'salary' };
    case 'share':
      return { model: 'share', driverSharePct: Number(booking.driverSharePct ?? 0) };
    default:
      return null;
  }
}

/**
 * A driver's CURRENT terms: their fleet's model, and under `share` their own
 * override if the owner set one, else the fleet's default.
 */
export async function payTermsForDriver(
  db: DatabaseExecutor,
  driverId: string,
): Promise<DriverPayTerms> {
  const [row] = (await db.execute(sql`
    select d.fleet_id,
           f.driver_pay_model,
           f.driver_share_pct::text as fleet_pct,
           fds.driver_share::text as override_pct
      from drivers d
      left join fleets f on f.id = d.fleet_id
      left join fleet_driver_shares fds on fds.fleet_id = d.fleet_id and fds.driver_id = d.id
     where d.id = ${driverId}::uuid
  `)) as unknown as Array<{
    fleet_id: string | null;
    driver_pay_model: string | null;
    fleet_pct: string | null;
    override_pct: string | null;
  }>;

  if (!row?.fleet_id) return { model: 'independent' };
  if (row.driver_pay_model === 'salary') return { model: 'salary' };
  return { model: 'share', driverSharePct: Number(row.override_pct ?? row.fleet_pct ?? 80) };
}
