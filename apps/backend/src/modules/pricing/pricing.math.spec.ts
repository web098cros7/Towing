import { describe, expect, it } from 'vitest';
import { createRng } from '../../db/seed/pricing';
import {
  BAND_PCT,
  CUSTOM_QUOTE_ABOVE_KM,
  CustomQuoteRequiredError,
  DEFAULT_CHARGE_CONFIG,
  DEFAULT_PRICING_RULES,
  ServiceNotPricedError,
  baseFarePaise,
  commissionPaise,
  computeFare,
  haversineMeters,
  isNightHour,
  resolveBand,
  splitPool,
  surgePctFor,
  toRupees,
  type ChargeConfigValues,
} from './pricing.math';

/**
 * Promoted from `db/seed/pricing.spec.ts` in Phase 14 along with the slabs it
 * covers. Everything above the "Phase 14" heading is the ORIGINAL suite,
 * unchanged except that `baseFarePaise` no longer takes an `rng` argument — that
 * is the evidence the slabs were moved rather than rewritten.
 */

describe('resolveBand (§3.3)', () => {
  it('maps local distances to Band A', () => {
    expect(resolveBand('tow', 8)).toBe('A');
    expect(resolveBand('battery', 3)).toBe('A');
    expect(resolveBand('tow', 40)).toBe('A');
  });

  it('maps 40–100 km to Band B', () => {
    expect(resolveBand('tow', 40.1)).toBe('B');
    expect(resolveBand('tow', 100)).toBe('B');
  });

  it('maps >100 km to Band C', () => {
    expect(resolveBand('tow', 100.1)).toBe('C');
    expect(resolveBand('tow', 450)).toBe('C');
  });

  it('accident recovery is always at least Band B', () => {
    expect(resolveBand('accident_recovery', 5)).toBe('B');
    expect(resolveBand('accident_recovery', 80)).toBe('B');
    expect(resolveBand('accident_recovery', 150)).toBe('C');
  });
});

describe('commissionPaise', () => {
  it('applies the locked band percentages', () => {
    expect(commissionPaise(149_900, 'A')).toBe(14_990); // 10%
    expect(commissionPaise(500_000, 'B')).toBe(40_000); // 8%
    expect(commissionPaise(4_000_000, 'C')).toBe(200_000); // 5%
  });

  it('rounds half-up to the paisa (§7)', () => {
    // 10% of 1005 paise = 100.5 → 101
    expect(commissionPaise(1_005, 'A')).toBe(101);
    // 8% of 1006 = 80.48 → 80
    expect(commissionPaise(1_006, 'B')).toBe(80);
  });

  it('commission + pool always reconstruct the total exactly', () => {
    const rng = createRng(42);
    for (let i = 0; i < 2_000; i += 1) {
      const total = Math.floor(rng() * 10_000_000) + 1;
      const band = (['A', 'B', 'C'] as const)[i % 3]!;
      const commission = commissionPaise(total, band);
      expect(commission + (total - commission)).toBe(total);
      expect(commission).toBeGreaterThanOrEqual(0);
      expect(commission).toBeLessThan(total);
    }
  });
});

describe('splitPool (§14.3)', () => {
  it('splits 80/20 exactly on a round pool', () => {
    expect(splitPool(100_000, 80)).toEqual({ driverPaise: 80_000, fleetPaise: 20_000 });
  });

  it('legs always sum to the pool, to the paisa, for arbitrary pools and shares', () => {
    const rng = createRng(7);
    for (let i = 0; i < 5_000; i += 1) {
      const pool = Math.floor(rng() * 5_000_000) + 1;
      const driverPct = 50 + Math.floor(rng() * 51); // 50..100
      const { driverPaise, fleetPaise } = splitPool(pool, driverPct);
      expect(driverPaise + fleetPaise).toBe(pool);
      expect(fleetPaise).toBeGreaterThanOrEqual(0);
      expect(driverPaise).toBeGreaterThanOrEqual(0);
    }
  });

  it('a 100% driver share leaves the fleet leg at zero', () => {
    expect(splitPool(123_457, 100)).toEqual({ driverPaise: 123_457, fleetPaise: 0 });
  });
});

