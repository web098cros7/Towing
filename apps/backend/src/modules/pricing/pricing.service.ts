import { Inject, Injectable } from '@nestjs/common';
import {
  ErrorCodes,
  commissionPaiseAtPct,
  type PricingEstimateRequest,
  type PricingEstimateResponse,
  type ServiceCatalogItem,
} from '@towing/api-contracts';
import { ApiException } from '../../common/errors/api-exception';
import { KillSwitchService } from '../../common/killswitch/killswitch.service';
import { ROUTING, type RoutingPort } from '../../common/routing/routing.port';
import { PricingConfigRepo, type RateCard } from './pricing-config.repo';
import {
  CustomQuoteRequiredError,
  ServiceNotPricedError,
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
    private readonly killSwitch: KillSwitchService,
    @Inject(ROUTING) private readonly routing: RoutingPort,
  ) {}

  /**
   * §16.2's customer-facing estimate — a projection of `price()` with every
   * commission field dropped (§7.6).
   */
  async estimate(request: PricingEstimateRequest): Promise<PricingEstimateResponse> {
    const priced = await this.price(request);
    // A11: estimates warn where creation refuses. Quoting a fare the customer
    // cannot book would be a lie; refusing the quote would hide the price
    // behind the kill switch. The warnings mirror `BookingsService.create`'s
    // refusals exactly — keep the two in step.
    const warnings: PricingEstimateResponse['warnings'] = [];
    if (await this.killSwitch.isZonePaused(priced.zone.id)) warnings.push('dispatch_paused');
    if (priced.fare.band === 'C' && (await this.killSwitch.isLongDistanceDisabled())) {
      warnings.push('long_distance_disabled');
    }
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
      warnings,
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
    const context = await this.contextFor(request);

    let fare;
    try {
      fare = computeFare({
        service: context.service.serviceType,
        vehicleClass: context.vehicleClass,
        distanceKm: context.distanceKm,
        hourOfDay: hourInOperatingTimezone(request.scheduledAt),
        isHighwayPickup: context.zone.isHighway,
        surgeBand: context.zone.surgeBand,
        rules: context.rateCard.rules,
        charges: context.rateCard.charges,
      });
    } catch (error) {
      if (error instanceof CustomQuoteRequiredError) {
        // §7.3's "600 km+ — Custom quote". Refused HERE rather than at booking
        // time so the customer learns before choosing a vehicle and a
        // destination — and, since W20, with a code the app can act on: the
        // customer is offered the manual-quote flow (`POST /v1/quotes`)
        // instead of a dead end that said "contact support".
        throw new ApiException(
          422,
          ErrorCodes.MANUAL_QUOTE_REQUIRED,
          'This trip is long enough to need a manual quote',
          { distanceKm: Math.round(context.distanceKm * 100) / 100 },
        );
      }
      if (error instanceof ServiceNotPricedError) {
        // Same answer `requireBySlug` gives a retired slug: the catalogue the
        // client holds is stale, and the service is not on offer right now.
        throw ApiException.validation(`Unknown service "${request.serviceSlug}"`, {
          serviceSlug: 'not in the active catalogue',
        });
      }
      throw error;
    }

    return {
      ...context,
      // Reported, not echoed: past 100 km the engine prices as flatbed whatever
      // was asked for (§3.3 Band C is flatbed hauling), and the customer's
      // breakdown must name the class they will actually be billed as.
      vehicleClass: context.distanceKm > 100 ? 'flatbed' : context.vehicleClass,
      distanceKm: Math.round(context.distanceKm * 100) / 100,
      fare,
    };
  }

  /**
   * W20's manual lane, part one: the billed distance for a REQUEST that will
   * never reach `computeFare` (that is the whole reason it is manual).
   *
   * Same road factor and same adapter as the automatic path — an operator
   * quoting off a straight line while the engine quotes off the road would put
   * two different numbers on two screens purporting to be "the distance".
   */
  async quoteDistanceKm(
    pickup: PricingEstimateRequest['pickup'],
    drop: NonNullable<PricingEstimateRequest['drop']>,
  ): Promise<number> {
    const rateCard = await this.config.load();
    const { distanceKm } = await this.billedDistance(
      pickup,
      drop,
      rateCard.charges.haversineRoadFactor,
    );
    return Math.round(distanceKm * 100) / 100;
  }

  /**
   * W20's manual lane, part two: a `LockedFare` built from the operator's
   * number instead of the engine's.
   *
   * THE OPERATOR'S NUMBER IS THE WHOLE FARE, and the engine is not consulted
   * for it — it cannot be, 600 km is precisely where the slab table ends. The
   * COMMISSION, however, is not the operator's to choose: it is computed from
   * the rate card exactly as `lock()` does, and the caller passes the pct the
   * quote was written under so a rate-card edit between quote and acceptance
   * cannot change a price the customer already agreed to.
   *
   * `band: 'C'` is band C by definition (§3.3: Band C is the long-haul
   * flatbed band), which also means the booking this becomes will be flatbed
   * even if the dropped class said otherwise — same rule as the automatic
   * path's `distanceKm > 100` override.
   */
  async lockManualQuote(
    request: PricingEstimateRequest,
    totalPaise: number,
    commissionPct: number,
  ): Promise<LockedFare> {
    const context = await this.contextFor(request);
    const commission = commissionPaiseAtPct(totalPaise, commissionPct);

    const fare: FareResult = {
      basePaise: totalPaise,
      nightPaise: 0,
      highwayPaise: 0,
      accidentPaise: 0,
      waitingPaise: 0,
      surgePaise: 0,
      discountPaise: 0,
      totalPaise,
      band: 'C',
    };

    return {
      ...context,
      vehicleClass: context.distanceKm > 100 ? 'flatbed' : context.vehicleClass,
      distanceKm: Math.round(context.distanceKm * 100) / 100,
      fare,
      commissionPct,
      commissionPaise: commission,
      // §7's "driver net = total − commission", never a second rounding.
      driverPayoutPaise: totalPaise - commission,
    };
  }

  /**
   * Everything the §7 pipeline produces BEFORE the fare engine runs: what is
   * being bought, from where, how far, and against which rate card.
   */
  private async contextFor(request: PricingEstimateRequest): Promise<Omit<PricedRequest, 'fare'>> {
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
      ? await this.billedDistance(
          request.pickup,
          request.drop,
          rateCard.charges.haversineRoadFactor,
        )
      : { distanceKm: 0, distanceSource: 'haversine' as const, etaMinutes: null };

    // `vehicleClass` is the RESOLVED class here (catalogue default or the
    // client's choice); the `> 100 km => flatbed` override belongs to the
    // callers, because it describes what will be billed, not what was asked
    // for — see `price()` and `lockManualQuote()`.
    return { service, vehicleClass, distanceKm, distanceSource, etaMinutes, zone, rateCard };
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
