// §6.1 excludes a driver whose last ping is older than 15s; the hash TTL sits at
// 30s so a stale-but-recent truck is still *visible* to ops tooling while already
// being invisible to the matcher. Imported rather than redeclared so the gateway's
// presence maths and this writer cannot disagree.
import { TRUCK_HASH_TTL_MS } from '@towing/api-contracts';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { Redis } from 'ioredis';
import postgres from 'postgres';
import { loadEnv } from '../config/env';
import { loadDotenv } from '../config/load-dotenv';
import type { LatLng } from '../db/geography';
import * as schema from '../db/schema';
import { bookingStatusEnum, bookingStatusHistory, bookings, fleetTrucks } from '../db/schema';
// Sharing the channel and key constants is what stops the simulator and the real
// ping path from drifting; they come from the constants file rather than
// RedisModule (which re-exports them) so a tsx script does not pull in the Nest
// module graph.
import {
  FLEET_EVENTS_CHANNEL,
  LOCATION_CHANNEL,
  truckGeoKey,
  truckHashKey,
} from '../redis/redis.constants';

/**
 * Fake GPS for a seeded database. Run with `pnpm sim:locations`.
 *
 * Exists so the fleet console's live map, jobs feed and KPI tiles can be built
 * and demoed before a single MiTow Driver handset streams a real ping (§11.2).
 */

interface SimArgs {
  trucks: number;
  intervalMs: number;
  dbIntervalMs: number;
  bookingIntervalMs: number;
  roamKm: number;
  seed: number;
  durationSec: number;
  advanceBookings: boolean;
}

const DEFAULTS: SimArgs = {
  trucks: 25,
  intervalMs: 1_000,
  dbIntervalMs: 10_000,
  bookingIntervalMs: 12_000,
  roamKm: 5,
  seed: 1337,
  durationSec: 0,
  advanceBookings: true,
};

const USAGE = [
  'simulate-locations — drives seeded fleet trucks and streams pings (§11.2)',
  '',
  '  pnpm sim:locations [options]',
  '',
  `  --trucks=N             trucks to drive             (default ${DEFAULTS.trucks})`,
  `  --interval=MS          ping cadence per truck      (default ${DEFAULTS.intervalMs})`,
  `  --db-interval=MS       Postgres flush cadence      (default ${DEFAULTS.dbIntervalMs})`,
  `  --booking-interval=MS  booking transition cadence  (default ${DEFAULTS.bookingIntervalMs})`,
  `  --roam=KM              leash radius from origin    (default ${DEFAULTS.roamKm})`,
  `  --seed=N               PRNG seed                   (default ${DEFAULTS.seed})`,
  '  --duration=SEC         stop after SEC seconds      (default: until Ctrl-C)',
  '  --no-bookings          leave booking statuses alone',
  '  --help',
].join('\n');

const MIN_SPEED_KPH = 20;
const MAX_SPEED_KPH = 50;
/** Per-tick speed and heading jitter — enough to look driven, not enough to teleport. */
const SPEED_DRIFT_KPH = 6;
const MAX_TURN_DEG = 12;

const METERS_PER_DEG_LAT = 111_320;

/** Bengaluru (§2 persona city). Only used for trucks the seed left without a location. */
const FALLBACK_ORIGIN: LatLng = { lat: 12.9716, lng: 77.5946 };
const FALLBACK_SPREAD_KM = 4;


type BookingStatus = (typeof bookingStatusEnum.enumValues)[number];

/**
 * §5.1 forward path. `completed → paid` is deliberately absent: that transition
 * belongs to payment capture and carries wallet/commission side effects the
 * simulator has no business faking.
 */
const NEXT_STATUS = {
  assigned: 'en_route',
  en_route: 'arrived',
  arrived: 'in_progress',
  in_progress: 'completed',
} as const satisfies Partial<Record<BookingStatus, BookingStatus>>;

