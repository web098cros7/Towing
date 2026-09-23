import type { Database } from '../../db/db.module';
import { purgeWaveLogs, writeDay } from './analytics-rollup';

const IST_MS = 5.5 * 3_600_000;
const DAY_MS = 86_400_000;

/** Yesterday in IST: the newest closed day. */
function yesterdayIST(now: Date): string {
  return new Date(now.getTime() - DAY_MS + IST_MS).toISOString().slice(0, 10);
}

function addDays(day: string, delta: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + delta * DAY_MS).toISOString().slice(0, 10);
}

/**
 * Rewrite W17's rollups for the trailing `days` closed IST days, oldest first,
 * through the SAME `writeDay` the nightly cron owns, then the cron's
 * `purgeWaveLogs`. Idempotent: `writeDay` replaces a day's rows in one
 * transaction. Today is skipped because the read side computes today live.
 *
 * Used by `pnpm analytics:backfill` and by `pnpm db:seed`, which would
 * otherwise leave 90 days of seeded bookings with no rollup rows and every
 * analytics screen at zero until a nightly run.
 */
export async function backfillRollups(
  db: Database,
  days: number,
  now: Date,
  onProgress?: (done: number, day: string) => void,
): Promise<{ start: string; end: string; purged: number }> {
  const end = yesterdayIST(now);
  const start = addDays(end, -(days - 1));
  for (let i = 0; i < days; i++) {
    const day = addDays(start, i);
    await writeDay(db, day);
    onProgress?.(i + 1, day);
  }
  const purged = await purgeWaveLogs(db);
  return { start, end, purged };
}
