import { eq } from 'drizzle-orm';
import { bookings, dispatchConfig, drivers, serviceZones } from '../../db/schema';
import { seedDriver, type TestDatabase } from '../../test/db';
import { driverGeoKey, driverHashKey } from '../../redis/redis.constants';
import { testRedis } from '../../test/redis';
import {
  OPTIONAL_SERVICE_TYPES,
  type OptionalServiceType,
  type ServiceType,
} from '@towing/api-contracts';

/**
 * Shared fixtures for the dispatch specs.
 *
 * SEPARATE FROM `test/fixtures.ts` on purpose: these build a live SEARCH — a
 * zone with a ladder, drivers in the candidate store with fresh pings, a booking
 * with locked money — and nothing outside this phase needs any of it. Putting
 * them in the shared file would make every other spec's fixture surface wider
 * for no reason.
 */

/** The seeded Bengaluru polygon, matching `db/seed/fixtures.ts`. */
export const BENGALURU_POLYGON =
  'SRID=4326;POLYGON((77.45 12.80,77.80 12.80,77.80 13.15,77.45 13.15,77.45 12.80))';

/** Inside that polygon — every fixture pickup and driver sits near here. */
export const PICKUP = { lat: 12.9716, lng: 77.5946 };

export interface SeedZoneOptions {
  /** Overrides the code defaults. `null` leaves the column NULL, which is the untuned case. */
  dispatchConfig?: Record<string, unknown> | null;
  name?: string;
}

export async function seedZone(db: TestDatabase, options: SeedZoneOptions = {}): Promise<string> {
  const [row] = await db
    .insert(serviceZones)
    .values({
      name: options.name ?? 'Bengaluru Metro',
      area: BENGALURU_POLYGON,
      ...(options.dispatchConfig !== undefined
        ? { dispatchConfig: options.dispatchConfig as never }
        : {}),
    })
    .returning({ id: serviceZones.id });
  return row!.id;
}

/**
 * The §6.2 scorer weights and the §6.1 stale threshold.
 *
 * A truncated database has no `dispatch_config` row, and `DispatchConfigRepo`
 * correctly falls back to the code defaults — but a spec asserting on WEIGHTS
 * needs a row it can move, so most of them seed one explicitly.
 */
export async function seedDispatchConfig(
  db: TestDatabase,
  overrides: Partial<typeof dispatchConfig.$inferInsert> = {},
): Promise<void> {
  await db.insert(dispatchConfig).values(overrides);
}

export interface SeedSearchingBookingOptions {
  userId: string;
  zoneId?: string | null;
  vehicleClass?: 'flatbed' | 'wheel_lift';
  /** Defaults to `tow`, whose match is vehicle class alone — pass a roadside type to exercise the opt-in filter. */
  serviceType?: ServiceType;
  /** Band C is the §3.2 long-distance opt-in gate. */
  commissionBand?: 'A' | 'B' | 'C';
  total?: string;
  commissionAmount?: string;
  driverPayout?: string;
  scheduledAt?: Date | null;
}

/**
 * A booking that is genuinely `searching`, with the money LOCKED the way §3.4's
 * confirm locks it — because the offer's net figure is read from these columns,
 * not recomputed.
 */
export async function seedSearchingBooking(
  db: TestDatabase,
  options: SeedSearchingBookingOptions,
): Promise<string> {
  const [row] = await db
    .insert(bookings)
    .values({
      userId: options.userId,
      zoneId: options.zoneId ?? null,
      serviceType: options.serviceType ?? 'tow',
      vehicleClass: options.vehicleClass ?? 'flatbed',
      pickupLat: PICKUP.lat,
      pickupLng: PICKUP.lng,
      pickupAddress: 'MG Road, Bengaluru',
      dropLat: 12.9345,
      dropLng: 77.6266,
      dropAddress: 'Koramangala, Bengaluru',
      distanceKm: '7.20',
      status: 'searching',
      total: options.total ?? '1200.00',
      commissionBand: options.commissionBand ?? 'A',
      commissionPct: '10.00',
      commissionAmount: options.commissionAmount ?? '120.00',
      driverPayout: options.driverPayout ?? '1080.00',
      ...(options.scheduledAt ? { scheduledAt: options.scheduledAt } : {}),
    })
    .returning({ id: bookings.id });
  return row!.id;
}