type AdvanceableStatus = keyof typeof NEXT_STATUS;
const ADVANCEABLE = Object.keys(NEXT_STATUS) as AdvanceableStatus[];

interface TruckSim {
  id: string;
  fleetId: string;
  plate: string;
  origin: LatLng;
  lat: number;
  lng: number;
  headingDeg: number;
  speedKph: number;
  at: Date;
  /** Position has moved since the last Postgres flush. */
  dirty: boolean;
}

interface Stats {
  pings: number;
  flushes: number;
  rowsWritten: number;
  transitions: number;
  skippedTicks: number;
  errors: number;
}

function parseArgs(argv: readonly string[]): SimArgs {
  const args: SimArgs = { ...DEFAULTS };

  for (const raw of argv) {
    const eqAt = raw.indexOf('=');
    const key = eqAt === -1 ? raw : raw.slice(0, eqAt);
    const value = eqAt === -1 ? undefined : raw.slice(eqAt + 1);

    switch (key) {
      case '--help':
        console.log(USAGE);
        process.exit(0);
        break;
      case '--trucks':
        args.trucks = numeric(key, value, 1);
        break;
      case '--interval':
        args.intervalMs = numeric(key, value, 50);
        break;
      case '--db-interval':
        args.dbIntervalMs = numeric(key, value, 500);
        break;
      case '--booking-interval':
        args.bookingIntervalMs = numeric(key, value, 500);
        break;
      case '--roam':
        args.roamKm = numeric(key, value, 0.1);
        break;
      case '--seed':
        args.seed = numeric(key, value, 0);
        break;
      case '--duration':
        args.durationSec = numeric(key, value, 1);
        break;
      case '--no-bookings':
        args.advanceBookings = false;
        break;
      default:
        throw new Error(`unknown argument "${raw}" — run with --help`);
    }
  }

  return args;
}

function numeric(key: string, value: string | undefined, min: number): number {
  const parsed = Number(value);
  if (value === undefined || !Number.isFinite(parsed) || parsed < min) {
    throw new Error(`${key} expects a number >= ${min}, got "${value ?? ''}"`);
  }
  return parsed;
}

/**
 * mulberry32. A seeded PRNG (rather than Math.random) makes a run reproducible,
 * so "the truck jumped into a lake at t+40s" can be replayed with the same seed.
 */
function createRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

const toRad = (deg: number) => (deg * Math.PI) / 180;
const toDeg = (rad: number) => (rad * 180) / Math.PI;
const wrap360 = (deg: number) => ((deg % 360) + 360) % 360;
const round = (value: number, places: number) => Number(value.toFixed(places));

/**
 * Equirectangular metres. Over a few km of city driving the error against
 * haversine is centimetres — not worth the trig for a simulator.
 */
function metersBetween(a: LatLng, b: LatLng): number {
  const dLat = (b.lat - a.lat) * METERS_PER_DEG_LAT;
  const dLng = (b.lng - a.lng) * METERS_PER_DEG_LAT * Math.cos(toRad((a.lat + b.lat) / 2));
  return Math.hypot(dLat, dLng);
}

/** Compass bearing, 0° = north, 90° = east — the convention the payload's `heading` uses. */
function bearingDeg(from: LatLng, to: LatLng): number {
  const dLat = to.lat - from.lat;
  const dLng = (to.lng - from.lng) * Math.cos(toRad((from.lat + to.lat) / 2));
  return wrap360(toDeg(Math.atan2(dLng, dLat)));
}

/**
 * One tick of travel: wander the heading, drift the speed, then re-aim at the
 * origin once the truck reaches the end of its leash. Without the leash a
 * random walk over a long demo run marches steadily out to sea.
 */
