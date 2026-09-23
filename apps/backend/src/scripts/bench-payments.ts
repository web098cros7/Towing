import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'node:crypto';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { loadEnv, type Env } from '../config/env';
import { loadDotenv } from '../config/load-dotenv';
import { ledgerInvariants } from '../db/ledger/invariants';
import * as schema from '../db/schema';
import { bookings, drivers, payments, users, walletTransactions } from '../db/schema';

/**
 * Payments under load, MEASURED against a live backend. `pnpm bench:payments`.
 *
 * Dispatch has had `bench:dispatch` since Phase 17 and payments had nothing,
 * although payments is where a concurrency bug costs real money. This drives
 * the path the customer app drives, for many customers at once:
 *
 *   POST /v1/payments/:id/intent   (purpose: booking)
 *   POST /v1/payments/:id/capture  (the dev gateway's checkout, sent TWICE at
 *                                   the same instant, the way a phone on a bad
 *                                   network resubmits)
 *
 * and then checks the two things that decide whether it is safe:
 *
 * 1. LATENCY against spec §19's API target, p95 < 200 ms and p99 < 500 ms.
 * 2. CORRECTNESS: every booking captured exactly once and settled exactly once
 *    (one set of credit legs, whatever the duplicates did), and the five ledger
 *    invariants all zero afterwards. A benchmark that only timed requests
 *    would pass happily while double-paying drivers.
 *
 * WHY A SCRIPT AND NOT A TEST, as for dispatch: the suite proves the logic
 * with an in-process app; this measures a real server with real connection
 * pools and real contention on the same rows.
 *
 * ⚠ Writes to whatever `DATABASE_URL` points at. Dev stack only.
 *
 * Prerequisites:
 *   pnpm db:reset            # seeded drivers
 *   pnpm backend             # the dev payment gateway (no Razorpay account)
 */

interface BenchArgs {
  bookings: number;
  duplicate: boolean;
  seed: number;
}

const DEFAULTS: BenchArgs = { bookings: 50, duplicate: true, seed: 20_260_924 };

const USAGE = [
  'bench-payments — intent + capture under load against a LIVE backend',
  '',
  '  pnpm db:reset && pnpm backend',
  '  pnpm bench:payments [options]',
  '',
  `  --bookings=N       customers paying at once     (default ${DEFAULTS.bookings})`,
  '  --no-duplicate     send each capture once instead of twice concurrently',
  `  --seed=N           customer mobile seed         (default ${DEFAULTS.seed})`,
  '  --help',
].join('\n');

/** Spec §19: p95 < 200 ms, p99 < 500 ms for the API. */
const P95_TARGET_MS = 200;
const P99_TARGET_MS = 500;

function parseArgs(argv: readonly string[]): BenchArgs {
  const args = { ...DEFAULTS };
  for (const raw of argv) {
    const eqAt = raw.indexOf('=');
    const key = eqAt === -1 ? raw : raw.slice(0, eqAt);
    const value = eqAt === -1 ? undefined : Number(raw.slice(eqAt + 1));
    if (key === '--help') {
      console.log(USAGE);
      process.exit(0);
    } else if (key === '--no-duplicate') {
      args.duplicate = false;
    } else if (key === '--bookings' && value && value > 0) {
      args.bookings = Math.floor(value);
    } else if (key === '--seed' && value) {
      args.seed = Math.floor(value);
    } else {
      console.error(`[bench] unknown or invalid option: ${raw}\n\n${USAGE}`);
      process.exit(1);
    }
  }
  return args;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN;
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, index)]!;
}

function customerToken(env: Env): (userId: string) => Promise<string> {
  const jwt = new JwtService({ secret: env.JWT_ACCESS_SECRET });
  return (userId) =>
    jwt.signAsync({ sub: userId, role: 'customer' }, { expiresIn: env.JWT_ACCESS_TTL_SECONDS });
}

interface Timed<T> {
  ms: number;
  status: number;
  body: T;
}

/**
 * A request that could not be made at all (refused, reset) comes back as
 * status 0 with its cause, so one bad socket is counted and reported instead
 * of ending the run.
 */
