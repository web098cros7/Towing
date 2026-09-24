import { Injectable } from '@nestjs/common';
import type {
  NearbyDriversQuery,
  NearbyDriversResponse,
  NearbyVehicle,
} from '@towing/api-contracts';
import { DriverCandidatesRepo } from '../driver-presence/driver-candidates.repo';
import { ZoneResolverService } from '../pricing/zone-resolver.service';
import { COARSEN_METERS, coarsen, coarsenAll } from './coarsen';

/**
 * §11.9's "drivers near me" — the supply signal the customer's home map draws.
 *
 * WHAT IT DOES NOT RETURN IS THE FEATURE. No id, no name, no plate, no rating,
 * no per-driver ETA: §11.9 forbids identity pre-assignment, because showing
 * "Suresh, 4.8★" before dispatch has run promises a specific driver the matcher
 * has not chosen and may never offer the job to. MiTow's `NearbyDriver` type
 * carried exactly those three fields from Phase 12's mock; they are deleted
 * rather than served.
 *
 * IT REUSES THE DISPATCH CANDIDATE STORE, and that is the point of the phase.
 * The customer sees precisely the supply that the matcher would consider —
 * same zone partition, same freshness rule — so a map showing three trucks and
 * a search that finds nobody cannot disagree.
 */

/**
 * Enough to fill a viewport, not enough to be a census. The map draws markers;
 * past a few dozen they overlap into a blob and the honest `count` is doing all
 * the communicating anyway.
 */
const MAX_MARKERS = 40;

@Injectable()
export class DriversNearbyService {
  constructor(
    private readonly candidates: DriverCandidatesRepo,
    private readonly zones: ZoneResolverService,
  ) {}

  async nearby(query: NearbyDriversQuery): Promise<NearbyDriversResponse> {
    const centre = { lat: query.lat, lng: query.lng };

    // The viewport's zone decides which GEO partition to search. `null` — the
    // customer is outside every service area — is NOT an error here the way it
    // is for a booking: panning the map over open country should answer "no
    // drivers", not 422. `positionsNear` falls through to PostGIS for that case,
    // which correctly finds nothing.
    const zone = await this.zones.resolve(centre);

    const { points, degraded } = await this.candidates.positionsNear({
      zoneId: zone?.id ?? null,
      centre,
      radiusKm: query.radiusKm,
      limit: MAX_MARKERS,
    });

    return {
      // Counted BEFORE coarsening. Two drivers sharing a cell collapse to one
      // marker — which is the right picture — but the customer is still told
      // there are two, because "how much supply is there" is the question the
      // number answers and the one that decides whether they book.
      count: points.length,
      points: coarsenAll(points),
      vehicles: nearbyVehicles(points),
      coarsenedToMeters: COARSEN_METERS,
      at: new Date().toISOString(),
      degraded,
    };
  }
}

/**
 * The trucks the map draws: one per coarsened cell (as `points`), with the
 * heading rounded to 5 degrees (enough to face along a road, no finer) and the
 * truck type when it is one the contract knows.
 */
function nearbyVehicles(
  points: Array<{
    lat: number;
    lng: number;
    headingDeg: number | null;
    vehicleClass: string | null;
  }>,
): NearbyVehicle[] {
  const byCell = new Map<string, NearbyVehicle>();
  for (const point of points) {
    const cell = coarsen(point);
    const key = `${cell.lat},${cell.lng}`;
    if (byCell.has(key)) continue;
    byCell.set(key, {
      lat: cell.lat,
      lng: cell.lng,
      headingDeg: point.headingDeg === null ? null : (Math.round(point.headingDeg / 5) * 5) % 360,
      vehicleClass:
        point.vehicleClass === 'flatbed' || point.vehicleClass === 'wheel_lift'
          ? point.vehicleClass
          : null,
    });
  }
  return [...byCell.values()];
}
