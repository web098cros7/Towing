/**
 * The deterministic RNG the seeder and the location simulator share.
 *
 * WHAT LEFT IN PHASE 14. This file used to own the §7 fare engine too — the
 * §7.1/§7.2 slabs, the §7.3 long-distance ranges and `baseFarePaise`. Those are
 * now `modules/pricing/pricing.math.ts` and, at runtime, rows in `pricing_rules`:
 * §6.7 requires them to change without a deploy, which a `const` in a seed file
 * cannot. `pricing.spec.ts` moved with them and is now `pricing.math.spec.ts`.
 *
 * What left before that, in Phase 7: the §3.3 bands, the commission formula and
 * the §14.3 split went to `@towing/api-contracts`, so the seed and the live
 * `LedgerService` are provably the same arithmetic rather than two
 * implementations that happen to agree. They are re-exported here so this
 * module's callers are unchanged.
 *
 * What stays: `createRng` and its two helpers are a FIXTURE concern. They pick
 * which scenario a seeded booking represents — was it at night, did it surge,
 * how far was it. The arithmetic that turns that scenario into money is the
 * engine's, and `seed.ts` now calls it rather than owning a second copy.
 */
export {
  BAND_PCT,
  commissionPaise,
  resolveBand,
  splitPool,
  splitPoolN,
  type Band,
} from '@towing/api-contracts';

/**
 * Re-exported so `seed.ts` and `settlement.spec.ts` keep importing money helpers
 * from one place. The implementations live in `modules/pricing/pricing.math.ts`.
 */
export {
  baseFarePaise,
  computeFare,
  toRupees,
  type VehicleClass,
} from '../../modules/pricing/pricing.math';

export type ServiceType =
  | 'tow'
  | 'battery'
  | 'flat_tyre'
  | 'fuel'
  | 'breakdown'
  | 'accident_recovery'
  | 'lockout';

/**
 * mulberry32 — same generator as the location simulator so a seed value means
 * the same thing in both tools.
 */
export function createRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

export function pick<T>(rng: () => number, items: readonly T[]): T {
  if (items.length === 0) throw new Error('pick() on empty array');
  return items[Math.floor(rng() * items.length)]!;
}

export function weighted<T>(rng: () => number, entries: ReadonlyArray<readonly [T, number]>): T {
  const total = entries.reduce((s, [, w]) => s + w, 0);
  let roll = rng() * total;
  for (const [value, weight] of entries) {
    roll -= weight;
    if (roll <= 0) return value;
  }
  return entries[entries.length - 1]![0];
}
