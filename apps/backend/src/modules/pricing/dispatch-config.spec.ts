import {
  DISPATCH_CONFIG_DEFAULTS,
  GLOBAL_DISPATCH_CONFIG_DEFAULTS,
  dispatchConfigOverrideSchema,
  globalDispatchConfigSchema,
  resolveDispatchConfig,
  scorerWeightsSchema,
} from '@towing/api-contracts';
import { describe, expect, it } from 'vitest';
import { STANDALONE_ZONES } from '../../db/seed/fixtures';
import { FLEETS } from '../../db/seed/fixtures';

/**
 * §6.7's per-zone knobs and §6.2's global weights.
 *
 * The thing this file exists to protect is the NULL path. Phase 17's matcher
 * reads `service_zones.dispatch_config`, a column that was nullable and unwritten
 * for four phases; if `resolveDispatchConfig` returned `undefined` fields for a
 * NULL row, the matcher would fall back to its own constants and the config
 * table would be decorative.
 */

describe('resolveDispatchConfig — the NULL-column path', () => {
  it('returns the typed defaults for a zone that has never been configured', () => {
    expect(resolveDispatchConfig(null)).toEqual(DISPATCH_CONFIG_DEFAULTS);
    expect(resolveDispatchConfig(undefined)).toEqual(DISPATCH_CONFIG_DEFAULTS);
  });

  it('never returns an undefined field, whatever it is handed', () => {
    // The actual failure mode: a matcher doing `config.offersPerWave` and
    // getting `undefined`, then `Array(undefined)` or a silent no-op wave.
    for (const input of [null, undefined, {}, { radiusLadderKm: [5, 2] }, 'nonsense', 42, []]) {
      const resolved = resolveDispatchConfig(input);
      expect(Object.values(resolved).every((v) => v !== undefined && v !== null)).toBe(true);
      expect(resolved.radiusLadderKm.length).toBeGreaterThan(0);
      expect(resolved.offersPerWave).toBeGreaterThan(0);
      expect(resolved.maxSearchSeconds).toBeGreaterThan(0);
    }
  });

  it('returns a fresh object each time — a caller cannot mutate the defaults', () => {
    const first = resolveDispatchConfig(null);
    first.radiusLadderKm.push(999);
    first.offersPerWave = 99;
    expect(resolveDispatchConfig(null)).toEqual(DISPATCH_CONFIG_DEFAULTS);
    expect(DISPATCH_CONFIG_DEFAULTS.offersPerWave).toBe(3);
  });
});

describe('resolveDispatchConfig — overrides actually apply', () => {
  it('applies a partial override and defaults the rest', () => {
    const resolved = resolveDispatchConfig({ offersPerWave: 4 });
    expect(resolved.offersPerWave).toBe(4);
    expect(resolved.radiusLadderKm).toEqual(DISPATCH_CONFIG_DEFAULTS.radiusLadderKm);
    expect(resolved.maxSearchSeconds).toBe(DISPATCH_CONFIG_DEFAULTS.maxSearchSeconds);
  });

  it('applies a PER-SERVICE override over the zone override', () => {
    // THE REGRESSION THIS FILE WAS WRITTEN FOR. `perService` was first declared
    // with `z.record(serviceTypeSchema, …)`, and in zod 4 a record keyed by an
    // enum is EXHAUSTIVE — it demands every member. `{ fuel: {…} }` therefore
    // failed to parse and `resolveDispatchConfig` silently returned the
    // defaults: the override was accepted, stored, and ignored. Asserting the
    // override APPLIES is what catches that; asserting it merely parses does not.
    const resolved = resolveDispatchConfig(
      { offersPerWave: 4, perService: { fuel: { radiusLadderKm: [2, 4, 7] } } },
      'fuel',
    );
    expect(resolved.radiusLadderKm).toEqual([2, 4, 7]);
    expect(resolved.offersPerWave).toBe(4);
  });

  it('ignores a per-service override for a different service', () => {
    const raw = { perService: { fuel: { radiusLadderKm: [2, 4, 7] } } };
    expect(resolveDispatchConfig(raw, 'tow').radiusLadderKm).toEqual(
      DISPATCH_CONFIG_DEFAULTS.radiusLadderKm,
    );
    expect(resolveDispatchConfig(raw).radiusLadderKm).toEqual(
      DISPATCH_CONFIG_DEFAULTS.radiusLadderKm,
    );
  });

  describe('the PLATFORM per-service layer (W12)', () => {
    it('applies to a zone that overrides nothing', () => {
      const resolved = resolveDispatchConfig(null, 'fuel', { fuel: 1 });
      expect(resolved.offersPerWave).toBe(1);
      // Only `offersPerWave` has a platform per-service layer; everything else
      // still comes from the code defaults.
      expect(resolved.offerTimeoutSeconds).toBe(DISPATCH_CONFIG_DEFAULTS.offerTimeoutSeconds);
    });

    it('is overridden by the zone, which is the point of the order', () => {
      const zone = resolveDispatchConfig({ offersPerWave: 5 }, 'fuel', { fuel: 1 });
      expect(zone.offersPerWave).toBe(5);

      const perService = resolveDispatchConfig(
        { perService: { fuel: { offersPerWave: 3 } } },
        'fuel',
        { fuel: 1 },
      );
      expect(perService.offersPerWave).toBe(3);
    });

    it('does nothing for a service it does not name', () => {
      const resolved = resolveDispatchConfig(null, 'tow', { fuel: 1 });
      expect(resolved.offersPerWave).toBe(DISPATCH_CONFIG_DEFAULTS.offersPerWave);
    });
  });
});

