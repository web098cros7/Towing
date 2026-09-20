import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  GLOBAL_DISPATCH_CONFIG_DEFAULTS,
  adminActivityItemSchema,
  resolveDispatchConfig,
  rupeeStringToPaise,
  type AdminActivityItem,
  type AdminDispatchInspectorListQuery,
  type AdminDispatchInspectorListResponse,
  type AdminDispatchInspectorResponse,
  type AdminOpsActivityResponse,
  type AdminOpsBadges,
  type AdminOpsBadgesResponse,
  type AdminOpsDashboardResponse,
  type AdminOpsKpis,
  type AdminOpsLiveQuery,
  type AdminOpsLiveResponse,
  type DispatchConfig,
  type JobStatus,
  type ScorerWeights,
  type ServiceType,
} from '@towing/api-contracts';
import type { Redis } from 'ioredis';
import { CacheService } from '../../common/cache/cache.service';
import { ApiException } from '../../common/errors/api-exception';
import { istDayStart } from '../../common/time/ist';
import {
  REDIS,
  adminOpsActivityKey,
  adminOpsBadgesCacheKey,
  adminOpsDashboardCacheKey,
  driverGeoKey,
  driverHashKey,
} from '../../redis/redis.constants';
import { PositionsRepo } from '../../realtime/positions.repo';
import { AdminOpsRepo, type LiveSearchRow } from './admin-ops.repo';

/** The guide's "~10 s cache", short enough that even without a push the tile lags one poll. */
const CACHE_TTL_SECONDS = 10;
/** The feed's published depth (§W3: "the last 50 `ops:events`"). */
const ACTIVITY_LENGTH = 50;

/**
 * W3/W4's read service: dashboard KPIs, sidebar badges, the activity feed and
 * the live-map snapshot.
 *
 * Two rules carried over from the fleet side, because both were learned the
 * hard way there:
 *
 *  - Every number is computed in SQL (`AdminOpsRepo`), never by counting a
 *    page-shaped query in JS.
 *  - Redis is allowed to make a response FRESHER or DEGRADED-flagged, never to
 *    fail it: `dispatchableNow` and the live driver positions both fall back
 *    with `degraded: true` rather than erroring (§19.2).
 */
@Injectable()
export class AdminOpsService {
  private readonly logger = new Logger(AdminOpsService.name);

