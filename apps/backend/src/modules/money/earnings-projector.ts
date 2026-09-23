import { sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '../../db/schema';

/**
 * The `earnings_daily` projection engine (§9.3.8 AC: "report queries hit read
 * paths").
 *
 * A plain function over a Drizzle handle rather than a Nest provider, mirroring
 * `runComplianceSweep` and `runSeed`: the BullMQ worker, the vitest suite, the
 * rebuild CLI and `pnpm db:seed` all need to run it and only one of them has a
 * DI container.
 */

export type ProjectorDatabase = PostgresJsDatabase<typeof schema>;

/** One cell of the projection — the grain is the identity. */
export interface EarningsGrainKey {
  fleetId: string;
  /** IST calendar day, `YYYY-MM-DD`. */
  day: string;
  driverId: string;
}

/**
 * The credit types that constitute earnings. Must stay in step with the third
 * ledger invariant's `type in (...)` list — they answer the same question
 * ("what did this booking actually pay out?") and a divergence would make the
 * projection disagree with the invariant that is supposed to police it.
 */
const EARNING_TYPES = sql`('driver_share_credit', 'fleet_share_credit', 'fare_credit')`;

/** `(created_at AT TIME ZONE 'Asia/Kolkata')::date` — the projection's grain. */
const IST_DAY = sql`(t.created_at at time zone 'Asia/Kolkata')::date`;

/**
 * Recompute one cell from the ledger — **absolutely, never as a delta**.
 *
 * BullMQ is at-least-once. A redelivered "add ₹500 to this cell" job
 * double-counts silently and nothing ever fails; a redelivered "this cell is
 * now exactly X" job writes identical numbers. It also makes the incremental
 * path and the cold rebuild literally the same code, which is what stops them
 * drifting apart.
 *
 * Returns whether the cell now exists — a caller can use it to report deletions.
 */
export async function projectCell(db: ProjectorDatabase, key: EarningsGrainKey): Promise<boolean> {
  const rows = (await db.execute(sql`
    with legs as (
      select b.id as booking_id,
             b.total,
             b.commission_amount,
             sum(t.amount) filter (where t.type = 'driver_share_credit') as driver_share,
             sum(t.amount) filter (where t.type = 'fleet_share_credit')  as fleet_share,
             sum(t.amount) filter (where t.type = 'fare_credit')         as net_fare
        from wallet_transactions t
        join bookings b on b.id = t.ref_id
       where t.type in ${EARNING_TYPES}
         and b.fleet_id = ${key.fleetId}::uuid
         and b.driver_id = ${key.driverId}::uuid
         and ${IST_DAY} = ${key.day}::date
       group by b.id, b.total, b.commission_amount
    )
    insert into earnings_daily (
      fleet_id, day, driver_id, jobs, gross, commission, pool, driver_share, fleet_share, updated_at
    )
    select ${key.fleetId}::uuid,
           ${key.day}::date,
           ${key.driverId}::uuid,
           count(*)::int,
           sum(total),
           sum(commission_amount),
           sum(coalesce(driver_share, 0) + coalesce(fleet_share, 0) + coalesce(net_fare, 0)),
           sum(coalesce(driver_share, 0) + coalesce(net_fare, 0)),
           sum(coalesce(fleet_share, 0)),
           now()
      from legs
     having count(*) > 0
    on conflict (fleet_id, day, driver_id) do update set
      jobs = excluded.jobs,
      gross = excluded.gross,
      commission = excluded.commission,
      pool = excluded.pool,
      driver_share = excluded.driver_share,
      fleet_share = excluded.fleet_share,
      updated_at = now()
    returning driver_id
  `)) as unknown as Array<{ driver_id: string }>;

  if (rows.length > 0) return true;

  // Zero source rows ⇒ DELETE the cell. A booking moved to `disputed` with its
  // credits reversed must take its cell to nothing, not leave stale numbers
  // behind. This explicit branch is the classic projection bug; without it the
  // upsert above simply does nothing and the old row survives forever.
  await db.execute(sql`
    delete from earnings_daily
     where fleet_id = ${key.fleetId}::uuid
       and day = ${key.day}::date
       and driver_id = ${key.driverId}::uuid
  `);

  return false;
}

/**
 * Every grain key with ledger activity in a window — the input to both a cold
 * rebuild and the reconciliation audit.
 *
 * Bookings with no fleet (independent drivers) are excluded: `earnings_daily`
 * is fleet-scoped, and an independent driver's earnings belong to Track B's
 * driver-facing surface, not the fleet console.
 */
export async function grainKeysSince(
  db: ProjectorDatabase,
  options: { fleetId?: string; sinceDays?: number; now?: Date } = {},
): Promise<EarningsGrainKey[]> {
  const now = options.now ?? new Date();
  const since = options.sinceDays
    ? new Date(now.getTime() - options.sinceDays * 86_400_000)
    : null;

  const rows = (await db.execute(sql`
    select distinct
           b.fleet_id,
           to_char(${IST_DAY}, 'YYYY-MM-DD') as day,
           b.driver_id
      from wallet_transactions t
      join bookings b on b.id = t.ref_id
     where t.type in ${EARNING_TYPES}
       and b.fleet_id is not null
       and b.driver_id is not null
       ${options.fleetId ? sql`and b.fleet_id = ${options.fleetId}::uuid` : sql``}
       ${since ? sql`and t.created_at >= ${since.toISOString()}::timestamptz` : sql``}
  `)) as unknown as Array<{ fleet_id: string; day: string; driver_id: string }>;

  return rows.map((row) => ({ fleetId: row.fleet_id, day: row.day, driverId: row.driver_id }));
}

export interface RebuildResult {
  cells: number;
  deleted: number;
}

/**
 * Cold rebuild. Drives the *same* `projectCell` the worker calls — one
 * implementation, two entry points, exactly the `runComplianceSweep` precedent.
 *
 * Also deletes cells inside the window whose source rows are gone, which is how
 * a rebuild after a bulk reversal converges rather than leaving orphans the
 * incremental path would never revisit.
 */
export async function rebuildEarnings(
  db: ProjectorDatabase,
  options: { fleetId?: string; sinceDays?: number; now?: Date } = {},
): Promise<RebuildResult> {
  const keys = await grainKeysSince(db, options);

  let cells = 0;
  for (const key of keys) {
    if (await projectCell(db, key)) cells += 1;
  }

  // Orphans: rows in the window with no matching source key. Compared as
  // strings because `day` comes back as a date and the keys are ISO strings.
  const live = new Set(keys.map((k) => `${k.fleetId}|${k.day}|${k.driverId}`));
  const now = options.now ?? new Date();
  const since = options.sinceDays
    ? new Date(now.getTime() - options.sinceDays * 86_400_000)
    : null;

  const existing = (await db.execute(sql`
    select fleet_id, to_char(day, 'YYYY-MM-DD') as day, driver_id
      from earnings_daily
     where true
       ${options.fleetId ? sql`and fleet_id = ${options.fleetId}::uuid` : sql``}
       ${since ? sql`and day >= (${since.toISOString()}::timestamptz at time zone 'Asia/Kolkata')::date` : sql``}
  `)) as unknown as Array<{ fleet_id: string; day: string; driver_id: string }>;

  let deleted = 0;
  for (const row of existing) {
    if (live.has(`${row.fleet_id}|${row.day}|${row.driver_id}`)) continue;
    await projectCell(db, { fleetId: row.fleet_id, day: row.day, driverId: row.driver_id });
    deleted += 1;
  }

  return { cells, deleted };
}

export interface ProjectionDrift {
  key: EarningsGrainKey;
  projectedGross: string;
  ledgerGross: string;
}

/**
 * Cells whose numbers disagree with the ledger — the nightly audit's fourth
 * check. Each one is re-enqueued for projection, so the projection is
 * self-healing rather than merely observed.
 */
export async function projectionDrift(
  db: ProjectorDatabase,
  options: { sinceDays?: number; now?: Date } = {},
): Promise<ProjectionDrift[]> {
  const now = options.now ?? new Date();
  const since = new Date(now.getTime() - (options.sinceDays ?? 7) * 86_400_000);

  const rows = (await db.execute(sql`
    -- ONE ROW PER BOOKING before summing, exactly as \`projectCell\` groups
    -- its legs. A fleet trip settles as two legs (fleet share + driver share),
    -- and summing \`b.total\` once per leg made every fleet trip read as double
    -- its projection: a false drift on each one, found 24 Sep.
    with per_booking as (
      select b.id,
             b.fleet_id,
             ${IST_DAY} as day,
             b.driver_id,
             b.total
        from wallet_transactions t
        join bookings b on b.id = t.ref_id
       where t.type in ${EARNING_TYPES}
         and b.fleet_id is not null
         and b.driver_id is not null
         and t.created_at >= ${since.toISOString()}::timestamptz
       group by b.id, b.fleet_id, day, b.driver_id, b.total
    ),
    truth as (
      select fleet_id, day, driver_id, sum(total) as gross
        from per_booking
       group by 1, 2, 3
    )
    select coalesce(truth.fleet_id, e.fleet_id) as fleet_id,
           to_char(coalesce(truth.day, e.day), 'YYYY-MM-DD') as day,
           coalesce(truth.driver_id, e.driver_id) as driver_id,
           coalesce(e.gross, 0)::text as projected_gross,
           coalesce(truth.gross, 0)::text as ledger_gross
      from truth
      full outer join earnings_daily e
        on e.fleet_id = truth.fleet_id and e.day = truth.day and e.driver_id = truth.driver_id
     where coalesce(e.gross, 0) <> coalesce(truth.gross, 0)
       and coalesce(e.day, truth.day) >= (${since.toISOString()}::timestamptz at time zone 'Asia/Kolkata')::date
  `)) as unknown as Array<{
    fleet_id: string;
    day: string;
    driver_id: string;
    projected_gross: string;
    ledger_gross: string;
  }>;

  return rows.map((row) => ({
    key: { fleetId: row.fleet_id, day: row.day, driverId: row.driver_id },
    projectedGross: row.projected_gross,
    ledgerGross: row.ledger_gross,
  }));
}

/** Grain key for a ledger row's booking — what `LedgerService` enqueues after commit. */
export async function grainKeysForBookings(
  db: ProjectorDatabase,
  bookingIds: readonly string[],
): Promise<EarningsGrainKey[]> {
  if (bookingIds.length === 0) return [];

  // Parameterised list, never string-interpolated: these ids reach us from a
  // ledger leg's `refId`, which a caller ultimately supplies.
  const idList = sql.join(
    bookingIds.map((id) => sql`${id}::uuid`),
    sql`, `,
  );

  const rows = (await db.execute(sql`
    select distinct
           b.fleet_id,
           to_char(${IST_DAY}, 'YYYY-MM-DD') as day,
           b.driver_id
      from wallet_transactions t
      join bookings b on b.id = t.ref_id
     where t.ref_id in (${idList})
       and t.type in ${EARNING_TYPES}
       and b.fleet_id is not null
       and b.driver_id is not null
  `)) as unknown as Array<{ fleet_id: string; day: string; driver_id: string }>;

  return rows.map((row) => ({ fleetId: row.fleet_id, day: row.day, driverId: row.driver_id }));
}
