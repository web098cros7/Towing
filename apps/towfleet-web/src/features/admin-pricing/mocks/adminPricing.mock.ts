import type {
  AdminPricingConfig,
  AdminPricingHistoryEntry,
  AdminPricingRule,
} from '@towing/api-contracts';

/**
 * The launch matrix, mirroring `DEFAULT_PRICING_RULES` (§7.1/§7.2/§7.3) and the
 * seeded `charge_config` row, so the mocks-on console shows the numbers an
 * operator would actually see against a seeded backend.
 *
 * Deterministic ids: `mockUuid` mirrors the finance mock's generator — stable
 * across runs, so a spec can pin a row without depending on insertion order.
 */
const mockUuid = (n: number): string => {
  const h = (x: number) => x.toString(16).padStart(4, '0');
  return `${h(n)}${h(n * 7)}-${h(n * 13)}-4${h(n * 29).slice(1)}-8${h(n * 37).slice(1)}-${h(n * 43)}${h(n * 51)}${h(n * 57).slice(0, 4)}`;
};

const slab = (
  id: number,
  vehicleClass: 'wheel_lift' | 'flatbed',
  maxKm: number,
  pricePaise: number,
): AdminPricingRule => ({
  id: mockUuid(id),
  ruleKind: 'slab',
  serviceType: null,
  vehicleClass,
  maxKm,
  pricePaise,
  priceMaxPaise: null,
  isActive: true,
});

export const adminPricingRulesMock: AdminPricingRule[] = [
  // §7.1 wheel-lift slabs.
  slab(1, 'wheel_lift', 5, 99_900),
  slab(2, 'wheel_lift', 10, 149_900),
  slab(3, 'wheel_lift', 20, 219_900),
  slab(4, 'wheel_lift', 40, 349_900),
  slab(5, 'wheel_lift', 60, 499_900),
  slab(6, 'wheel_lift', 80, 649_900),
  slab(7, 'wheel_lift', 100, 799_900),
  // §7.2 flatbed slabs.
  slab(11, 'flatbed', 5, 199_900),
  slab(12, 'flatbed', 10, 299_900),
  slab(13, 'flatbed', 20, 449_900),
  slab(14, 'flatbed', 40, 649_900),
  slab(15, 'flatbed', 60, 849_900),
  slab(16, 'flatbed', 80, 1_099_900),
  slab(17, 'flatbed', 100, 1_349_900),
  // §7.3 long-distance ranges (flatbed) — price is the range FLOOR.
  ...(
    [
      [150, 1_600_000, 2_000_000],
      [250, 2_200_000, 3_000_000],
      [400, 3_500_000, 4_800_000],
      [600, 5_500_000, 7_500_000],
    ] as ReadonlyArray<[number, number, number]>
  ).map(([maxKm, floor, ceiling], index): AdminPricingRule => ({
    id: mockUuid(21 + index),
    ruleKind: 'long_distance',
    serviceType: null,
    vehicleClass: 'flatbed',
    maxKm,
    pricePaise: floor,
    priceMaxPaise: ceiling,
    isActive: true,
  })),
  // Appendix B flat roadside fares.
  ...(
    [
      ['battery', 79_900],
      ['flat_tyre', 69_900],
      ['fuel', 69_900],
      ['breakdown', 99_900],
    ] as ReadonlyArray<[AdminPricingRule['serviceType'], number]>
  ).map(([serviceType, pricePaise], index): AdminPricingRule => ({
    id: mockUuid(31 + index),
    ruleKind: 'roadside',
    serviceType,
    vehicleClass: null,
    maxKm: null,
    pricePaise,
    priceMaxPaise: null,
    isActive: true,
  })),
];

export const adminPricingConfigMock: AdminPricingConfig = {
  charges: {
    nightPct: 15,
    nightStartHour: 22,
    nightEndHour: 6,
    highwayChargePaise: 50_000,
    accidentChargePaise: 150_000,
    waitingFreeMinutes: 15,
    waitingPerMinutePaise: 500,
    surgePctHigh: 10,
    surgePctPeak: 25,
    haversineRoadFactor: 1.3,
  },
  rules: adminPricingRulesMock,
};

const HOUR = 60 * 60 * 1000;

export const adminPricingHistoryMock: AdminPricingHistoryEntry[] = [
  {
    id: mockUuid(101),
    adminId: mockUuid(500),
    action: 'pricing.update',
    reason: 'Fuel cost review',
    before: { charges: { nightPct: 15 } },
    after: { charges: { nightPct: 18 } },
    createdAt: new Date(Date.now() - 4 * HOUR).toISOString(),
  },
  {
    id: mockUuid(102),
    adminId: mockUuid(500),
    action: 'pricing.rule.create',
    reason: 'Airport runs',
    before: null,
    after: { ruleKind: 'slab', vehicleClass: 'wheel_lift', maxKm: 3, pricePaise: 123_400 },
    createdAt: new Date(Date.now() - 26 * HOUR).toISOString(),
  },
  {
    id: mockUuid(103),
    adminId: mockUuid(501),
    action: 'pricing.rule.deactivate',
    reason: 'Superseded by the 3 km band',
    before: { ruleKind: 'slab', vehicleClass: 'wheel_lift', maxKm: 5, pricePaise: 99_900 },
    after: {
      ruleKind: 'slab',
      vehicleClass: 'wheel_lift',
      maxKm: 5,
      pricePaise: 99_900,
      isActive: false,
    },
    createdAt: new Date(Date.now() - 27 * HOUR).toISOString(),
  },
];