  constructor(
    private readonly repo: AdminOpsRepo,
    private readonly positions: PositionsRepo,
    private readonly cache: CacheService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  // -------------------------------------------------------------------------
  // Dashboard (§9.4.2)
  // -------------------------------------------------------------------------

  dashboard(): Promise<AdminOpsDashboardResponse> {
    return this.cache.getOrSet(adminOpsDashboardCacheKey, CACHE_TTL_SECONDS, () =>
      this.computeDashboard(),
    );
  }

  /**
   * Uncached compute. Public so the broadcaster can recompute-and-publish
   * through the same code path the REST endpoint serves — the two cannot
   * disagree if there is only one of them.
   */
  async computeDashboard(): Promise<AdminOpsDashboardResponse> {
    const dayStart = istDayStart().toISOString();

    const [
      counts,
      resolutions,
      revenue,
      timeToMatch,
      online,
      approvals,
      unpaid,
      dispatchable,
      sos,
    ] = await Promise.all([
      this.repo.activeAndSearching(),
      this.repo.todayResolutions(dayStart),
      this.repo.todayRevenue(dayStart),
      this.repo.timeToMatch(dayStart),
      this.repo.onlineDrivers(),
      this.repo.approvalCounts(),
      this.repo.completedUnpaid(),
      this.dispatchableNow(),
      this.repo.sosAcknowledgement(),
    ]);

    // Fill rate: matched ÷ (matched + no_drivers_found + cancelled-while-searching).
    // Still-searching bookings count on Neither side — dividing by "created
    // today" would make the rate sag every time the city gets busy, which is
    // the classic way this tile lies.
    const denominator =
      resolutions.matched + resolutions.noDrivers + resolutions.cancelledWhileSearching;
    const fillRatePct =
      denominator === 0 ? null : Math.round((1000 * resolutions.matched) / denominator) / 10;

    const kpis: AdminOpsKpis = {
      activeRides: counts.activeRides,
      searching: counts.searching,
      onlineDrivers: online,
      dispatchableNow: dispatchable.dispatchableNow,
      todayGmvPaise: Math.max(0, rupeeStringToPaise(revenue.gmv)),
      todayCommissionPaise: Math.max(0, rupeeStringToPaise(revenue.commission)),
      pendingKyc: approvals.pendingKyc,
      pendingPayouts: approvals.pendingPayouts,
      fillRatePct,
      cancelledToday: resolutions.cancelled,
      completedUnpaid: unpaid,
      timeToMatchP50Seconds: timeToMatch.p50 === null ? null : Math.round(timeToMatch.p50),
      timeToMatchP90Seconds: timeToMatch.p90 === null ? null : Math.round(timeToMatch.p90),
      // W14: §22.2's response time. Null percentiles when nothing has been
      // acknowledged in the window — never 0, which would read as "instant".
      sos: {
        open: sos.open,
        ackP50Seconds: sos.p50 === null ? null : Math.round(sos.p50),
        ackP95Seconds: sos.p95 === null ? null : Math.round(sos.p95),
      },
    };

    return { kpis, at: new Date().toISOString(), degraded: dispatchable.degraded };
  }

  /**
   * Σ `ZCARD drivers:online:{zone}` over the active zones — the count dispatch
   * actually sees, which is why it is shown beside the Postgres number rather
   * than replacing it. Null + degraded when Redis is down: "unknown" and "zero"
   * are different facts.
   */
  private async dispatchableNow(): Promise<{ dispatchableNow: number | null; degraded: boolean }> {
    try {
      const zoneIds = await this.repo.activeZoneIds();
      if (zoneIds.length === 0) return { dispatchableNow: 0, degraded: false };

      const pipeline = this.redis.pipeline();
      for (const zoneId of zoneIds) pipeline.zcard(driverGeoKey(zoneId));
      const results = await pipeline.exec();

      let total = 0;
      for (const entry of results ?? []) {
        if (entry[0]) throw entry[0];
        total += Number(entry[1]) || 0;
      }
      return { dispatchableNow: total, degraded: false };
    } catch (err) {
      this.logger.warn(`redis unavailable for dispatchableNow: ${message(err)}`);
      return { dispatchableNow: null, degraded: true };
    }
  }

  // -------------------------------------------------------------------------
  // Badges (§3.2)
  // -------------------------------------------------------------------------

  badges(): Promise<AdminOpsBadgesResponse> {
    return this.cache.getOrSet(adminOpsBadgesCacheKey, CACHE_TTL_SECONDS, () =>
      this.computeBadges(),
    );
  }

  async computeBadges(): Promise<AdminOpsBadgesResponse> {
    const [approvals, deletions, suspensionRequests, openDisputes, openSos, openTickets] =
      await Promise.all([
        this.repo.approvalCounts(),
        this.repo.deletionRequests(),
        this.repo.suspensionRequests(),
        this.repo.openDisputes(),
        this.repo.openSosAlerts(),
        this.repo.openSupportTickets(),
      ]);

    const badges: AdminOpsBadges = {
      pendingKyc: approvals.pendingKyc,
      pendingPayouts: approvals.pendingPayouts,
      openSos,
      openDisputes,
      openTickets,
      suspensionRequests,
      deletionRequests: deletions,
    };

    return { badges, at: new Date().toISOString() };
  }

  // -------------------------------------------------------------------------
  // Activity feed (§9.4.2)
  // -------------------------------------------------------------------------

  /**
   * The live Redis list when it has anything (it is populated from this deploy
   * onward); the DB union otherwise. The flag on the response says which, so a
   * backfilled feed is never passed off as the live one.
   */
  async activity(): Promise<AdminOpsActivityResponse> {
    const live = await this.readActivityList();
    if (live !== null && live.length > 0) return { items: live, backfilled: false };
    return { items: await this.backfillActivity(), backfilled: true };
  }

  private async readActivityList(): Promise<AdminActivityItem[] | null> {
    try {
      const raw = await this.redis.lrange(adminOpsActivityKey, 0, ACTIVITY_LENGTH - 1);
      const items: AdminActivityItem[] = [];
      for (const entry of raw) {
        try {
          const parsed = adminActivityItemSchema.safeParse(JSON.parse(entry));
          if (parsed.success) items.push(parsed.data);
        } catch {
          // A malformed row is skipped, not fatal — the feed is read-only glue.
        }
      }
      return items;
    } catch (err) {
      this.logger.warn(`activity list unreadable, falling back to history: ${message(err)}`);
      return null;
    }
  }

  /**
   * DB backfill: `booking_status_history` + `admin_actions` + `sos_alerts`,
   * newest 50 — the third source joined the union in W14. The backfill cannot
   * know creations that predate the feed's own writes any differently than
   * history does — a booking's opening row is `searching` (A18), and that is
   * what marks it as a creation here.
   */
  private async backfillActivity(): Promise<AdminActivityItem[]> {
    const [history, actions, sosAlerts] = await Promise.all([
      this.repo.activityHistory(ACTIVITY_LENGTH),
      this.repo.activityAdminActions(ACTIVITY_LENGTH),
      this.repo.activitySosAlerts(ACTIVITY_LENGTH),
    ]);

    const items: AdminActivityItem[] = [
      ...history.map((row): AdminActivityItem => {
        const creation = row.isFirst && row.status === 'searching';
        return {
          id: `${creation ? 'booking_created' : 'booking_status'}:${row.id}`,
          kind: creation ? 'booking_created' : 'booking_status',
          at: row.at,
          bookingId: row.bookingId,
          zoneId: row.zoneId,
          // The DB enum is the CHECK-constrained source of this union.
          status: row.status as JobStatus,
          sosStatus: null,
          scheduledAt: null,
          action: null,
          subjectType: null,
          subjectId: null,
          adminId: null,
        };
      }),
      ...actions.map((row): AdminActivityItem => ({
        id: `admin_action:${row.id}`,
        kind: 'admin_action',
        at: row.at,
        bookingId: null,
        zoneId: null,
        status: null,
        sosStatus: null,
        scheduledAt: null,
        action: row.action,
        subjectType: row.subjectType,
        subjectId: row.subjectId,
        adminId: row.adminId,
      })),
      ...sosAlerts.map((row): AdminActivityItem => ({
        id: `sos_alert:${row.id}`,
        kind: 'sos_alert',
        at: row.at,
        bookingId: row.bookingId,
        zoneId: null,
        status: null,
        sosStatus: row.status as AdminActivityItem['sosStatus'],
        scheduledAt: null,
        action: 'sos.triggered',
        subjectType: row.subjectType,
        subjectId: row.subjectId,
        adminId: null,
      })),
    ];

    items.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
    return items.slice(0, ACTIVITY_LENGTH);
  }

  // -------------------------------------------------------------------------
  // Live map snapshot (§9.4.6, W4)
  // -------------------------------------------------------------------------

  async live(query: AdminOpsLiveQuery): Promise<AdminOpsLiveResponse> {
    const [driverRows, bookingRows, zones] = await Promise.all([
      this.repo.liveDrivers(query.zoneId),
      this.repo.liveBookings(query.zoneId, query.status),
      this.positions.activeZones(),
    ]);

    let hot: Map<string, HotFix>;
    let degraded = false;
    try {
      hot = await this.readHotPositions(driverRows.map((row) => row.driverId));
    } catch (err) {
      // §19.2: Redis down → serve the persisted PostGIS column, flagged. The
      // console shows a degraded chip; it does not show an error.
      this.logger.warn(
        `redis unavailable, serving driver positions from postgis: ${message(err)}`,
      );
      hot = new Map();
      degraded = true;
    }

    return {
      drivers: driverRows.map((row) => {
        const fix = hot.get(row.driverId);
        if (fix) {
          return {
            driverId: row.driverId,
            name: row.name,
            // The hash's zone is fresher than the column (go-online/zone moves).
            zoneId: fix.zoneId ?? row.zoneId,
            lat: fix.lat,
            lng: fix.lng,
            headingDeg: fix.headingDeg,
            speedKph: fix.speedKph,
            at: fix.at,
            fromFallback: false,
            dispatchable: row.dispatchable,
          };
        }
        return {
          driverId: row.driverId,
          name: row.name,
          zoneId: row.zoneId,
          lat: row.lat,
          lng: row.lng,
          // Postgres stores the position, not the motion — an honestly still
          // marker beats a confidently wrong heading.
          headingDeg: null,
          speedKph: null,
          at: row.lastPingAt,
          fromFallback: true,
          dispatchable: row.dispatchable,
        };
      }),
      bookings: bookingRows.map((row) => ({
        bookingId: row.bookingId,
        status: row.status as JobStatus,
        serviceType: row.serviceType,
        zoneId: row.zoneId,
        driverId: row.driverId,
        pickup: { lat: row.pickupLat, lng: row.pickupLng },
        drop:
          row.dropLat === null || row.dropLng === null
            ? null
            : { lat: row.dropLat, lng: row.dropLng },
        createdAt: row.createdAt,
      })),
      zones: zones.map((zone) => ({ id: zone.id, name: zone.name, geometry: zone.geometry })),
      at: new Date().toISOString(),
      degraded,
    };
  }

  // -------------------------------------------------------------------------
  // Dispatch inspector (§9.4.6, W5)
  // -------------------------------------------------------------------------

  /**
   * "Why did this driver win" — the booking, every recorded wave with its
   * per-term breakdown, every attempt, and the config as it resolves NOW beside
   * the per-wave copies of what each wave actually used.
   *
   * `waves` is empty for bookings dispatched before the writer shipped, and the
   * page says so rather than papering over it: reconstructing waves from
   * attempts would show a plausible history the engine never computed.
   */
  async dispatchInspector(bookingId: string): Promise<AdminDispatchInspectorResponse> {
    const booking = await this.repo.inspectorBooking(bookingId);
    if (!booking) {
      throw ApiException.notFound(`booking ${bookingId} not found`);
    }

    const [waves, attempts, weights] = await Promise.all([
      this.repo.waveLogsFor(bookingId),
      this.repo.attemptsFor(bookingId),
      this.globalWeights(),
    ]);

    return {
      booking: {
        bookingId: booking.bookingId,
        status: booking.status as JobStatus,
        serviceType: booking.serviceType,
        vehicleClass: booking.vehicleClass,
        zoneId: booking.zoneId,
        userId: booking.userId,
        customerName: booking.customerName,
        customerMobile: booking.customerMobile,
        pickup: { lat: booking.pickupLat, lng: booking.pickupLng },
        pickupAddress: booking.pickupAddress,
        drop:
          booking.dropLat === null || booking.dropLng === null
            ? null
            : { lat: booking.dropLat, lng: booking.dropLng },
        longDistance: booking.longDistance,
        searchWave: booking.searchWave,
        deadlineAt: booking.deadlineAt,
        scheduledAt: booking.scheduledAt,
        createdAt: booking.createdAt,
      },
      waves,
      attempts,
      config: resolveDispatchConfig(
        booking.zoneDispatchConfig,
        booking.serviceType as ServiceType,
      ),
      weights,
      liveWave: booking.searchWave,
      deadlineAt: booking.deadlineAt,
    };
  }

  /**
   * The live-searches list. The radius shown is the stored wave's rung of the
   * ladder as it resolves NOW (`searchWave` + `service_zones.dispatch_config`),
   * which is also the rung the next wave would use — the config is re-read on
   * every wave, so "now" is the honest frame.
   */
  async dispatchLiveSearches(
    _query: AdminDispatchInspectorListQuery,
  ): Promise<AdminDispatchInspectorListResponse> {
    const rows = await this.repo.liveSearches();

    // Resolve once per zone+service — 200 rows of one zone must not re-parse
    // the same JSONB 200 times.
    const configs = new Map<string, DispatchConfig>();
    const configFor = (row: LiveSearchRow): DispatchConfig => {
      const key = `${row.zoneId ?? 'no-zone'}:${row.serviceType}`;
      const cached = configs.get(key);
      if (cached) return cached;
      const resolved = resolveDispatchConfig(row.zoneDispatchConfig, row.serviceType as ServiceType);
      configs.set(key, resolved);
      return resolved;
    };

    return {
      items: rows.map((row) => {
        const radiusKm = ((): number | null => {
          if (row.wave === null || row.wave < 1) return null;
          const config = configFor(row);
          const ladder = row.longDistance ? config.bandCRadiusLadderKm : config.radiusLadderKm;
          if (ladder.length === 0) return null;
          return ladder[Math.min(row.wave, ladder.length) - 1] ?? ladder[ladder.length - 1]!;
        })();

        return {
          bookingId: row.bookingId,
          zoneId: row.zoneId,
          serviceType: row.serviceType,
          vehicleClass: row.vehicleClass,
          wave: row.wave,
          radiusKm,
          contacted: row.contacted,
          longDistance: row.longDistance,
          deadlineAt: row.deadlineAt,
          createdAt: row.createdAt,
        };
      }),
      at: new Date().toISOString(),
    };
  }

  /** The weights in force — the singleton, or the code defaults it falls back to. */
  private async globalWeights(): Promise<ScorerWeights> {
    const weights = await this.repo.globalWeights();
    return weights ?? GLOBAL_DISPATCH_CONFIG_DEFAULTS.weights;
  }

  /**
   * One pipelined HGETALL per driver, keyed off the Postgres id list — a hash
   * that only exists in Redis can never add a driver to the response (the
   * fleet snapshot's tenancy rule; here the platform is the tenant but the
   * rule is what keeps a poisoned key from inventing a marker).
   */
  private async readHotPositions(driverIds: string[]): Promise<Map<string, HotFix>> {
    const out = new Map<string, HotFix>();
    if (driverIds.length === 0) return out;

    const pipeline = this.redis.pipeline();
    for (const driverId of driverIds) pipeline.hgetall(driverHashKey(driverId));
    const results = await pipeline.exec();

    for (const [index, driverId] of driverIds.entries()) {
      const entry = results?.[index];
      if (!entry || entry[0]) continue;
      const hash = entry[1] as Record<string, string | undefined> | null;
      if (!hash || !hash.at) continue;

      const lat = num(hash.lat);
      const lng = num(hash.lng);
      if (lat === null || lng === null) continue;

      out.set(driverId, {
        lat,
        lng,
        headingDeg: num(hash.headingDeg),
        speedKph: num(hash.speedKph),
        at: hash.at,
        zoneId: hash.zoneId && hash.zoneId.length > 0 ? hash.zoneId : null,
      });
    }
    return out;
  }
}

interface HotFix {
  lat: number;
  lng: number;
  headingDeg: number | null;
  speedKph: number | null;
  at: string;
  zoneId: string | null;
}

function num(raw: string | undefined): number | null {
  if (raw === undefined || raw === '') return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