async function timed<T>(url: string, init: RequestInit): Promise<Timed<T> & { cause?: string }> {
  const started = performance.now();
  try {
    const res = await fetch(url, init);
    const body = (await res.json().catch(() => null)) as T;
    return { ms: performance.now() - started, status: res.status, body };
  } catch (error) {
    const cause = (error as { cause?: { code?: string; message?: string } }).cause;
    return {
      ms: performance.now() - started,
      status: 0,
      body: null as T,
      cause: cause?.code ?? cause?.message ?? String(error),
    };
  }
}

interface IntentBody {
  orderRef: string;
  autoSettles?: boolean;
  devCheckout?: { gatewayRef: string; signature: string } | null;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  loadDotenv();
  const env = loadEnv();
  const api = env.PUBLIC_API_URL;
  const sign = customerToken(env);

  const client = postgres(env.DATABASE_URL, { max: 10, prepare: false, onnotice: () => {} });
  const db = drizzle(client, { schema });

  const health = await fetch(`${api}/v1/health`).catch(() => null);
  if (!health?.ok) {
    console.error(`[bench] no backend at ${api} — start it with \`pnpm backend\``);
    process.exit(1);
  }

  const roster = await db
    .select({ id: drivers.id, fleetId: drivers.fleetId })
    .from(drivers)
    .where(eq(drivers.kycStatus, 'approved'))
    .orderBy(drivers.id)
    .limit(10);
  if (roster.length === 0) {
    console.error('[bench] no approved drivers — run `pnpm db:reset` first');
    process.exit(1);
  }

  // Fresh customers, for the reason bench:dispatch gives: seeded ones carry
  // unpaid trips, and the §3.8 guards would (correctly) refuse them.
  const customers = await db
    .insert(users)
    .values(
      Array.from({ length: args.bookings }, (_, i) => ({
        mobile: `+9188${String(args.seed).slice(-4)}${String(i).padStart(4, '0')}`,
        name: `Bench Payer ${i + 1}`,
      })),
    )
    .onConflictDoNothing()
    .returning({ id: users.id });
  if (customers.length < args.bookings) {
    console.error(
      `[bench] only created ${customers.length}/${args.bookings} customers — ` +
        'a previous run with this seed left rows behind; pass a different --seed',
    );
    process.exit(1);
  }

  // A completed trip each, with the money locked the way confirm locks it:
  // ₹1,500 at band A, 10 % commission.
  const trips = await db
    .insert(bookings)
    .values(
      customers.map((customer, i) => {
        const driver = roster[i % roster.length]!;
        return {
          userId: customer.id,
          driverId: driver.id,
          fleetId: driver.fleetId,
          serviceType: 'tow' as const,
          vehicleClass: 'flatbed' as const,
          pickupLat: 12.9716,
          pickupLng: 77.5946,
          pickupAddress: 'MG Road, Bengaluru',
          status: 'completed' as const,
          total: '1500.00',
          commissionBand: 'A' as const,
          commissionPct: '10.00',
        };
      }),
    )
    .returning({ id: bookings.id, userId: bookings.userId });

  console.log('[bench] payments under load');
  console.log(`[bench]   customers    ${trips.length} paying at once`);
  console.log(`[bench]   duplicates   ${args.duplicate ? 'each capture sent twice, concurrently' : 'off'}`);
  console.log('');

  const intentMs: number[] = [];
  const captureMs: number[] = [];
  const failures: string[] = [];

  await Promise.all(
    trips.map(async (trip) => {
      const auth = `Bearer ${await sign(trip.userId)}`;
      const intent = await timed<IntentBody>(`${api}/v1/payments/${trip.id}/intent`, {
        method: 'POST',
        headers: {
          Authorization: auth,
          'Content-Type': 'application/json',
          'Idempotency-Key': randomUUID(),
        },
        body: JSON.stringify({ purpose: 'booking' }),
      });
      intentMs.push(intent.ms);
      if (intent.status !== 201 || !intent.body?.devCheckout) {
        failures.push(`${trip.id}: intent ${intent.status}${intent.cause ? ` (${intent.cause})` : ''}`);
        return;
      }

      const body = JSON.stringify({
        orderRef: intent.body.orderRef,
        gatewayRef: intent.body.devCheckout.gatewayRef,
        signature: intent.body.devCheckout.signature,
      });
      const key = randomUUID();
      const capture = () =>
        timed<{ status?: string }>(`${api}/v1/payments/${trip.id}/capture`, {
          method: 'POST',
          headers: { Authorization: auth, 'Content-Type': 'application/json', 'Idempotency-Key': key },
          body,
        });
      const results = await Promise.all(args.duplicate ? [capture(), capture()] : [capture()]);
      for (const result of results) {
        captureMs.push(result.ms);
        if (result.status >= 500 || result.status === 0) {
          failures.push(`${trip.id}: capture ${result.status}${result.cause ? ` (${result.cause})` : ''}`);
        }
      }
    }),
  );

