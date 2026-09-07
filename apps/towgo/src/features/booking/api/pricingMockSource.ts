import type { PricingEstimateRequest, PricingEstimateResponse } from '@towing/api-contracts';
import { env } from '@/lib/env';
import type { PricingDataSource } from './pricingDataSource';

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * A mock that runs the same §7 shape as the server, so the fare sheet is
 * developed against a realistic breakdown rather than one hard-coded number.
 *
 * It deliberately does NOT import the backend's engine: this app must build
 * without the backend workspace, and a mock that shares the implementation
 * cannot catch a contract mismatch. What it copies is the §7.1/§7.2 slab table,
 * which is stable spec text.
 */
const WHEEL_LIFT_SLABS: Array<[number, number]> = [
  [5, 99_900], [10, 149_900], [20, 219_900], [40, 349_900],
  [60, 499_900], [80, 649_900], [100, 799_900],
];
const FLATBED_SLABS: Array<[number, number]> = [
  [5, 199_900], [10, 299_900], [20, 449_900], [40, 649_900],
  [60, 849_900], [80, 1_099_900], [100, 1_349_900],
];
const ROADSIDE: Record<string, number> = {
  battery: 79_900, flat_tyre: 69_900, fuel: 69_900, breakdown: 99_900,
};

/** Great-circle km — the same §19.2 fallback the server uses with no Maps key. */
function distanceKm(from: { lat: number; lng: number }, to: { lat: number; lng: number }): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(to.lat - from.lat);
  const dLng = toRad(to.lng - from.lng);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLng / 2) ** 2 * Math.cos(toRad(from.lat)) * Math.cos(toRad(to.lat));
  return 2 * 6_371.0088 * Math.asin(Math.min(1, Math.sqrt(a))) * 1.3;
}

export const pricingMockSource: PricingDataSource = {
  async estimate(input: PricingEstimateRequest): Promise<PricingEstimateResponse> {
    // Long enough that the "computing fare" skeleton is actually visible in
    // development — §10.8's perceived-performance work is untestable against an
    // instant mock.
    await delay(650);
    if (env.mockPricingState === 'error') throw new Error('Mock pricing error');

    const surging = env.mockPricingState === 'surge';
    const serviceType = ROADSIDE[input.serviceSlug] !== undefined ? input.serviceSlug : 'tow';
    const isRoadside = ROADSIDE[serviceType] !== undefined;
    const km = isRoadside || !input.drop ? 0 : Math.round(distanceKm(input.pickup, input.drop) * 100) / 100;

    const vehicleClass = input.vehicleClass ?? 'wheel_lift';
    const slabs = vehicleClass === 'flatbed' ? FLATBED_SLABS : WHEEL_LIFT_SLABS;
    const basePaise =
      ROADSIDE[serviceType] ?? (slabs.find(([maxKm]) => km <= maxKm) ?? slabs[slabs.length - 1]!)[1];

    const accidentPaise = input.serviceSlug === 'accident_recovery' ? 150_000 : 0;
    const preSurge = basePaise + accidentPaise;
    const surgePaise = surging ? Math.round(preSurge * 0.1) : 0;

    return {
      serviceSlug: input.serviceSlug,
      serviceType: serviceType as PricingEstimateResponse['serviceType'],
      vehicleClass,
      distanceKm: km,
      distanceSource: 'haversine',
      etaMinutes: isRoadside ? 12 : Math.max(5, Math.round(km * 2.5)),
      zone: {
        id: '00000000-0000-4000-8000-000000000001',
        name: 'Bengaluru Metro',
        surgeBand: surging ? 'high' : 'standard',
        isHighway: false,
      },
      band: km > 100 ? 'C' : km > 40 ? 'B' : 'A',
      breakdown: {
        basePaise,
        nightPaise: 0,
        highwayPaise: 0,
        accidentPaise,
        // Zero on an estimate, both for the same reason: nobody has waited
        // on-site yet, and §14's tax is applied at confirm against the rate
        // snapshotted onto the booking.
        waitingPaise: 0,
        surgePaise,
        discountPaise: 0,
        taxPaise: 0,
        totalPaise: preSurge + surgePaise,
      },
      surgeActive: surgePaise > 0,
    };
  },
};