export interface SeedOnlineDriverOptions {
  zoneId: string;
  fleetId?: string | null;
  vehicleClass?: 'flatbed' | 'wheel_lift';
  longDistance?: boolean;
  kycStatus?: 'approved' | 'pending' | 'suspended' | 'rejected' | 'incomplete';
  /** Metres east of `PICKUP`, so a spec can put a driver at a known distance. */
  metersAway?: number;
  /** How stale the last ping is. Past the threshold the liveness filter drops them. */
  pingAgeMs?: number;
  rating?: string | null;
  acceptanceRate?: string | null;
  completionRate?: string | null;
  isOnline?: boolean;
  truckId?: string | null;
  /**
   * The driver's roadside opt-ins. Defaults to ALL FIVE, so every spec that
   * predates the opt-in keeps testing the rule it was written for rather than
   * silently becoming a `service_not_offered` test.
   */
  services?: OptionalServiceType[];
}

/**
 * A driver who is online, approved and IN THE CANDIDATE STORE — the full Phase
 * 16 state, because the matcher reads Redis first and Postgres second and a
 * driver present in only one of them is not a realistic fixture.
 */
export async function seedOnlineDriver(
  db: TestDatabase,
  options: SeedOnlineDriverOptions,
): Promise<string> {
  const driverId = await seedDriver(db, {
    fleetId: options.fleetId ?? undefined,
    kycStatus: options.kycStatus ?? 'approved',
    vehicleClass: options.vehicleClass ?? 'flatbed',
  });

  // ~111,320 m per degree of latitude; east so latitude (and therefore the
  // zone polygon test) is unaffected.
  const metersAway = options.metersAway ?? 500;
  const lng = PICKUP.lng + metersAway / (111_320 * Math.cos((PICKUP.lat * Math.PI) / 180));

  await db
    .update(drivers)
    .set({
      isOnline: options.isOnline ?? true,
      currentZoneId: options.zoneId,
      currentLocation: { lat: PICKUP.lat, lng },
      lastPingAt: new Date(Date.now() - (options.pingAgeMs ?? 0)),
      longDistanceEnabled: options.longDistance ?? false,
      services: options.services ?? [...OPTIONAL_SERVICE_TYPES],
      ...(options.rating !== undefined ? { rating: options.rating } : {}),
      ...(options.acceptanceRate !== undefined ? { acceptanceRate: options.acceptanceRate } : {}),
      ...(options.completionRate !== undefined ? { completionRate: options.completionRate } : {}),
      ...(options.truckId !== undefined ? { assignedTruckId: options.truckId } : {}),
    })
    .where(eq(drivers.id, driverId));

  await putInCandidateStore(driverId, options.zoneId, lng, options.pingAgeMs ?? 0);
  return driverId;
}

/**
 * The Phase 16 hot state, written directly.
 *
 * A spec cannot go through `POST /v1/driver/online` for this because it needs
 * control over the PING AGE — the one thing the real route deliberately does not
 * let a caller decide.
 */
export async function putInCandidateStore(
  driverId: string,
  zoneId: string,
  lng: number,
  pingAgeMs = 0,
): Promise<void> {
  const at = new Date(Date.now() - pingAgeMs).toISOString();
  await testRedis().hset(driverHashKey(driverId), {
    zoneId,
    fleetId: '',
    truckId: '',
    vehicleClass: 'flatbed',
    longDistance: '0',
    seq: '1',
    lat: String(PICKUP.lat),
    lng: String(lng),
    headingDeg: '90',
    speedKph: '30',
    accuracyM: '8',
    at,
  });
  await testRedis().geoadd(driverGeoKey(zoneId), lng, PICKUP.lat, driverId);
}

/** Removes a driver from Redis without touching Postgres — the §19.2 degraded fixture. */
export async function evictFromCandidateStore(driverId: string, zoneId: string): Promise<void> {
  await testRedis().zrem(driverGeoKey(zoneId), driverId);
  await testRedis().del(driverHashKey(driverId));
}
