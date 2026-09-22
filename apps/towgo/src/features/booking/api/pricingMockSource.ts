import type { PricingEstimateRequest } from '@towing/api-contracts';
import { ApiClientError } from '@/lib/api/errors';
import { env } from '@/lib/env';
import type { FareEstimate } from '../types';
import type { PricingDataSource } from './pricingDataSource';

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Mock `POST /v1/pricing/estimate`, shaped for Figma 14 and 15.
 *
 * The design draws four line items (base, distance, night, discount with a
 * coupon code) and a fare range on 14. The contract carries none of distance
 * charge, coupon code or range, so this mock fills the app-local `FareEstimate`
 * extras and keeps every sum consistent:
 * total = base + distance + night + accident + surge − discount, and the range
 * starts at that total.
 *
 * Everything else follows the server's own rules rather than the Figma sample:
 * the class is the one requested (Car and Bike bill wheel-lift, SUV flatbed),
 * and the night charge applies only inside §7.4's 22:00–06:00 window (IST).
 *
 * It deliberately does NOT import the backend's engine: this app must build
 * without the backend workspace.
 */
const BASE_PAISE: Record<'wheel_lift' | 'flatbed', number> = {
  wheel_lift: 70_000,
  flatbed: 120_000,
};
/** Per-km distance rate, in paise. */
const PER_KM_PAISE: Record<'wheel_lift' | 'flatbed', number> = {
  wheel_lift: 5_500,
  flatbed: 8_000,
};
const ROADSIDE: Record<string, number> = {
  battery: 79_900,
  flat_tyre: 69_900,
  fuel: 69_900,
  breakdown: 99_900,
};
/** §7.4 night window and rate, as `charge_config` ships them (15 % of the pre-surge base, 22 → 6). */
const NIGHT = { pct: 15, startHour: 22, endHour: 6 } as const;
/** IST, the operating timezone the server reads the hour in. */
const OPERATING_UTC_OFFSET_MINUTES = 330;
/**
 * The coupon applied to every mock quote. The estimate contract has no coupon
 * at all (booking data gap), so this is mock data standing in for an applied
 * offer; the live API renders whatever code it eventually returns.
 */
const MOCK_COUPON = { code: 'TOW100', discountPaise: 10_000 } as const;
/** The high end of the quoted range sits 25 % above the total. */
const RANGE_SPREAD = 1.25;
/** Bengaluru traffic: minutes per km of the billed distance. */
const MINUTES_PER_KM = 4.25;

/** Great-circle km with the road factor — the same §19.2 fallback the server uses with no Maps key. */
function distanceKm(from: { lat: number; lng: number }, to: { lat: number; lng: number }): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(to.lat - from.lat);
  const dLng = toRad(to.lng - from.lng);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLng / 2) ** 2 * Math.cos(toRad(from.lat)) * Math.cos(toRad(to.lat));
  return 2 * 6_371.0088 * Math.asin(Math.min(1, Math.sqrt(a))) * 1.3;
}

/** Nearest ₹10, in paise. */
const roundTenRupees = (paise: number) => Math.round(paise / 1_000) * 1_000;

/** Is the pickup time inside the night window? Wraps midnight, as the server's `isNightHour` does. */
function isNight(scheduledAt: string | undefined): boolean {
  const at = scheduledAt ? new Date(scheduledAt) : new Date();
  const minutes =
    (at.getUTCHours() * 60 + at.getUTCMinutes() + OPERATING_UTC_OFFSET_MINUTES) % 1440;
  const hour = Math.floor(minutes / 60);
  return hour >= NIGHT.startHour || hour < NIGHT.endHour;
}

/** The quote itself: a pure function of the request (and the clock, for the night window). */
function quote(input: PricingEstimateRequest): FareEstimate {
  const surging = env.mockPricingState === 'surge';
  const serviceType = ROADSIDE[input.serviceSlug] !== undefined ? input.serviceSlug : 'tow';
  const isRoadside = ROADSIDE[serviceType] !== undefined;
  const km =
    isRoadside || !input.drop ? 0 : Math.round(distanceKm(input.pickup, input.drop) * 100) / 100;

  const vehicleClass = input.vehicleClass ?? 'wheel_lift';
  const basePaise = ROADSIDE[serviceType] ?? BASE_PAISE[vehicleClass];
  const distancePaise = isRoadside ? 0 : roundTenRupees(km * PER_KM_PAISE[vehicleClass]);
  // The server's base already includes distance, so the night percentage is
  // taken on both here.
  const nightPaise = isNight(input.scheduledAt)
    ? roundTenRupees(((basePaise + distancePaise) * NIGHT.pct) / 100)
    : 0;
  const accidentPaise = input.serviceSlug === 'accident_recovery' ? 150_000 : 0;
  const preSurge = basePaise + distancePaise + nightPaise + accidentPaise;
  const surgePaise = surging ? roundTenRupees(preSurge * 0.1) : 0;
  const discountPaise = MOCK_COUPON.discountPaise;
  const totalPaise = preSurge + surgePaise - discountPaise;

  return {
    serviceSlug: input.serviceSlug,
    serviceType: serviceType as FareEstimate['serviceType'],
    vehicleClass,
    distanceKm: km,
    distanceSource: 'haversine',
    etaMinutes: isRoadside ? 12 : Math.max(5, Math.round(km * MINUTES_PER_KM)),
    zone: {
      id: '00000000-0000-4000-8000-000000000001',
      name: 'Bengaluru Metro',
      surgeBand: surging ? 'high' : 'standard',
      isHighway: false,
    },
    band: km > 100 ? 'C' : km > 40 ? 'B' : 'A',
    breakdown: {
      basePaise,
      distancePaise,
      nightPaise,
      highwayPaise: 0,
      accidentPaise,
      // Zero on an estimate: nobody has waited on-site yet, and §14's tax is
      // applied at confirm.
      waitingPaise: 0,
      surgePaise,
      discountPaise,
      taxPaise: 0,
      totalPaise,
    },
    surgeActive: surgePaise > 0,
    // A11: kill-switch warnings ride the contract response; the mock never pauses.
    warnings: [],
    couponCode: MOCK_COUPON.code,
    totalMinPaise: totalPaise,
    totalMaxPaise: roundTenRupees(totalPaise * RANGE_SPREAD),
  };
}

export const pricingMockSource: PricingDataSource = {
  async estimate(input: PricingEstimateRequest): Promise<FareEstimate> {
    await delay(650);
    if (env.mockPricingState === 'error') throw new Error('Mock pricing error');
    // W20 §7.3 — the >600 km refusal, with the same code and details the
    // server sends, so the quote flow is reachable in mock mode.
    if (env.mockPricingState === 'manual_quote') {
      throw new ApiClientError(
        422,
        'manual_quote_required',
        'This trip is long enough to need a manual quote',
        { distanceKm: 812.4 },
      );
    }
    return quote(input);
  },
  quoteNow(input: PricingEstimateRequest): FareEstimate | undefined {
    // The error state must stay reachable: no seed, so the request's failure shows.
    return env.mockPricingState === 'error' || env.mockPricingState === 'manual_quote'
      ? undefined
      : quote(input);
  },
};
