import { Inject, Injectable } from '@nestjs/common';
import {
  commissionPaiseAtPct,
  type PricingEstimateRequest,
  type PricingEstimateResponse,
  type ServiceCatalogItem,
} from '@towing/api-contracts';
import { ApiException } from '../../common/errors/api-exception';
import { ROUTING, type RoutingPort } from '../../common/routing/routing.port';
import { PricingConfigRepo, type RateCard } from './pricing-config.repo';
import {
  CustomQuoteRequiredError,
  computeFare,
  type FareResult,
  type VehicleClass,
} from './pricing.math';
import { ServicesService } from './services.service';
import { ZoneResolverService, type ResolvedZone } from './zone-resolver.service';

/**
 * `POST /v1/pricing/estimate` (§7, §7.6).
 *
 * The order of operations is the §7 formula's own: resolve what is being
 * bought (catalogue) → where from (zone) → how far (routing) → what that costs
 * (engine). Each step can fail the request cleanly, and none of them can leak
 * commission to the customer, because `toResponse` builds the body field by
 * field rather than spreading the engine's result.
 *
 * §7.6 GIVES THIS 2 SECONDS. The only unbounded thing inside it is the Distance
 * Matrix call, which is why `ROUTING_TIMEOUT_MS` is 1.5 s and the router falls
 * back to arithmetic rather than propagating a vendor failure.
 */

/**
 * The operating timezone. The night window (§7.4) is a fact about India, not
 * about where the server happens to run — a container on UTC would otherwise
 * bill a 23:00 IST tow as a daytime job. `Intl` rather than a date library
 * because this is the only place the project needs a timezone conversion.
 */
const OPERATING_TIMEZONE = 'Asia/Kolkata';

/**
 * Everything the §7 pipeline produces, before anyone decides who is allowed to
 * see which parts of it.
 */
export interface PricedRequest {
  service: ServiceCatalogItem;
  vehicleClass: VehicleClass;
  distanceKm: number;
  distanceSource: 'google_distance_matrix' | 'haversine';
  etaMinutes: number | null;
  zone: ResolvedZone;
  fare: FareResult;
  rateCard: RateCard;
}

/** A `PricedRequest` plus the §3.3 commission — the shape a booking locks. */
export interface LockedFare extends PricedRequest {
  commissionPct: number;
  commissionPaise: number;
  driverPayoutPaise: number;
}

@Injectable()
export class PricingService {
  constructor(
    private readonly catalog: ServicesService,
    private readonly config: PricingConfigRepo,
    private readonly zones: ZoneResolverService,
    @Inject(ROUTING) private readonly routing: RoutingPort,
  ) {}

  /**
   * §16.2's customer-facing estimate — a projection of `price()` with every
   * commission field dropped (§7.6).
   */
  async estimate(request: PricingEstimateRequest): Promise<PricingEstimateResponse> {
    const priced = await this.price(request);
    return {
      serviceSlug: priced.service.slug,
      serviceType: priced.service.serviceType,
      vehicleClass: priced.vehicleClass,
      distanceKm: priced.distanceKm,
      distanceSource: priced.distanceSource,
      etaMinutes: priced.etaMinutes,
      zone: {
        id: priced.zone.id,
        name: priced.zone.name,
        surgeBand: priced.zone.surgeBand,
        isHighway: priced.zone.isHighway,
      },
      band: priced.fare.band,
      breakdown: {
        basePaise: priced.fare.basePaise,
        nightPaise: priced.fare.nightPaise,
        highwayPaise: priced.fare.highwayPaise,
        accidentPaise: priced.fare.accidentPaise,
        // Zero on an estimate, and both for the same reason: neither is known
        // yet. Nobody has waited on-site, and §14's tax is applied at confirm
        // against the rate snapshotted onto the booking.
        waitingPaise: priced.fare.waitingPaise,
        surgePaise: priced.fare.surgePaise,
        discountPaise: priced.fare.discountPaise,
        taxPaise: 0,
        totalPaise: priced.fare.totalPaise,
      },
      surgeActive: priced.fare.surgePaise > 0,
    };
  }

  /**
   * §3.4's fare lock — everything `estimate()` computes PLUS the commission it
   * deliberately hides.
   *
   * THE COMMISSION PERCENTAGE COMES FROM THE RATE CARD, NOT FROM `BAND_PCT`.
   * `commissionPaise(total, band)` multiplies by the hard-coded launch
   * constants, so locking through it would ignore an admin's edit to
   * `commission_config` and write economics nobody chose — a defect that was
   * invisible while nothing locked a commission and becomes real money here.
   * `commissionPaiseAtPct` takes the configured number instead.
   *
   * Sharing `price()` with `estimate()` is the point: the fare a customer was
   * shown and the fare that gets locked are the same function, not two that
   * agree today.
   */
  async lock(request: PricingEstimateRequest): Promise<LockedFare> {
    const priced = await this.price(request);
    const pct = priced.rateCard.commissionPct[priced.fare.band];
    const commission = commissionPaiseAtPct(priced.fare.totalPaise, pct);

    return {
      ...priced,
      commissionPct: pct,
      commissionPaise: commission,
      // §7: "driver net = total − commission (so the two always sum exactly)".
      // Never a second rounding — that is what makes
      // `ck_bookings_payout_within_total` hold by construction.
      driverPayoutPaise: priced.fare.totalPaise - commission,
    };
  }

