import type { Redis } from 'ioredis';
import { describe, expect, it } from 'vitest';
import type { CacheService } from '../../common/cache/cache.service';
import type { PositionsRepo } from '../../realtime/positions.repo';
import { AdminOpsService } from './admin-ops.service';
import type { AdminOpsRepo } from './admin-ops.repo';

/**
 * W4's degrade rules, proved without a database or a live Redis.
 *
 * The interesting cases are exactly the ones an e2e would find awkward and a
 * fleet outage finds easy: Redis unreachable (→ `degraded: true`, positions
 * from PostGIS, `dispatchableNow` null) and a Redis hash that is present (→ it
 * wins over the persisted column, zone included). The HTTP shape and the
 * Postgres-side tenancy rule are asserted end-to-end in
 * `admin-ops-live.e2e.spec.ts`.
 */

const DRIVER = {
  driverId: '00000000-0000-4000-8000-0000000000d1',
  name: 'Test Driver',
  zoneId: '00000000-0000-4000-8000-0000000000e1',
  lat: 12.9,
  lng: 77.5,
  lastPingAt: '2026-09-19T10:00:00.000Z',
};

function serviceWith(overrides: {
  repo?: Partial<AdminOpsRepo>;
  positions?: Partial<PositionsRepo>;
  redis: Partial<Redis>;
}): AdminOpsService {
  const repo = {
    liveDrivers: async () => [DRIVER],
    liveBookings: async () => [],
    activeZones: async () => [],
    activeZoneIds: async () => ['z1', 'z2'],
    activeAndSearching: async () => ({ activeRides: 0, searching: 0 }),
    todayResolutions: async () => ({
      matched: 0,
      noDrivers: 0,
      cancelledWhileSearching: 0,
      cancelled: 0,
    }),
    todayRevenue: async () => ({ gmv: '0', commission: '0' }),
    timeToMatch: async () => ({ p50: null, p90: null }),
    onlineDrivers: async () => 0,
    approvalCounts: async () => ({ pendingKyc: 0, pendingPayouts: 0 }),
    completedUnpaid: async () => 0,
    ...overrides.repo,
  } as unknown as AdminOpsRepo;

  const positions = {
    activeZones: async () => [],
    ...overrides.positions,
  } as unknown as PositionsRepo;

  const cache = {
    getOrSet: <T>(_key: string, _ttl: number, produce: () => Promise<T>): Promise<T> => produce(),
    invalidate: async () => undefined,
  } as unknown as CacheService;

  return new AdminOpsService(repo, positions, cache, overrides.redis as Redis);
}

describe('AdminOpsService degrade paths (W4)', () => {
  it('live: Redis unreachable → degraded, positions from PostGIS', async () => {
    const service = serviceWith({
      redis: {
        pipeline: () => {
          throw new Error('connection refused');
        },
      },
    });

    const snapshot = await service.live({});

    expect(snapshot.degraded).toBe(true);
    expect(snapshot.drivers).toHaveLength(1);
    expect(snapshot.drivers[0]).toMatchObject({
      driverId: DRIVER.driverId,
      lat: DRIVER.lat,
      lng: DRIVER.lng,
      headingDeg: null,
      speedKph: null,
      at: DRIVER.lastPingAt,
      fromFallback: true,
    });
  });

  it('live: a hot Redis hash wins over the persisted column, zone included', async () => {
    const pipeline = {
      hgetall: () => pipeline,
      exec: async () => [
        [
          null,
          {
            lat: '12.9716',
            lng: '77.5946',
            at: '2026-09-19T10:01:00.000Z',
            headingDeg: '92',
            speedKph: '31',
            zoneId: 'zone-from-hash',
          },
        ],
      ],
    };
    const service = serviceWith({
      redis: { pipeline: () => pipeline } as unknown as Partial<Redis>,
    });

    const snapshot = await service.live({});

    expect(snapshot.degraded).toBe(false);
    expect(snapshot.drivers[0]).toMatchObject({
      lat: 12.9716,
      lng: 77.5946,
      headingDeg: 92,
      speedKph: 31,
      at: '2026-09-19T10:01:00.000Z',
      zoneId: 'zone-from-hash',
      fromFallback: false,
    });
  });

  it('dashboard: dispatchableNow sums the per-zone ZCARDs', async () => {
    const pipeline = {
      zcard: () => pipeline,
      exec: async () => [
        [null, 2],
        [null, 3],
      ],
    };
    const service = serviceWith({
      redis: { pipeline: () => pipeline } as unknown as Partial<Redis>,
    });

    const dashboard = await service.computeDashboard();

    expect(dashboard.kpis.dispatchableNow).toBe(5);
    expect(dashboard.degraded).toBe(false);
  });

  it('dashboard: Redis unreachable → dispatchableNow null, degraded true, the rest still served', async () => {
    const service = serviceWith({
      redis: {
        pipeline: () => {
          throw new Error('connection refused');
        },
      },
    });

    const dashboard = await service.computeDashboard();

    expect(dashboard.kpis.dispatchableNow).toBeNull();
    expect(dashboard.degraded).toBe(true);
    // The Postgres-backed numbers are unaffected — degraded means "slower but
    // correct", never "empty".
    expect(dashboard.kpis.onlineDrivers).toBe(0);
    expect(dashboard.kpis.fillRatePct).toBeNull();
  });
});