function advanceTruck(truck: TruckSim, args: SimArgs, rng: () => number): void {
  const jitter = () => rng() * 2 - 1;

  truck.speedKph = Math.min(
    MAX_SPEED_KPH,
    Math.max(MIN_SPEED_KPH, truck.speedKph + jitter() * SPEED_DRIFT_KPH),
  );
  truck.headingDeg = wrap360(truck.headingDeg + jitter() * MAX_TURN_DEG);

  const meters = (truck.speedKph * 1000 * args.intervalMs) / 3_600_000;
  const heading = toRad(truck.headingDeg);

  truck.lat += (meters * Math.cos(heading)) / METERS_PER_DEG_LAT;
  truck.lng += (meters * Math.sin(heading)) / (METERS_PER_DEG_LAT * Math.cos(toRad(truck.lat)));

  if (metersBetween(truck, truck.origin) > args.roamKm * 1000) {
    truck.headingDeg = wrap360(bearingDeg(truck, truck.origin) + jitter() * 25);
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  loadDotenv();
  const env = loadEnv();
  const rng = createRng(args.seed);

  const client = postgres(env.DATABASE_URL, {
    // The simulator only ever has one flush and one booking transaction in
    // flight, so a wide pool would just hold idle connections open.
    max: 4,
    prepare: false,
    onnotice: () => {},
  });
  const db = drizzle(client, { schema });

  const stats: Stats = {
    pings: 0,
    flushes: 0,
    rowsWritten: 0,
    transitions: 0,
    skippedTicks: 0,
    errors: 0,
  };

  const redis = new Redis(env.REDIS_URL);
  // ioredis emits 'error' on the client; unhandled it takes the process down
  // mid-run, which is a miserable way to discover Redis restarted.
  redis.on('error', (error: Error) => {
    stats.errors += 1;
    console.error('[sim] redis:', error.message);
  });

  // Ordered by id so the same seed replays the same drive on the same database.
  const rows = await db
    .select({
      id: fleetTrucks.id,
      fleetId: fleetTrucks.fleetId,
      plate: fleetTrucks.plate,
      currentLocation: fleetTrucks.currentLocation,
    })
    .from(fleetTrucks)
    .where(eq(fleetTrucks.status, 'active'))
    .orderBy(fleetTrucks.id)
    .limit(args.trucks);

  if (rows.length === 0) {
    console.error('[sim] no active fleet_trucks found — run `pnpm db:seed` first');
    await redis.quit();
    await client.end({ timeout: 5 });
    process.exit(1);
  }

  const startedAt = Date.now();
  const fleet: TruckSim[] = rows.map((row) => {
    const spreadDeg = (FALLBACK_SPREAD_KM * 1000) / METERS_PER_DEG_LAT;
    const origin = row.currentLocation ?? {
      lat: FALLBACK_ORIGIN.lat + (rng() * 2 - 1) * spreadDeg,
      lng: FALLBACK_ORIGIN.lng + (rng() * 2 - 1) * spreadDeg,
    };

    return {
      id: row.id,
      fleetId: row.fleetId,
      plate: row.plate,
      origin,
      lat: origin.lat,
      lng: origin.lng,
      headingDeg: rng() * 360,
      speedKph: MIN_SPEED_KPH + rng() * (MAX_SPEED_KPH - MIN_SPEED_KPH),
      at: new Date(startedAt),
      dirty: false,
    };
  });

  const fleetIds = [...new Set(fleet.map((truck) => truck.fleetId))];

  console.log('[sim] simulate-locations starting');
  console.log(`[sim]   trucks     ${fleet.length} across ${fleetIds.length} fleet(s)`);
  console.log(`[sim]   postgres   ${new URL(env.DATABASE_URL).host} (flush every ${args.dbIntervalMs}ms)`);
  console.log(`[sim]   redis      ${new URL(env.REDIS_URL).host} → publish ${LOCATION_CHANNEL}, GEOADD ${truckGeoKey('{fleetId}')}`);
  console.log(`[sim]   cadence    1 ping / truck / ${args.intervalMs}ms  ·  roam leash ${args.roamKm}km  ·  seed ${args.seed}`);
  console.log(
    args.advanceBookings
      ? `[sim]   bookings   advancing §5.1 status every ${args.bookingIntervalMs}ms`
      : '[sim]   bookings   disabled (--no-bookings)',
  );

  async function publishTick(): Promise<void> {
    const at = new Date();
    const pipeline = redis.pipeline();

    for (const truck of fleet) {
      advanceTruck(truck, args, rng);
      truck.at = at;
      truck.dirty = true;

      const payload = {
        truckId: truck.id,
        fleetId: truck.fleetId,
        lat: round(truck.lat, 6),
        lng: round(truck.lng, 6),
        heading: round(truck.headingDeg, 1),
        speedKph: round(truck.speedKph, 1),
        at: at.toISOString(),
      };

      pipeline.publish(LOCATION_CHANNEL, JSON.stringify(payload));
      // GEO set + short-TTL hash alongside the fan-out is the dispatch seam of
      // §6.1: the matcher GEOSEARCHes this instead of touching PostGIS.
      pipeline.geoadd(truckGeoKey(truck.fleetId), payload.lng, payload.lat, truck.id);
      pipeline.hset(truckHashKey(truck.id), {
        fleetId: payload.fleetId,
        lat: payload.lat,
        lng: payload.lng,
        heading: payload.heading,
        speedKph: payload.speedKph,
        at: payload.at,
      });
      pipeline.pexpire(truckHashKey(truck.id), TRUCK_HASH_TTL_MS);
    }

    await pipeline.exec();
    stats.pings += fleet.length;
  }

  /**
   * Redis is the fast path — every ping lands there. Postgres is the slow,
   * authoritative one and gets the last-known position on a lazy cadence
   * (§6.1, §11.2: "only samples and final positions are persisted"). One
   * UPDATE … FROM (VALUES …) per flush rather than one per truck, so cost
   * scales with the flush interval instead of with the ping rate.
   */
  async function flushToPostgres(): Promise<void> {
    const pending = fleet.filter((truck) => truck.dirty);
    if (pending.length === 0) return;

    const values = pending.map(
      (truck) =>
        // toISOString: raw `sql` params bypass drizzle's column mapping, and
        // postgres.js Bind rejects a bare Date (Buffer.byteLength on a Date).
        sql`(${truck.id}::uuid, ${truck.lng}::double precision, ${truck.lat}::double precision, ${truck.at.toISOString()}::timestamptz)`,
    );

    await db.execute(sql`
      update fleet_trucks as t
      set current_location = ST_SetSRID(ST_MakePoint(v.lng, v.lat), 4326)::geography,
          last_ping_at = v.at,
          updated_at = now()
      from (values ${sql.join(values, sql`, `)}) as v(id, lng, lat, at)
      where t.id = v.id
    `);

    for (const truck of pending) truck.dirty = false;
    stats.flushes += 1;
    stats.rowsWritten += pending.length;

    const elapsed = Math.round((Date.now() - startedAt) / 1000);
    console.log(
      `[sim] t+${elapsed}s · ${stats.pings} pings · flush #${stats.flushes} (${pending.length} trucks) · ${stats.transitions} transitions · ${stats.errors} errors`,
    );
  }

  async function advanceOneBooking(): Promise<void> {
    const candidates = await db
      .select({ id: bookings.id, status: bookings.status, fleetId: bookings.fleetId })
      .from(bookings)
      .where(and(inArray(bookings.status, ADVANCEABLE), inArray(bookings.fleetId, fleetIds)))
      .orderBy(bookings.updatedAt)
      .limit(20);

    const picked = candidates[Math.floor(rng() * candidates.length)];
    if (!picked?.fleetId) return;
    const fleetId = picked.fleetId;

    const from = picked.status as AdvanceableStatus;
    const to = NEXT_STATUS[from];

    const committed = await db.transaction(async (tx) => {
      // Guarding on the status we read means a real transition landing between
      // the select and the update wins, instead of the simulator dragging the
      // booking backwards through the §5.1 machine.
      const updated = await tx
        .update(bookings)
        .set({
          status: to,
          // §5.1: IN_PROGRESS is only reachable through OTP verification.
          ...(to === 'in_progress' ? { otpVerified: true } : {}),
          updatedAt: new Date(),
        })
        .where(and(eq(bookings.id, picked.id), eq(bookings.status, from)))
        .returning({ id: bookings.id });

      if (updated.length === 0) return false;

      // §5.2: every one of these transitions is driver-initiated in the real machine.
      await tx.insert(bookingStatusHistory).values({
        bookingId: picked.id,
        status: to,
        actor: 'driver',
        note: 'simulated by sim:locations',
      });

      stats.transitions += 1;
      console.log(`[sim] booking ${picked.id.slice(0, 8)} ${from} → ${to}`);
      return true;
    });

    if (!committed) return;

    // Published AFTER the commit, never inside the transaction: a rolled-back
    // transition that had already been broadcast would leave every console
    // showing a status the database never reached.
    //
    // Until driver-app ingestion lands this is the ONLY producer of
    // `booking:status` and of the KPI recompute trigger, so the fleet console's
    // live jobs feed and KPI tiles move only while the simulator is running.
    await redis.publish(
      FLEET_EVENTS_CHANNEL,
      JSON.stringify({
        kind: 'booking_status',
        fleetId,
        bookingId: picked.id,
        status: to,
        at: new Date().toISOString(),
      }),
    );
  }

  const onError = (label: string) => (error: unknown) => {
    stats.errors += 1;
    console.error(`[sim] ${label} failed:`, error instanceof Error ? error.message : error);
  };

  let publishing = false;
  const pingTimer = setInterval(() => {
    // A slow Redis round-trip must not queue ticks behind each other; a skipped
    // tick is honest backpressure, a backlog is a memory leak.
    if (publishing) {
      stats.skippedTicks += 1;
      return;
    }
    publishing = true;
    void publishTick()
      .catch(onError('publish'))
      .finally(() => {
        publishing = false;
      });
  }, args.intervalMs);

  let flushing = false;
  const dbTimer = setInterval(() => {
    if (flushing) return;
    flushing = true;
    void flushToPostgres()
      .catch(onError('db flush'))
      .finally(() => {
        flushing = false;
      });
  }, args.dbIntervalMs);

  let advancing = false;
  const bookingTimer = args.advanceBookings
    ? setInterval(() => {
        if (advancing) return;
        advancing = true;
        void advanceOneBooking()
          .catch(onError('booking advance'))
          .finally(() => {
            advancing = false;
          });
      }, args.bookingIntervalMs)
    : undefined;

  let stopping = false;
  const shutdown = async (reason: string): Promise<void> => {
    if (stopping) return;
    stopping = true;

    clearInterval(pingTimer);
    clearInterval(dbTimer);
    if (bookingTimer) clearInterval(bookingTimer);

    console.log(`\n[sim] ${reason} — flushing pending positions`);
    // The last few seconds of movement only exist in memory until this runs.
    await flushToPostgres().catch(onError('final flush'));
    await redis.quit().catch(onError('redis quit'));
    await client.end({ timeout: 5 }).catch(onError('postgres close'));

    const elapsed = Math.round((Date.now() - startedAt) / 1000);
    console.log(
      `[sim] stopped after ${elapsed}s · ${stats.pings} pings · ${stats.flushes} flushes (${stats.rowsWritten} rows) · ${stats.transitions} booking transitions · ${stats.skippedTicks} skipped ticks · ${stats.errors} errors`,
    );
    process.exit(stats.errors > 0 ? 1 : 0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  if (args.durationSec > 0) {
    setTimeout(() => void shutdown(`duration ${args.durationSec}s reached`), args.durationSec * 1000);
  }

  console.log('[sim] running — Ctrl-C to stop');
}

main().catch((error: unknown) => {
  console.error('[sim] failed to start:', error);
  process.exit(1);
});