  // --- correctness: exactly once, whatever the duplicates did ---------------
  const ids = trips.map((trip) => trip.id);
  const captured = await db
    .select({ bookingId: payments.bookingId, n: sql<number>`count(*)::int` })
    .from(payments)
    .where(
      and(
        inArray(payments.bookingId, ids),
        eq(payments.purpose, 'booking'),
        inArray(payments.status, ['captured', 'refunded']),
      ),
    )
    .groupBy(payments.bookingId);
  const settledLegs = await db
    .select({ refId: walletTransactions.refId, n: sql<number>`count(*)::int` })
    .from(walletTransactions)
    .where(
      and(
        inArray(walletTransactions.refId, ids),
        inArray(walletTransactions.type, ['driver_share_credit', 'fleet_share_credit', 'fare_credit']),
      ),
    )
    .groupBy(walletTransactions.refId);

  const capturedOnce = captured.filter((row) => row.n === 1).length;
  const capturedTwice = captured.filter((row) => row.n > 1).length;
  // An independent driver's trip settles as ONE fare_credit; a fleet trip as
  // a fleet share and a driver share. Anything above two is a double settle.
  const doubleSettled = settledLegs.filter((row) => row.n > 2).length;
  const invariants = await ledgerInvariants(db);
  const drift = Object.values(invariants).some((value) => value !== 0);

  const report = (label: string, samples: number[]) => {
    const sorted = [...samples].sort((a, b) => a - b);
    const p50 = percentile(sorted, 50);
    const p95 = percentile(sorted, 95);
    const p99 = percentile(sorted, 99);
    const verdict = p95 < P95_TARGET_MS && p99 < P99_TARGET_MS ? 'OK' : 'OVER TARGET';
    console.log(
      `[bench]   ${label.padEnd(8)} n=${String(sorted.length).padStart(4)}  ` +
        `p50 ${p50.toFixed(0)} ms  p95 ${p95.toFixed(0)} ms  p99 ${p99.toFixed(0)} ms  ${verdict}`,
    );
    return verdict === 'OK';
  };

  console.log('[bench] latency (spec §19: p95 < 200 ms, p99 < 500 ms)');
  const intentOk = report('intent', intentMs);
  const captureOk = report('capture', captureMs);
  console.log('');
  console.log('[bench] correctness');
  console.log(`[bench]   captured exactly once   ${capturedOnce}/${trips.length}`);
  console.log(`[bench]   captured more than once ${capturedTwice}`);
  console.log(`[bench]   settled more than once  ${doubleSettled}`);
  console.log(`[bench]   ledger invariants       ${drift ? `DRIFT ${JSON.stringify(invariants)}` : 'all zero'}`);
  console.log(`[bench]   server errors (5xx)     ${failures.length}`);
  for (const failure of failures.slice(0, 10)) console.log(`[bench]     ${failure}`);

  const correct =
    capturedOnce === trips.length && capturedTwice === 0 && doubleSettled === 0 && !drift && failures.length === 0;
  console.log('');
  console.log(
    `[bench] ${correct ? 'CORRECT' : 'INCORRECT'} · latency ${intentOk && captureOk ? 'within target' : 'over target'}`,
  );

  await client.end();
  // Correctness failing is a bug; latency over target on a laptop is a finding.
  process.exit(correct ? 0 : 1);
}

void main().catch((error: unknown) => {
  console.error('[bench] failed:', error);
  process.exit(1);
});