describe('dispatchConfigOverrideSchema — what an admin may write', () => {
  it('rejects a ladder that is not strictly ascending', () => {
    // A descending rung means wave 3 searches a SMALLER circle than wave 2, so
    // the search narrows as it is supposed to widen.
    expect(dispatchConfigOverrideSchema.safeParse({ radiusLadderKm: [2, 4, 3] }).success).toBe(
      false,
    );
    expect(dispatchConfigOverrideSchema.safeParse({ radiusLadderKm: [2, 2] }).success).toBe(false);
    expect(dispatchConfigOverrideSchema.safeParse({ radiusLadderKm: [2, 4, 7] }).success).toBe(
      true,
    );
  });

  it('rejects an empty ladder and a negative radius', () => {
    expect(dispatchConfigOverrideSchema.safeParse({ radiusLadderKm: [] }).success).toBe(false);
    expect(dispatchConfigOverrideSchema.safeParse({ radiusLadderKm: [-1, 5] }).success).toBe(false);
  });

  it('rejects out-of-range timings', () => {
    expect(dispatchConfigOverrideSchema.safeParse({ offerTimeoutSeconds: 2 }).success).toBe(false);
    expect(dispatchConfigOverrideSchema.safeParse({ offersPerWave: 0 }).success).toBe(false);
    expect(dispatchConfigOverrideSchema.safeParse({ maxSearchSeconds: 10 }).success).toBe(false);
  });

  it('accepts an empty object — "override nothing" is a legal config', () => {
    expect(dispatchConfigOverrideSchema.safeParse({}).success).toBe(true);
  });

  it('carries no field defaults, so a partial write cannot reset its neighbours', () => {
    // Phase 13's bug, in the shape it would take here: if the schema defaulted
    // its fields, parsing `{ offersPerWave: 4 }` would return all five keys and
    // an admin editing one knob would silently rewrite the other four.
    const parsed = dispatchConfigOverrideSchema.parse({ offersPerWave: 4 });
    expect(Object.keys(parsed)).toEqual(['offersPerWave']);
  });
});

describe('every seeded dispatch_config validates', () => {
  // The plan asks for "dispatch_config schema validation on seed". Reading the
  // fixtures directly rather than the database keeps this a unit test, and the
  // seed writes these objects verbatim.
  const seeded = [
    ...FLEETS.map((fleet) => [fleet.zone.name, fleet.zone.dispatchConfig] as const),
    ...STANDALONE_ZONES.map((zone) => [zone.name, zone.dispatchConfig] as const),
  ];

  it.each(seeded)('%s', (_name, config) => {
    expect(dispatchConfigOverrideSchema.safeParse(config ?? {}).success).toBe(true);
  });

  it('seeds at least one zone with a real override, not just NULLs', () => {
    expect(seeded.filter(([, config]) => config !== undefined).length).toBeGreaterThan(0);
  });
});

describe('scorerWeightsSchema (§6.2)', () => {
  it('accepts the launch weights', () => {
    expect(scorerWeightsSchema.safeParse(GLOBAL_DISPATCH_CONFIG_DEFAULTS.weights).success).toBe(
      true,
    );
  });

  it('rejects weights that do not sum to 100', () => {
    // The scorer normalises against 100. Weights summing to anything else
    // rescale every score silently — the ranking ORDER survives, so nothing
    // looks wrong until a threshold is compared against.
    expect(
      scorerWeightsSchema.safeParse({ proximity: 60, rating: 20, acceptance: 15, completion: 10 })
        .success,
    ).toBe(false);
  });

  it('matches the CHECK constraint the migration puts on the same numbers', () => {
    // `ck_dispatch_config_weights_sum` enforces exactly this in SQL. If the two
    // ever disagree, one of them is decorative.
    const { proximity, rating, acceptance, completion } = GLOBAL_DISPATCH_CONFIG_DEFAULTS.weights;
    expect(proximity + rating + acceptance + completion).toBe(100);
  });
});

describe('globalDispatchConfigSchema', () => {
  it('accepts the defaults and rejects an unusable stale-ping threshold', () => {
    expect(globalDispatchConfigSchema.safeParse(GLOBAL_DISPATCH_CONFIG_DEFAULTS).success).toBe(
      true,
    );
    expect(
      globalDispatchConfigSchema.safeParse({
        ...GLOBAL_DISPATCH_CONFIG_DEFAULTS,
        stalePingSeconds: 1,
      }).success,
    ).toBe(false);
  });
});
