import { JwtService } from '@nestjs/jwt';
import { eq, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { Redis } from 'ioredis';
import postgres from 'postgres';
import { io, type Socket } from 'socket.io-client';
import { PRESENCE_STALE_MS } from '@towing/api-contracts';
import { loadEnv, type Env } from '../config/env';
import { loadDotenv } from '../config/load-dotenv';
import * as schema from '../db/schema';
import { bookings, drivers, serviceZones, users } from '../db/schema';
import { driverGeoKey, driverHashKey } from '../redis/redis.constants';

/**
 * §11.10's acceptance criteria, MEASURED against a live backend.
 * `pnpm bench:tracking`.
 *
 * "p95 ping→customer-render latency ≤ 2s on healthy networks. Marker never
 * teleports across the screen for updates ≤ 10s apart. Stale/reconnecting states
 * appear at the thresholds above; resync after reconnect completes ≤ 3s."
 *
 * WHY A SCRIPT AND NOT A TEST, the same argument `bench-dispatch` makes: the
 * claim is about a system with a real Redis pub/sub hop, a real socket.io
 * adapter, a real `REALTIME_FLUSH_MS` batching window and real concurrency. The
 * suite runs with `QUEUE_ENABLED=false` and calls services directly, which is
 * right for proving the LOGIC and says nothing about the LATENCY.
 *
 * WHAT "CUSTOMER-RENDER" MEANS HERE, and the honest limit of this measurement.
 * It measures ping-accepted → `location:update` frame received by a subscribed
 * socket. It does NOT measure the pixel. There is no dev-client build for either
 * app, so nothing in this repo has ever drawn a marker on a device, and a bench
 * that claimed to measure render latency would be claiming to measure something
 * that does not exist yet. The remaining hop — frame → RN re-render → map draw —
 * is unmeasured, and §11.10 is therefore PARTIALLY verified. Said plainly rather
 * than rounded up.
 *
 * ⚠ Writes to whatever `DATABASE_URL` points at. Dev stack only.
 *
 * Prerequisites:
 *   pnpm db:reset
 *   pnpm backend            # REALTIME_ENABLED must be true (the default)
 *
 * Run it across TWO gateway processes against one Redis to prove the relay's
 * `.local` discipline — the Phase 5 rehearsal, and the case where a non-local
 * emit would deliver N copies per customer:
 *   PORT=4000 pnpm backend
 *   PORT=4001 pnpm backend
 *   PUBLIC_API_URL=http://localhost:4001 pnpm bench:tracking
 *
 * On Windows, free the ports with PowerShell first — bash `kill` does not kill
 * node processes started from an earlier shell, and a surviving gateway makes
 * the results read as a bug (Phase 5's note, learned the hard way):
 *   Get-NetTCPConnection -LocalPort 4000,4001 | Stop-Process -Id {OwningProcess} -Force
 */

interface BenchArgs {
  /** Concurrent tracked trips. Each gets a driver, a booking and a socket. */
  trips: number;
  /** Pings per driver. §11.3's on-job cadence is 3 s; this drives them faster. */
  pings: number;
  /** Milliseconds between pings. */
  intervalMs: number;
  seed: number;
}

const DEFAULTS: BenchArgs = {
  trips: 10,
  pings: 20,
  // Faster than §11.3's 3 s on purpose: the point is to measure the pipeline
  // under pressure, and a 3-second interval mostly measures the interval.
  intervalMs: 500,
  seed: 20_260_903,
};

const USAGE = [
  'bench-tracking — §11.10 ping→frame latency against a LIVE backend',
  '',
  '  pnpm db:reset && pnpm backend',
  '  pnpm bench:tracking [options]',
  '',
  `  --trips=N       concurrent tracked trips   (default ${DEFAULTS.trips})`,
  `  --pings=N       pings per driver           (default ${DEFAULTS.pings})`,
  `  --interval=MS   gap between pings          (default ${DEFAULTS.intervalMs})`,
  `  --seed=N        PRNG seed                  (default ${DEFAULTS.seed})`,
  '  --help',
].join('\n');

/** Bengaluru (§2 persona city), inside the seeded zone polygon. */
const CENTRE = { lat: 12.9716, lng: 77.5946 };
const METERS_PER_DEG_LAT = 111_320;

/** §11.10's budget: "p95 ping→customer-render latency ≤ 2s". */
const P95_BUDGET_MS = 2_000;
/** §11.10's resync bound: "resync after reconnect completes ≤ 3s". */
const RESYNC_BUDGET_MS = 3_000;
/** §11.10: "marker never teleports … for updates ≤ 10s apart". */
const TELEPORT_WINDOW_MS = 10_000;

function parseArgs(argv: readonly string[]): BenchArgs {
  const args = { ...DEFAULTS };
  for (const raw of argv) {
    const eqAt = raw.indexOf('=');
    const key = eqAt === -1 ? raw : raw.slice(0, eqAt);
    const value = eqAt === -1 ? undefined : Number(raw.slice(eqAt + 1));

    if (key === '--help') {
      console.log(USAGE);
      process.exit(0);
    }
    if (value === undefined || !Number.isFinite(value)) {
      throw new Error(`${key} expects a number — run with --help`);
    }

    if (key === '--trips') args.trips = value;
    else if (key === '--pings') args.pings = value;
    else if (key === '--interval') args.intervalMs = value;
    else if (key === '--seed') args.seed = value;
    else throw new Error(`unknown argument "${raw}" — run with --help`);
  }
  return args;
}

/** mulberry32 — a fixed seed makes two runs comparable. */
function createRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN;
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, index)]!;
}

