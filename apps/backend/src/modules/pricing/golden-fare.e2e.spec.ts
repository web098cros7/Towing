import { rupeeStringToPaise, resolveBand } from '@towing/api-contracts';
import { isNotNull } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bookings } from '../../db/schema';
import { runSeed, verifySeedInvariants } from '../../db/seed/seed';
import { setupTestDatabase, truncateAll, type TestDatabase } from '../../test/db';
import { baseFarePaise, commissionPaise } from './pricing.math';

/**
 * THE GOLDEN FILE. Re-price every seeded booking through the live engine and
 * assert it reproduces the fare already stored on the row.
 *
 * Why this is worth having, in the plan's own words: the Phase 3 seed was
 * already §7-correct, so it becomes the oracle for free. 506 bookings spanning
 * every service, both vehicle classes, all three bands and distances from 1 km
 * to 450 km are a far broader fare corpus than any hand-written table of cases,
 * and they were written by code that predates this phase.
 *
 * WHAT IT CAN AND CANNOT PROVE. The seed chooses each booking's SCENARIO with an
 * RNG — was it at night, did the zone surge, did the driver wait — and those
 * flags are not stored on the row. So a re-price from stored columns cannot
 * reproduce `night_charge` or `surge_amount`, and asserting on them would be
 * asserting on a coin flip. What IS reproducible from `(service_type,
 * vehicle_class, distance_km)` alone is the BASE FARE, and what is reproducible
 * from the stored `total` is the entire §3.3/§7 commission split. Those are the
 * two things this file pins, and between them they cover the slab tables, the
 * roadside fares, the Band C interpolation, band resolution and the half-up
 * rounding.
 *
 * If this ever fails, the engine and the seed have diverged — which since Phase
 * 14 should be impossible, because the seed calls the engine.
 */
describe('golden file — re-pricing the seed through the live engine', () => {
  let db: TestDatabase;
  let rows: Array<{
    id: string;
    serviceType:
      | 'tow'
      | 'battery'
      | 'flat_tyre'
      | 'fuel'
      | 'breakdown'
      | 'accident_recovery'
      | 'lockout';
    vehicleClass: 'wheel_lift' | 'flatbed';
    distanceKm: string | null;
    baseFare: string;
    total: string;
    commissionBand: 'A' | 'B' | 'C' | null;
    commissionPct: string | null;
    commissionAmount: string;
    driverPayout: string;
  }>;

  beforeAll(async () => {
    db = await setupTestDatabase();
    await truncateAll();
    await runSeed(db, { reset: false });

    rows = await db
      .select({
        id: bookings.id,
        serviceType: bookings.serviceType,
        vehicleClass: bookings.vehicleClass,
        distanceKm: bookings.distanceKm,
        baseFare: bookings.baseFare,
        total: bookings.total,
        commissionBand: bookings.commissionBand,
        commissionPct: bookings.commissionPct,
        commissionAmount: bookings.commissionAmount,
        driverPayout: bookings.driverPayout,
      })
      .from(bookings)
      .where(isNotNull(bookings.distanceKm));
  }, 180_000);

  afterAll(async () => {
    await truncateAll();
  });

  it('seeded a corpus broad enough for this to mean something', () => {
    expect(rows.length).toBeGreaterThan(400);
    const bands = new Set(rows.map((r) => r.commissionBand));
    expect(bands).toContain('A');
    expect(bands).toContain('B');
    expect(bands).toContain('C');
    const servicesSeen = new Set(rows.map((r) => r.serviceType));
    expect(servicesSeen.size).toBe(6);
    expect(new Set(rows.map((r) => r.vehicleClass)).size).toBe(2);
  });

  it('reproduces every stored base fare exactly', () => {
    const mismatches = rows
      .map((row) => {
        const distanceKm = Number(row.distanceKm);
        const expected = baseFarePaise(row.serviceType, row.vehicleClass, distanceKm);
        const stored = rupeeStringToPaise(row.baseFare);
        return stored === expected
          ? null
          : { id: row.id, service: row.serviceType, distanceKm, stored, expected };
      })
      .filter(Boolean);

    expect(mismatches).toEqual([]);
  });

  it('reproduces every stored band from service type and billed distance (§3.3)', () => {
    const mismatches = rows
      .filter((row) => row.commissionBand !== null)
      .map((row) => {
        const expected = resolveBand(row.serviceType, Number(row.distanceKm));
        return row.commissionBand === expected
          ? null
          : { id: row.id, stored: row.commissionBand, expected };
      })
      .filter(Boolean);

    expect(mismatches).toEqual([]);
  });

  it('reproduces every settled commission and payout from the stored total (§7)', () => {
    // Only settled rows carry a non-zero split — the seed leaves commission and
    // payout at 0 until a booking progresses, which is correct: §19.2 says
    // credit happens on capture, never at completion.
    const settled = rows.filter((row) => rupeeStringToPaise(row.commissionAmount) > 0);
    expect(settled.length).toBeGreaterThan(100);

    const mismatches = settled
      .map((row) => {
        const totalPaise = rupeeStringToPaise(row.total);
        const expectedCommission = commissionPaise(totalPaise, row.commissionBand!);
        const storedCommission = rupeeStringToPaise(row.commissionAmount);
        const storedPayout = rupeeStringToPaise(row.driverPayout);

        if (storedCommission !== expectedCommission) {
          return { id: row.id, field: 'commission', stored: storedCommission, expected: expectedCommission };
        }
        // §7: "driver net = total − commission (so the two always sum exactly)".
        if (storedCommission + storedPayout !== totalPaise) {
          return { id: row.id, field: 'sum', stored: storedCommission + storedPayout, expected: totalPaise };
        }
        return null;
      })
      .filter(Boolean);

    expect(mismatches).toEqual([]);
  });

  it('stores a commission_pct inside the §3.3 guardrail on every priced row', () => {
    for (const row of rows) {
      if (row.commissionPct === null) continue;
      const pct = Number(row.commissionPct);
      expect(pct).toBeGreaterThanOrEqual(5);
      expect(pct).toBeLessThanOrEqual(10);
    }
  });

  it('leaves the ledger invariants at zero drift', async () => {
    const invariants = await verifySeedInvariants(db);
    expect(invariants.walletDrift).toBe(0);
    expect(invariants.bookingDrift).toBe(0);
    expect(invariants.ledgerDrift).toBe(0);
  });
});