describe('baseFarePaise (§7 slabs)', () => {
  it('hits the wheel-lift slab boundaries', () => {
    expect(baseFarePaise('tow', 'wheel_lift', 5)).toBe(99_900);
    expect(baseFarePaise('tow', 'wheel_lift', 5.1)).toBe(149_900);
    expect(baseFarePaise('tow', 'wheel_lift', 100)).toBe(799_900);
  });

  it('hits the flatbed slab boundaries', () => {
    expect(baseFarePaise('tow', 'flatbed', 5)).toBe(199_900);
    expect(baseFarePaise('tow', 'flatbed', 40)).toBe(649_900);
  });

  it('roadside services are flat fares regardless of class', () => {
    expect(baseFarePaise('battery', 'wheel_lift', 3)).toBe(79_900);
    expect(baseFarePaise('battery', 'flatbed', 3)).toBe(79_900);
    expect(baseFarePaise('breakdown', 'wheel_lift', 9)).toBe(99_900);
  });

  it('refuses a roadside service with no fare instead of pricing it as a tow', () => {
    // Winch Out ships unpriced. Before this, the lookup missed and fell through
    // to the tow slabs: ₹999 for a winch job, and nothing said so.
    expect(() => baseFarePaise('winch_out', 'wheel_lift', 0)).toThrow(ServiceNotPricedError);

    const withoutLockout = {
      ...DEFAULT_PRICING_RULES,
      roadside: { ...DEFAULT_PRICING_RULES.roadside, lockout: undefined },
    };
    expect(() => baseFarePaise('lockout', 'flatbed', 2, withoutLockout)).toThrow(
      ServiceNotPricedError,
    );
  });

  it('prices Winch Out from its fare once one exists', () => {
    const priced = {
      ...DEFAULT_PRICING_RULES,
      roadside: { ...DEFAULT_PRICING_RULES.roadside, winch_out: 149_900 },
    };
    expect(baseFarePaise('winch_out', 'wheel_lift', 0, priced)).toBe(149_900);
  });

  it('still prices a tow and an accident recovery from the slabs', () => {
    // The throw is for roadside services only. These two have never had a flat
    // fare and must not start failing because the roadside table lacks them.
    expect(baseFarePaise('tow', 'wheel_lift', 3)).toBe(99_900);
    expect(baseFarePaise('accident_recovery', 'flatbed', 3)).toBe(199_900);
  });

  it('long-distance quotes stay inside the §7.3 range and are whole rupees', () => {
    const fare = baseFarePaise('tow', 'flatbed', 120);
    expect(fare).toBeGreaterThanOrEqual(1_600_000);
    expect(fare).toBeLessThanOrEqual(2_000_000);
    expect(fare % 100).toBe(0);

    const far = baseFarePaise('tow', 'flatbed', 500);
    expect(far).toBeGreaterThanOrEqual(5_500_000);
    expect(far).toBeLessThanOrEqual(7_500_000);
  });
});

describe('toRupees', () => {
  it('formats paise as NUMERIC(12,2)-compatible strings', () => {
    expect(toRupees(0)).toBe('0.00');
    expect(toRupees(14_990)).toBe('149.90');
    expect(toRupees(-4_230_000)).toBe('-42300.00');
    expect(toRupees(1)).toBe('0.01');
  });
});

describe('BAND_PCT', () => {
  it('matches the §3.3 launch defaults inside the 5–10 guardrail', () => {
    expect(BAND_PCT).toEqual({ A: 10, B: 8, C: 5 });
  });
});

// ---------------------------------------------------------------------------
// Phase 14 — what the promotion added
// ---------------------------------------------------------------------------