  private async price(request: PricingEstimateRequest): Promise<PricedRequest> {
    const service = await this.catalog.requireBySlug(request.serviceSlug);
    const vehicleClass = resolveVehicleClass(service, request.vehicleClass);

    const zone = await this.zones.resolve(request.pickup, service.serviceType);
    if (!zone) {
      // §9.1.5's "pin moved outside zone" edge case. Quoting anyway would
      // produce a fare with no surge band, no ladder and nobody to dispatch.
      throw ApiException.validation('We do not operate at that pickup location yet', {
        pickup: 'outside every active service zone',
      });
    }

    if (service.requiresDrop && !request.drop) {
      throw ApiException.validation(`${service.name} needs a drop location`, {
        drop: 'required for this service',
      });
    }

    const rateCard = await this.config.load();

    // A roadside job is flat-rated (§7.4 / Appendix B) and has no drop, so no
    // routing call is made at all — that is also what keeps the four roadside
    // services inside §7.6's budget when Maps is degraded.
    const { distanceKm, distanceSource, etaMinutes } = request.drop
      ? await this.billedDistance(request.pickup, request.drop, rateCard.charges.haversineRoadFactor)
      : { distanceKm: 0, distanceSource: 'haversine' as const, etaMinutes: null };

    let fare;
    try {
      fare = computeFare({
        service: service.serviceType,
        vehicleClass,
        distanceKm,
        hourOfDay: hourInOperatingTimezone(request.scheduledAt),
        isHighwayPickup: zone.isHighway,
        surgeBand: zone.surgeBand,
        rules: rateCard.rules,
        charges: rateCard.charges,
      });
    } catch (error) {
      if (error instanceof CustomQuoteRequiredError) {
        // §7.3's "600 km+ — Custom quote (manual at launch)". Blocked here
        // rather than at booking time so the customer learns before choosing a
        // vehicle and a destination; the manual-quote admin path is post-launch.
        throw ApiException.validation(
          'Tows over 600 km are quoted manually — please contact support',
          { distanceKm: 'beyond the automatic pricing range (§7.3)' },
        );
      }
      throw error;
    }

    return {
      service,
      // Reported, not echoed: past 100 km the engine prices as flatbed whatever
      // was asked for (§3.3 Band C is flatbed hauling), and the customer's
      // breakdown must name the class they will actually be billed as.
      vehicleClass: distanceKm > 100 ? 'flatbed' : vehicleClass,
      distanceKm: Math.round(distanceKm * 100) / 100,
      distanceSource,
      etaMinutes,
      zone,
      fare,
      rateCard,
    };
  }

  /**
   * Billed distance in km.
   *
   * THE ROAD FACTOR IS APPLIED HERE, NOT IN THE ADAPTER. A straight line
   * under-states a road tow, so quoting raw great-circle km loses money on every
   * booking taken while Maps is down — but the correction is a §7.4 pricing knob
   * (`charge_config.haversine_road_factor`), not a property of geometry. Keeping
   * it in the pricing layer leaves `HaversineRoutingAdapter` reusable by
   * anything that wants true distance, and leaves the factor sitting with the
   * other admin-editable rates instead of buried in `common/`.
   */
  private async billedDistance(
    from: PricingEstimateRequest['pickup'],
    to: NonNullable<PricingEstimateRequest['drop']>,
    roadFactor: number,
  ) {
    const route = await this.routing.roadDistance(from, to);
    const rawKm = route.distanceMeters / 1_000;
    const distanceKm = route.source === 'haversine' ? rawKm * roadFactor : rawKm;

    return {
      distanceKm,
      distanceSource: route.source,
      etaMinutes:
        route.durationSeconds === null ? null : Math.max(1, Math.round(route.durationSeconds / 60)),
    };
  }
}

/**
 * §9.1.5 step 1: "vehicle determines class". A catalogue row that names a class
 * (bike tow is always wheel-lift, flatbed tow is always flatbed) wins over the
 * client's opinion; a row that leaves it open requires the client to say.
 */
function resolveVehicleClass(
  service: ServiceCatalogItem,
  requested: VehicleClass | undefined,
): VehicleClass {
  if (service.defaultVehicleClass) return service.defaultVehicleClass;
  if (requested) return requested;

  // Roadside services are flat-rated and never look at the class, so demanding
  // one would reject a perfectly answerable question.
  if (!service.requiresDrop) return 'wheel_lift';

  throw ApiException.validation(`${service.name} needs a vehicle class`, {
    vehicleClass: 'required for this service',
  });
}

/**
 * Hour of day in the operating timezone.
 *
 * SERVER-EVALUATED, DELIBERATELY. The request carries an instant (`scheduledAt`)
 * and never an hour: a client that could send "hour = 12" could move its own
 * fare out of the §7.4 night band by lying about its clock.
 */
function hourInOperatingTimezone(scheduledAt: string | undefined): number {
  const instant = scheduledAt ? new Date(scheduledAt) : new Date();
  const hour = new Intl.DateTimeFormat('en-GB', {
    timeZone: OPERATING_TIMEZONE,
    hour: '2-digit',
    hour12: false,
  }).format(instant);
  return Number(hour) % 24;
}