function metresBetween(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 6_371_008.8;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLng / 2) ** 2 * Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat));
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

function tokens(env: Env) {
  const jwt = new JwtService({ secret: env.JWT_ACCESS_SECRET });
  return {
    customer: (userId: string) =>
      jwt.signAsync({ sub: userId, role: 'customer' }, { expiresIn: env.JWT_ACCESS_TTL_SECONDS }),
    driver: (driverId: string) =>
      jwt.signAsync(
        { sub: driverId, role: 'driver', kyc_status: 'approved' },
        { expiresIn: env.JWT_ACCESS_TTL_SECONDS },
      ),
  };
}

interface Trip {
  bookingId: string;
  driverId: string;
  userId: string;
  socket: Socket;
  /**
   * Resolves when this socket has been roomed.
   *
   * ATTACHED AT CREATION, NOT AFTER THE SETUP LOOP. `realtime:ready` is emitted
   * from `handleConnection`, which on localhost fires in single-digit
   * milliseconds — long before a loop doing per-trip database inserts reaches
   * the end. Waiting for it afterwards misses the event entirely and times out
   * against a socket that is perfectly healthy. (Found by running this.)
   */
  ready: Promise<void>;
  /** Frames received, in arrival order. */
  frames: { lat: number; lng: number; at: string; receivedAt: number }[];
  /** How many times each ping's `at` was delivered — duplicates are the N-copies bug. */
  seen: Map<string, number>;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  loadDotenv();
  const env = loadEnv();
  const rng = createRng(args.seed);
  const sign = tokens(env);
  const api = env.PUBLIC_API_URL;

  const client = postgres(env.DATABASE_URL, { max: 10, prepare: false, onnotice: () => {} });
  const db = drizzle(client, { schema });
  const redis = new Redis(env.REDIS_URL);
  redis.on('error', (error: Error) => console.error('[bench] redis:', error.message));

  const health = await fetch(`${api}/v1/health`).catch(() => null);
  if (!health?.ok) {
    console.error(`[bench] no backend at ${api} — start it with \`pnpm backend\``);
    process.exit(1);
  }

  const [zone] = await db
    .select({ id: serviceZones.id })
    .from(serviceZones)
    .where(eq(serviceZones.isActive, true))
    .limit(1);
  if (!zone) {
    console.error('[bench] no active service zone — run `pnpm db:reset` first');
    process.exit(1);
  }

  console.log(`[bench] ${args.trips} trips × ${args.pings} pings @ ${args.intervalMs}ms`);

  /**
   * A per-RUN mobile prefix, not a per-seed one.
   *
   * `mobile` is globally unique on both `drivers` and `users`, and a
   * seed-derived number collides with itself the moment the bench is run twice —
   * including after a run that crashed before its cleanup and left rows behind.
   * The seed still governs the geometry, which is what `--seed` is actually for;
   * identities just need to be distinct. (Found by running this.)
   */
  const runTag = Date.now() % 100_000;

  // ── Set up: a driver, a customer, an ASSIGNED booking and a socket each ───
  const trips: Trip[] = [];