describe('Band C interpolation (§7.3)', () => {
  it('interpolates linearly from the band floor to its ceiling', () => {
    // 100–150 km spans ₹16,000–₹20,000. 120 km is 40 % across → ₹17,600.
    expect(baseFarePaise('tow', 'flatbed', 120)).toBe(1_760_000);
    // The top of a band is exactly its ceiling.
    expect(baseFarePaise('tow', 'flatbed', 150)).toBe(2_000_000);
    // 400–600 km spans ₹55,000–₹75,000. 500 km is halfway → ₹65,000.
    expect(baseFarePaise('tow', 'flatbed', 500)).toBe(6_500_000);
  });

  it('is deterministic — the same tow quoted twice is the same number', () => {
    const first = baseFarePaise('tow', 'flatbed', 337.5);
    for (let i = 0; i < 50; i += 1) {
      expect(baseFarePaise('tow', 'flatbed', 337.5)).toBe(first);
    }
  });

  it('is monotonic across every band boundary', () => {
    // The failure this catches: a naive per-band interpolation where a band's
    // ceiling exceeds the next band's floor, so 151 km quotes LESS than 150 km.
    let previous = 0;
    for (let km = 100.5; km <= CUSTOM_QUOTE_ABOVE_KM; km += 0.5) {
      const fare = baseFarePaise('tow', 'flatbed', km);
      expect(fare).toBeGreaterThanOrEqual(previous);
      previous = fare;
    }
  });

  it('always lands inside the published §7.3 range for its band', () => {
    const bands: Array<[number, number, number, number]> = [
      [100, 150, 1_600_000, 2_000_000],
      [150, 250, 2_200_000, 3_000_000],
      [250, 400, 3_500_000, 4_800_000],
      [400, 600, 5_500_000, 7_500_000],
    ];
    for (const [lo, hi, floor, ceiling] of bands) {
      for (let km = lo + 0.5; km <= hi; km += 0.5) {
        const fare = baseFarePaise('tow', 'flatbed', km);
        expect(fare).toBeGreaterThanOrEqual(floor);
        expect(fare).toBeLessThanOrEqual(ceiling);
      }
    }
  });

  it('refuses to price past 600 km — §7.3 sends it to a human', () => {
    expect(() => baseFarePaise('tow', 'flatbed', 600.1)).toThrow(CustomQuoteRequiredError);
    expect(() => baseFarePaise('tow', 'flatbed', 900)).toThrow(/manual quote/);
    // …but a roadside call at any distance is still a flat fare, not a throw.
    expect(baseFarePaise('fuel', 'flatbed', 900)).toBe(69_900);
  });
});

describe('isNightHour (§7.4)', () => {
  it('handles the launch window, which wraps midnight', () => {
    const { nightStartHour: s, nightEndHour: e } = DEFAULT_CHARGE_CONFIG; // 22 → 6
    expect(isNightHour(22, s, e)).toBe(true);
    expect(isNightHour(23, s, e)).toBe(true);
    expect(isNightHour(0, s, e)).toBe(true);
    expect(isNightHour(5, s, e)).toBe(true);
    expect(isNightHour(6, s, e)).toBe(false);
    expect(isNightHour(12, s, e)).toBe(false);
    expect(isNightHour(21, s, e)).toBe(false);
  });

  it('also handles a non-wrapping window an admin could configure', () => {
    expect(isNightHour(2, 1, 5)).toBe(true);
    expect(isNightHour(5, 1, 5)).toBe(false);
    expect(isNightHour(23, 1, 5)).toBe(false);
  });
});

describe('surgePctFor (§7.4)', () => {
  it('is zero on standard and reads the config for the rest', () => {
    expect(surgePctFor('standard', DEFAULT_CHARGE_CONFIG)).toBe(0);
    expect(surgePctFor('high', DEFAULT_CHARGE_CONFIG)).toBe(10);
    expect(surgePctFor('peak', DEFAULT_CHARGE_CONFIG)).toBe(25);
  });
});

