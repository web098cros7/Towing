import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { loadEnv } from '../config/env';
import { loadDotenv } from '../config/load-dotenv';
import * as schema from '../db/schema';
import { purgeWaveLogs, writeDay } from '../modules/analytics/analytics-rollup';

/**
 * Backfill W17's rollup tables from domain history. `pnpm analytics:backfill`.
 *
 * WHY A SCRIPT AND NOT 90 MANUAL ROLLUPS. The nightly cron writes one closed
 * day per run and the manual `POST /v1/admin/analytics/rollup` replays one day
 * per call — both correct, both one day at a time. A fresh local checkout (or
 * any environment whose cron never ran) has 90 days of seeded bookings and
 * zero rollup rows, so every trend screen renders its empty state. This drives
 * the SAME `writeDay` the cron owns over the trailing closed days, oldest
 * first, then the same `purgeWaveLogs` the cron ends with.
 *
 * IDEMPOTENT BY CONSTRUCTION. `writeDay` deletes the day's rows and inserts
 * the recomputed set inside one transaction (`analytics.e2e.spec.ts` pins
 * "run twice, identical rows"), so re-running this after a real nightly run
 * changes nothing — closed days recompute byte-identical.
 *
 * TODAY IS SKIPPED ON PURPOSE. The read side serves today live
 * (`analytics.service.ts`: rollups for closed days + live compute for today),
 * so writing a partial-day row would be overwritten at midnight anyway — and
 * a half-day row sitting beside live numbers is how dashboards start lying.
 *
 * ⚠ Writes to whatever `DATABASE_URL` points at. Dev stack only: refuses
 * `NODE_ENV=production` like `db:seed` does.
 */

const IST_MS = 5.5 * 3_600_000;
const DAY_MS = 86_400_000;

const DEFAULT_DAYS = 90;

const USAGE = [
  'backfill-analytics — recompute W17 rollups for the trailing closed days',
  '',
  '  pnpm analytics:backfill [--days=N]',
  '',
  `  --days=N   closed IST days to recompute, ending yesterday (default ${DEFAULT_DAYS})`,
  '  --help     this text',
].join('\n');

function parseArgs(argv: readonly string[]): number {
  let days = DEFAULT_DAYS;
  for (const raw of argv) {
    if (raw === '--help') {
      console.log(USAGE);
      process.exit(0);
    }
    const match = /^--days=(\d+)$/.exec(raw);
    if (!match) throw new Error(`unknown argument "${raw}" — run with --help`);
    days = Number(match[1]);
    if (!Number.isInteger(days) || days < 1 || days > 365) {
      throw new Error(`--days must be 1..365, got "${match[1]}"`);
    }
  }
  return days;
}

/** Yesterday in IST — the newest closed day. */
function yesterdayIST(now: Date): string {
  return new Date(now.getTime() - DAY_MS + IST_MS).toISOString().slice(0, 10);
}

function addDays(day: string, delta: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + delta * DAY_MS).toISOString().slice(0, 10);
}

async function main(): Promise<void> {
  const days = parseArgs(process.argv.slice(2));
  loadDotenv();
  const env = loadEnv();
  if (env.NODE_ENV === 'production') {
    throw new Error('analytics:backfill refuses to run with NODE_ENV=production');
  }

  const client = postgres(env.DATABASE_URL, { max: 5, prepare: false, onnotice: () => {} });
  const db = drizzle(client, { schema });

  const end = yesterdayIST(new Date());
  const start = addDays(end, -(days - 1));
  console.log(`[backfill] recomputing ${days} closed day(s): ${start}..${end}`);

  const started = Date.now();
  for (let i = 0; i < days; i++) {
    const day = addDays(start, i);
    await writeDay(db, day);
    if ((i + 1) % 10 === 0 || i === days - 1) {
      console.log(`[backfill] ${i + 1}/${days} — through ${day}`);
    }
  }

  const purged = await purgeWaveLogs(db);
  console.log(
    `[backfill] done in ${((Date.now() - started) / 1000).toFixed(1)}s; ` +
      `purged ${purged} dispatch_wave_logs row(s) > 30d`,
  );
  await client.end();
}

main().catch((error: unknown) => {
  console.error(`[backfill] failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
