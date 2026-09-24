import { Injectable, Logger } from '@nestjs/common';
import { MetricsService } from '../../common/observability/metrics.service';
import { DispatchConfigRepo } from '../bookings/dispatch-config.repo';
import { DriverPresenceRepo } from './driver-presence.repo';
import { PresenceStore } from './presence-store';

/**
 * §6.1's candidate selection — who is available, here, right now.
 *
 * PHASE 16 SHIPS THE READ; PHASE 17 SHIPS THE SCORE. What lives here is
 * everything that decides whether a driver is a candidate AT ALL: zone
 * membership, proximity, and liveness. The §6.2 weighted scorer, the eligibility
 * joins against capabilities and truck compliance, and the offer lock are the
 * matcher's, and deliberately not pre-empted here — a scorer written before its
 * first real consumer is a scorer written against guesses.
 *
 * `/drivers/nearby` is this phase's consumer and needs only the count and the
 * coordinates, which is exactly the subset that is safe to expose (§11.9).
 */

export interface DriverCandidate {
  driverId: string;
  lat: number;
  lng: number;
  /** Ping timestamp, already proven fresh against the configured threshold. */
  at: string;
  headingDeg: number | null;
  vehicleClass: string | null;
  longDistance: boolean;
  fleetId: string | null;
  truckId: string | null;
}

export interface CandidateSearch {
  zoneId: string;
  centre: { lat: number; lng: number };
  radiusKm: number;
}

@Injectable()
export class DriverCandidatesRepo {
  private readonly logger = new Logger(DriverCandidatesRepo.name);

  constructor(
    private readonly store: PresenceStore,
    private readonly repo: DriverPresenceRepo,
    private readonly config: DispatchConfigRepo,
    private readonly metrics: MetricsService,
  ) {}

  /**
   * LIVENESS IS PING FRESHNESS, NOT SOCKET CONNECTIVITY (§6.1).
   *
   * A driver holding an open WebSocket whose handset stopped reporting is
   * phantom supply: dispatch offers them a job that never rings. Conversely a
   * driver on REST-only ingress with no socket at all is perfectly dispatchable.
   * Connection state answers neither question, so it is not consulted — the age
   * of the last fix is the only signal, and the threshold comes from
   * `dispatch_config.stale_ping_seconds` so an operator can widen it during a
   * network incident without a deploy.
   */
  async inZone(search: CandidateSearch): Promise<DriverCandidate[]> {
    const { stalePingSeconds } = await this.config.load();
    const staleMs = stalePingSeconds * 1000;
    const now = Date.now();

    const members = await this.store.searchZone(search.zoneId, search.centre, search.radiusKm);

    const candidates: DriverCandidate[] = [];
    for (const { driverId, hash } of members) {
      const at = hash.at;
      const lat = Number(hash.lat);
      const lng = Number(hash.lng);
      if (at === undefined || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;

      // NOT `presenceFor()`. That helper is the shared DISPLAY rule and its
      // `live` band is the fixed `PRESENCE_STALE_MS`, which is right for greying
      // a marker in a browser. Dispatch eligibility is an admin knob that can be
      // widened during a network incident, so it compares against the configured
      // threshold instead. The two agreeing at their default values is a
      // coincidence worth noting and not one worth relying on.
      if (now - Date.parse(at) >= staleMs) continue;

      candidates.push({
        driverId,
        lat,
        lng,
        at,
        headingDeg: numberOrNull(hash.headingDeg),
        vehicleClass: hash.vehicleClass === undefined || hash.vehicleClass === '' ? null : hash.vehicleClass,
        longDistance: hash.longDistance === '1',
        fleetId: hash.fleetId === undefined || hash.fleetId === '' ? null : hash.fleetId,
        truckId: hash.truckId === undefined || hash.truckId === '' ? null : hash.truckId,
      });
    }

    this.metrics.observeDriversOnline(candidates.length);
    return candidates;
  }

  /**
   * §19.2's ladder for a supply read: Redis, then PostGIS.
   *
   * DELIBERATELY NOT THE FULL DISPATCH LADDER — that is Phase 17's, and it needs
   * the eligibility joins and the KNN ordering this does not have. What this
   * guarantees is narrower and still worth having: the customer's map keeps
   * answering during a Redis incident, from positions that are at most one flush
   * window old, and says so.
   *
   * `degraded` is returned rather than logged, because the caller puts it in the
   * response — a ladder is only honest if the client can see which rung answered.
   */
  async positionsNear(params: {
    zoneId: string | null;
    centre: { lat: number; lng: number };
    radiusKm: number;
    limit: number;
  }): Promise<{
    points: Array<{
      lat: number;
      lng: number;
      headingDeg: number | null;
      vehicleClass: string | null;
    }>;
    degraded: boolean;
  }> {
    const { candidates, degraded } = await this.searchWithFallback(params);
    return {
      points: candidates.slice(0, params.limit).map((c) => ({
        lat: c.lat,
        lng: c.lng,
        headingDeg: c.headingDeg,
        vehicleClass: c.vehicleClass,
      })),
      degraded,
    };
  }

  /**
   * §19.2's ladder, returning FULL CANDIDATES rather than coordinates.
   *
   * Phase 17's matcher and Phase 16's `/drivers/nearby` share this so the
   * degraded rung is exercised by both — a ladder only one caller can reach is a
   * ladder that gets half the testing. The PostGIS rung returns less than Redis
   * does (no cached vehicle class, no heading), which is honest: those live in
   * the hot hash that is, by definition, unavailable. The eligibility query that
   * follows re-reads them from Postgres for every candidate anyway.
   */
  async searchWithFallback(params: {
    zoneId: string | null;
    centre: { lat: number; lng: number };
    radiusKm: number;
    limit: number;
  }): Promise<{ candidates: DriverCandidate[]; degraded: boolean }> {
    if (params.zoneId !== null) {
      try {
        const candidates = await this.inZone({
          zoneId: params.zoneId,
          centre: params.centre,
          radiusKm: params.radiusKm,
        });
        return { candidates, degraded: false };
      } catch (err) {
        this.logger.warn(
          `redis candidate search failed, falling back to postgis: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    // Reached either because Redis failed, or because the point falls outside
    // every zone — in which case there is no GEO set to search and PostGIS is
    // the only thing that can answer at all.
    const { stalePingSeconds } = await this.config.load();
    const rows = await this.repo.candidatesNear({
      lat: params.centre.lat,
      lng: params.centre.lng,
      radiusKm: params.radiusKm,
      stalePingSeconds,
      limit: params.limit,
    });

    return {
      candidates: rows.map((row) => ({
        driverId: row.driverId,
        lat: row.lat,
        lng: row.lng,
        at: row.lastPingAt,
        // Absent on this rung, and left null rather than guessed. Every one of
        // these is re-read from Postgres by the eligibility query, which is why
        // the degraded path loses freshness and not correctness.
        headingDeg: null,
        vehicleClass: null,
        longDistance: false,
        fleetId: null,
        truckId: null,
      })),
      degraded: true,
    };
  }
}

function numberOrNull(raw: string | undefined): number | null {
  if (raw === undefined || raw === '') return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}