describe('computeFare — the five §7.5 worked examples, end to end', () => {
  const DAY = 12;
  const NIGHT = 23;

  it('1. wheel-lift, 8 km, daytime (Band A · 10 %)', () => {
    const fare = computeFare({
      service: 'tow',
      vehicleClass: 'wheel_lift',
      distanceKm: 8,
      hourOfDay: DAY,
      isHighwayPickup: false,
      surgeBand: 'standard',
    });
    expect(fare.basePaise).toBe(149_900);
    expect(fare.totalPaise).toBe(149_900);
    expect(fare.band).toBe('A');
    // Platform ₹149.90; driver ₹1,349.10.
    const platform = commissionPaise(fare.totalPaise, fare.band);
    expect(platform).toBe(14_990);
    expect(fare.totalPaise - platform).toBe(134_910);
  });

  it('2. flatbed, 15 km, night (Band A · 10 %)', () => {
    const fare = computeFare({
      service: 'tow',
      vehicleClass: 'flatbed',
      distanceKm: 15,
      hourOfDay: NIGHT,
      isHighwayPickup: false,
      surgeBand: 'standard',
    });
    // base ₹4,499 + 15 % night ₹674.85 = ₹5,173.85
    expect(fare.basePaise).toBe(449_900);
    expect(fare.nightPaise).toBe(67_485);
    expect(fare.totalPaise).toBe(517_385);
    // Platform ₹517.39; driver ₹4,656.46.
    const platform = commissionPaise(fare.totalPaise, fare.band);
    expect(platform).toBe(51_739);
    expect(fare.totalPaise - platform).toBe(465_646);
  });

  it('3. wheel-lift accident recovery, 25 km, surge 20 % (Band B · 8 %)', () => {
    // THE VECTOR THAT PINS SURGE'S OPERAND. base ₹3,499 + ₹1,500 accident =
    // ₹4,999 → +20 % surge ₹999.80. On the base alone that would be ₹699.80.
    const charges: ChargeConfigValues = { ...DEFAULT_CHARGE_CONFIG, surgePctHigh: 20 };
    const fare = computeFare({
      service: 'accident_recovery',
      vehicleClass: 'wheel_lift',
      distanceKm: 25,
      hourOfDay: DAY,
      isHighwayPickup: false,
      surgeBand: 'high',
      charges,
    });
    expect(fare.basePaise).toBe(349_900);
    expect(fare.accidentPaise).toBe(150_000);
    expect(fare.surgePaise).toBe(99_980);
    expect(fare.totalPaise).toBe(599_880);
    expect(fare.band).toBe('B'); // accident is always ≥ B
    const platform = commissionPaise(fare.totalPaise, fare.band);
    expect(platform).toBe(47_990);
    expect(fare.totalPaise - platform).toBe(551_890);
  });

  it('4. fleet driver, flatbed 12 km, fleet share 80/20 (Band A · 10 %)', () => {
    const fare = computeFare({
      service: 'tow',
      vehicleClass: 'flatbed',
      distanceKm: 12,
      hourOfDay: DAY,
      isHighwayPickup: false,
      surgeBand: 'standard',
    });
    expect(fare.totalPaise).toBe(449_900);
    const platform = commissionPaise(fare.totalPaise, fare.band);
    expect(platform).toBe(44_990); // ₹449.90
    const pool = fare.totalPaise - platform;
    expect(pool).toBe(404_910);
    // driver 80 % ₹3,239.28, fleet 20 % ₹809.82
    expect(splitPool(pool, 80)).toEqual({ driverPaise: 323_928, fleetPaise: 80_982 });
  });

  it('5. long-distance flatbed, 300 km, quoted ₹40,000 (Band C · 5 %)', () => {
    // The spec quotes ₹40,000 as a negotiated number rather than a table value,
    // so this pins the commission arithmetic, and the engine's own 300 km price
    // is asserted to sit inside §7.3's ₹35,000–₹48,000 band beside it.
    expect(commissionPaise(4_000_000, 'C')).toBe(200_000);
    expect(4_000_000 - 200_000).toBe(3_800_000);

    const fare = computeFare({
      service: 'tow',
      vehicleClass: 'flatbed',
      distanceKm: 300,
      hourOfDay: DAY,
      isHighwayPickup: false,
      surgeBand: 'standard',
    });
    expect(fare.band).toBe('C');
    expect(fare.basePaise).toBeGreaterThanOrEqual(3_500_000);
    expect(fare.basePaise).toBeLessThanOrEqual(4_800_000);
  });
});