  for (let i = 0; i < args.trips; i += 1) {
    const [driver] = await db
      .insert(drivers)
      .values({
        mobile: `9${String(runTag).padStart(5, "0")}${String(i).padStart(4, "0")}`,
        name: `Bench Driver ${i}`,
        kycStatus: 'approved',
        isOnline: true,
        vehicleClass: 'flatbed',
      })
      .returning({ id: drivers.id });

    const [user] = await db
      .insert(users)
      .values({
        mobile: `8${String(runTag).padStart(5, "0")}${String(i).padStart(4, "0")}`,
        name: `Bench Customer ${i}`,
      })
      .returning({ id: users.id });

    const start = {
      lat: CENTRE.lat + ((rng() * 2 - 1) * 2_000) / METERS_PER_DEG_LAT,
      lng: CENTRE.lng + ((rng() * 2 - 1) * 2_000) / METERS_PER_DEG_LAT,
    };

    const [booking] = await db
      .insert(bookings)
      .values({
        userId: user!.id,
        driverId: driver!.id,
        zoneId: zone.id,
        serviceType: 'tow',
        vehicleClass: 'flatbed',
        pickupLat: CENTRE.lat,
        pickupLng: CENTRE.lng,
        pickupAddress: 'Bench pickup',
        // ASSIGNED, so the relay's `activeBookingForDriver` finds it.
        status: 'assigned',
        total: '1200.00',
        commissionBand: 'A',
        commissionPct: '10.00',
      })
      .returning({ id: bookings.id });

    // The candidate-store identity the ping Lua reads. Written directly rather
    // than through go-online, because this bench is about the fan-out and not
    // about §3.1's gate.
    await redis.hset(driverHashKey(driver!.id), {
      zoneId: zone.id,
      fleetId: '',
      truckId: '',
      vehicleClass: 'flatbed',
      longDistance: '0',
    });
    await redis.geoadd(driverGeoKey(zone.id), start.lng, start.lat, driver!.id);

    // The customer socket, through the real ticket route.
    const customerToken = await sign.customer(user!.id);
    const ticketResponse = await fetch(`${api}/v1/bookings/${booking!.id}/realtime/ticket`, {
      method: 'POST',
      headers: { authorization: `Bearer ${customerToken}` },
    });
    if (!ticketResponse.ok) {
      console.error(`[bench] ticket refused (${ticketResponse.status}) — is REALTIME_ENABLED on?`);
      process.exit(1);
    }
    const ticket = (await ticketResponse.json()) as {
      ticket: string;
      wsUrl: string;
      namespace: string;
    };

    const socket = io(`${ticket.wsUrl}${ticket.namespace}`, {
      transports: ['websocket'],
      auth: { ticket: ticket.ticket },
      reconnection: false,
    });

    const ready = new Promise<void>((resolve, reject) => {
      socket.once('realtime:ready', () => resolve());
      socket.once('connect_error', (error: Error) => reject(error));
      setTimeout(() => reject(new Error('socket did not become ready')), 15_000);
    });

    const trip: Trip = {
      bookingId: booking!.id,
      driverId: driver!.id,
      userId: user!.id,
      socket,
      ready,
      frames: [],
      seen: new Map(),
    };

    socket.on('location:update', (frame: { lat: number; lng: number; at: string }) => {
      trip.frames.push({ ...frame, receivedAt: Date.now() });
      trip.seen.set(frame.at, (trip.seen.get(frame.at) ?? 0) + 1);
    });

    trips.push(trip);
  }

  await Promise.all(trips.map((trip) => trip.ready));
  console.log(`[bench] ${trips.length} customer sockets attached`);

  // ── Drive: each driver walks toward the pickup, one ping per interval ─────
  const sentAt = new Map<string, number>();
  let seq = 0;

  for (let step = 0; step < args.pings; step += 1) {
    seq += 1;
    const at = new Date().toISOString();

    await Promise.all(
      trips.map(async (trip, index) => {
        const progress = (step + 1) / args.pings;
        const lat = CENTRE.lat + ((1 - progress) * (index + 1) * 60) / METERS_PER_DEG_LAT;
        const lng = CENTRE.lng + ((1 - progress) * (index + 1) * 60) / METERS_PER_DEG_LAT;

        const token = await sign.driver(trip.driverId);
        sentAt.set(`${trip.driverId}:${at}`, Date.now());

        await fetch(`${api}/v1/driver/location`, {
          method: 'POST',
          headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
          body: JSON.stringify({
            pings: [{ seq, lat, lng, at, headingDeg: 45, speedKph: 24, accuracyM: 8 }],
          }),
        }).catch(() => undefined);
      }),
    );

    await new Promise((resolve) => setTimeout(resolve, args.intervalMs));
  }

  // One flush window plus slack, so the last batch lands before we measure.
  await new Promise((resolve) => setTimeout(resolve, env.REALTIME_FLUSH_MS + 1_500));

  // ── §11.10: resync after reconnect ───────────────────────────────────────
  const probe = trips[0]!;
  probe.socket.disconnect();
  const reconnectStart = Date.now();

  const probeToken = await sign.customer(probe.userId);
  const resyncResponse = await fetch(`${api}/v1/bookings/${probe.bookingId}/tracking`, {
    headers: { authorization: `Bearer ${probeToken}` },
  });
  const resyncMs = Date.now() - reconnectStart;
  const resynced = (await resyncResponse.json()) as { position: { lat: number } | null };