describe('computeFare — §7.4 additional charges', () => {
  it('adds the highway surcharge only when the pickup zone is flagged', () => {
    const common = {
      service: 'tow',
      vehicleClass: 'wheel_lift',
      distanceKm: 30,
      hourOfDay: 12,
      surgeBand: 'standard',
    } as const;
    expect(computeFare({ ...common, isHighwayPickup: false }).highwayPaise).toBe(0);
    expect(computeFare({ ...common, isHighwayPickup: true }).highwayPaise).toBe(50_000);
  });

  it('bills waiting only past the free window (§7.6)', () => {
    const common = {
      service: 'tow',
      vehicleClass: 'wheel_lift',
      distanceKm: 30,
      hourOfDay: 12,
      isHighwayPickup: false,
      surgeBand: 'standard',
    } as const;
    expect(computeFare({ ...common, waitingMinutes: 0 }).waitingPaise).toBe(0);
    expect(computeFare({ ...common, waitingMinutes: 15 }).waitingPaise).toBe(0);
    // 5 billable minutes at ₹5/min
    expect(computeFare({ ...common, waitingMinutes: 20 }).waitingPaise).toBe(2_500);
  });

  it('never lets a discount drive the total negative', () => {
    const fare = computeFare({
      service: 'battery',
      vehicleClass: 'wheel_lift',
      distanceKm: 3,
      hourOfDay: 12,
      isHighwayPickup: false,
      surgeBand: 'standard',
      discountPaise: 999_999_999,
    });
    expect(fare.totalPaise).toBe(0);
    expect(fare.totalPaise).toBeGreaterThanOrEqual(0);
  });

  it('is driven by the config it is given, not by constants', () => {
    const doubled: ChargeConfigValues = {
      ...DEFAULT_CHARGE_CONFIG,
      nightPct: 30,
      accidentChargePaise: 300_000,
    };
    const fare = computeFare({
      service: 'accident_recovery',
      vehicleClass: 'flatbed',
      distanceKm: 20,
      hourOfDay: 23,
      isHighwayPickup: false,
      surgeBand: 'standard',
      charges: doubled,
    });
    expect(fare.nightPaise).toBe(Math.round((449_900 * 30) / 100));
    expect(fare.accidentPaise).toBe(300_000);
  });
});

describe('haversineMeters (§19.2 fallback)', () => {
  it('is zero for a point against itself', () => {
    expect(haversineMeters({ lat: 12.97, lng: 77.59 }, { lat: 12.97, lng: 77.59 })).toBe(0);
  });

  it('matches a known Bengaluru → Chennai great-circle distance within 1 %', () => {
    // Bengaluru (12.9716, 77.5946) → Chennai (13.0827, 80.2707) ≈ 290 km.
    const m = haversineMeters({ lat: 12.9716, lng: 77.5946 }, { lat: 13.0827, lng: 80.2707 });
    expect(m / 1000).toBeGreaterThan(287);
    expect(m / 1000).toBeLessThan(293);
  });

  it('is symmetric', () => {
    const a = { lat: 12.9, lng: 77.5 };
    const b = { lat: 13.1, lng: 77.8 };
    expect(haversineMeters(a, b)).toBeCloseTo(haversineMeters(b, a), 6);
  });
});