  // ── Measure ──────────────────────────────────────────────────────────────
  const latencies: number[] = [];
  let duplicates = 0;
  let teleports = 0;
  let delivered = 0;

  for (const trip of trips) {
    for (const frame of trip.frames) {
      const sent = sentAt.get(`${trip.driverId}:${frame.at}`);
      if (sent !== undefined) latencies.push(frame.receivedAt - sent);
      delivered += 1;
    }
    for (const count of trip.seen.values()) if (count > 1) duplicates += count - 1;

    // §11.10's teleport rule, applied to what a client would actually animate.
    for (let i = 1; i < trip.frames.length; i += 1) {
      const previous = trip.frames[i - 1]!;
      const current = trip.frames[i]!;
      const gapMs = Date.parse(current.at) - Date.parse(previous.at);
      if (gapMs > TELEPORT_WINDOW_MS) continue;
      // 0.25° is `TELEPORT_DEG` — the threshold beyond which the shared
      // interpolator snaps rather than glides, i.e. what a customer sees as a
      // teleport.
      if (metresBetween(previous, current) > 0.25 * METERS_PER_DEG_LAT) teleports += 1;
    }
  }

  latencies.sort((a, b) => a - b);
  const expected = trips.length * args.pings;

  /**
   * FRAMES ARE FEWER THAN PINGS BY DESIGN, and the first version of this output
   * labelled the ratio "delivered N/M (66.7%)" — which reads as a third of the
   * stream being lost. It is not: `TrackingRelayService` coalesces to at most one
   * frame per booking per `REALTIME_FLUSH_MS`, exactly as the fleet relay does,
   * because §11.4 animates the marker over ~1 s and three frames inside that
   * window buy nothing and cost three payloads on a mobile connection.
   *
   * So the honest figures are the ratio AND the expected floor. Loss would show
   * as frames below the flush-window floor, or as a trip receiving none at all.
   */
  const floor = Math.floor((args.pings * args.intervalMs) / env.REALTIME_FLUSH_MS);
  const silentTrips = trips.filter((trip) => trip.frames.length === 0).length;

  console.log('');
  console.log('  §11.10 — ping → customer frame');
  console.log(
    `    frames         ${delivered} from ${expected} pings — coalesced at ${env.REALTIME_FLUSH_MS}ms, floor ~${floor * trips.length}`,
  );
  console.log(`    silent trips   ${silentTrips}   (must be 0 — a trip with no frames IS loss)`);
  console.log(`    p50            ${percentile(latencies, 50)} ms`);
  console.log(`    p95            ${percentile(latencies, 95)} ms   (budget ${P95_BUDGET_MS})`);
  console.log(`    p99            ${percentile(latencies, 99)} ms`);
  console.log(`    duplicates     ${duplicates}   (must be 0 — a non-.local emit gives N copies)`);
  console.log(`    teleports      ${teleports}   (must be 0 for gaps ≤ ${TELEPORT_WINDOW_MS / 1000}s)`);
  console.log('');
  console.log('  §11.10 — resync after reconnect');
  console.log(`    REST resync    ${resyncMs} ms   (budget ${RESYNC_BUDGET_MS})`);
  console.log(`    carried a fix  ${resynced.position !== null ? 'yes' : 'no'}`);
  console.log('');
  console.log(`  §11.6 staleness threshold in use: ${PRESENCE_STALE_MS} ms`);
  console.log('');

  const p95 = percentile(latencies, 95);
  const failures: string[] = [];
  if (!(p95 <= P95_BUDGET_MS)) failures.push(`p95 ${p95}ms exceeds ${P95_BUDGET_MS}ms`);
  if (duplicates > 0) failures.push(`${duplicates} duplicate frames`);
  if (teleports > 0) failures.push(`${teleports} teleports`);
  if (resyncMs > RESYNC_BUDGET_MS) failures.push(`resync ${resyncMs}ms exceeds ${RESYNC_BUDGET_MS}ms`);
  if (silentTrips > 0) failures.push(`${silentTrips} trips received no frames at all`);

  // ── Clean up ─────────────────────────────────────────────────────────────
  for (const trip of trips) trip.socket.disconnect();
  const driverIds = trips.map((trip) => trip.driverId);
  await db.delete(bookings).where(inArray(bookings.driverId, driverIds));
  await db.delete(drivers).where(inArray(drivers.id, driverIds));
  await db.delete(users).where(
    inArray(users.id, trips.map((trip) => trip.userId)),
  );
  await redis.quit();
  await client.end();

  if (failures.length > 0) {
    console.error(`[bench] FAILED — ${failures.join('; ')}`);
    process.exit(1);
  }
  console.log('[bench] all §11.10 budgets met');
}

void main().catch((error: unknown) => {
  console.error('[bench] failed:', error);
  process.exit(1);
});
