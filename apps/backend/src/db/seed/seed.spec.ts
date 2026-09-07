import { sql } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { verifyPassword } from '../../modules/auth/password';
import { setupTestDatabase, type TestDatabase } from '../../test/db';
import { FLEETS, SEED_PASSWORD } from './fixtures';
import { runSeed, verifySeedInvariants, type SeedSummary } from './seed';

/**
 * Runs the real seed against the throwaway stack, then audits it. This is the
 * regression net for the money model: if a future change to fares, splits or
 * the ledger writer breaks §14 discipline, these assertions catch it before a
 * human stares at a wrong balance.
 */
describe('seed (deterministic dataset + §14 invariants)', () => {
  let db: TestDatabase;
  let summary: SeedSummary;

  async function count(query: ReturnType<typeof sql>): Promise<number> {
    const [row] = (await db.execute(query)) as unknown as [{ count: number }];
    return row.count;
  }

  beforeAll(async () => {
    db = await setupTestDatabase();
    const result = await runSeed(db, { reset: true });
    if (!result) throw new Error('runSeed returned null despite reset: true');
    summary = result;
  });

  it('produces the deterministic entity counts', () => {
    expect(summary).toMatchObject({
      fleets: 2,
      trucks: 20,
      complianceDocs: 79, // 20 trucks × 4 docs − 1 deliberately missing PUC
      drivers: 14, // 12 + 1 rejected + 1 suspended (Phase 11)
      customers: 20,
      bookings: 506, // 260 + 210 + 30 historical + 6 live
      wallets: 12, // 2 fleet + 10 approved drivers — rejected/suspended get none
      driverDocuments: 17, // pending(5) + rejected(5) + incomplete(2) + suspended(5)
    });
  });

  it('seeds all five KYC states with at least one driver (Phase 11 admin queue)', async () => {
    const rows = (await db.execute(sql`
      select kyc_status, count(*)::int as count from drivers group by kyc_status
    `)) as unknown as Array<{ kyc_status: string; count: number }>;
    const byStatus = Object.fromEntries(rows.map((r) => [r.kyc_status, r.count]));

    expect(byStatus['approved']).toBeGreaterThan(0);
    expect(byStatus['pending']).toBe(1);
    expect(byStatus['incomplete']).toBe(1);
    expect(byStatus['rejected']).toBe(1);
    expect(byStatus['suspended']).toBe(1);
  });

  it('only submitted drivers (pending/rejected/suspended) carry kyc_submitted_at', async () => {
    const mismatches = await count(sql`
      select count(*)::int as count
      from drivers
      where (kyc_status in ('pending', 'rejected', 'suspended')) <> (kyc_submitted_at is not null)
    `);
    expect(mismatches).toBe(0);
  });

  it('the pending queue holds exactly the pending driver, never the incomplete one', async () => {
    const pendingNames = (await db.execute(sql`
      select name from drivers where kyc_status = 'pending' order by name
    `)) as unknown as Array<{ name: string }>;
    expect(pendingNames.map((r) => r.name)).toEqual(['Prakash Naik']);
  });

  it('refuses to reseed a non-empty database without reset', async () => {
    await expect(runSeed(db, { reset: false })).resolves.toBeNull();
  });

  it('holds every §14 money invariant', async () => {
    await expect(verifySeedInvariants(db)).resolves.toEqual({
      walletDrift: 0,
      bookingDrift: 0,
      ledgerDrift: 0,
      reversalDrift: 0,
      couponDrift: 0,
    });
  });

  it('every paid booking has exactly one captured payment for its total', async () => {
    const mismatches = await count(sql`
      select count(*)::int as count
      from bookings b
      left join lateral (
        select count(*) as n, coalesce(sum(amount), 0) as paid
        from payments p where p.booking_id = b.id and p.status = 'captured'
      ) x on true
      where b.status = 'paid' and (x.n <> 1 or x.paid <> b.total)
    `);
    expect(mismatches).toBe(0);
  });

  it('never assigns a booking to a driver of a different fleet (tenancy)', async () => {
    const crossTenant = await count(sql`
      select count(*)::int as count
      from bookings b
      join drivers d on d.id = b.driver_id
      where b.fleet_id is distinct from d.fleet_id
    `);
    expect(crossTenant).toBe(0);
  });

  it('every fleet-share ledger credit lands in the wallet of the booking fleet', async () => {
    const misrouted = await count(sql`
      select count(*)::int as count
      from wallet_transactions t
      join wallets w on w.id = t.wallet_id
      join bookings b on b.id = t.ref_id
      where t.type = 'fleet_share_credit'
        and (w.owner_type <> 'fleet' or w.owner_id <> b.fleet_id)
    `);
    expect(misrouted).toBe(0);
  });

  it('marks a truck non_compliant exactly when it holds an expired document', async () => {
    const wronglyFlagged = await count(sql`
      select count(*)::int as count
      from fleet_trucks t
      where (t.status = 'non_compliant') <> exists (
        select 1 from compliance_documents c
        where c.truck_id = t.id and c.status = 'expired'
      )
      and t.status <> 'inactive'
    `);
    expect(wronglyFlagged).toBe(0);
  });

  it('only KYC-approved drivers appear on bookings (§3.1 supply gate)', async () => {
    const unapproved = await count(sql`
      select count(*)::int as count
      from bookings b
      join drivers d on d.id = b.driver_id
      where d.kyc_status <> 'approved'
    `);
    expect(unapproved).toBe(0);
  });

  it('seeds a fleet-affiliated, truck-assigned, approved driver (Phase 16 acceptance)', async () => {
    /**
     * PINNED BECAUSE THE PHASE-16 ACCEPTANCE CRITERION IS UNREACHABLE WITHOUT IT.
     *
     * "The fleet map shows a real driver" requires a driver whose ping the fleet
     * fan-out can translate, and that needs all three of: an approved KYC state,
     * a `fleet_id`, and an `assigned_truck_id`. An independent driver — which is
     * exactly what Phase 12's self-signup creates — has the last two null by
     * construction and correctly produces no fleet fan-out at all.
     *
     * The seed already produces these as a side effect of its truck-assignment
     * loop. This asserts it, so a future change to that loop fails here rather
     * than silently making a cross-surface criterion untestable.
     */
    const fanoutCapable = await count(sql`
      select count(*)::int as count
      from drivers
      where kyc_status = 'approved'
        and fleet_id is not null
        and assigned_truck_id is not null
    `);
    expect(fanoutCapable).toBeGreaterThan(0);

    // ...and the other half of the pair, so both branches of the adapter have a
    // fixture: an approved driver who belongs on no fleet map.
    const independent = await count(sql`
      select count(*)::int as count
      from drivers
      where kyc_status = 'approved' and fleet_id is null
    `);
    expect(independent).toBeGreaterThan(0);
  });

  it('seeded console credentials verify with the documented password', async () => {
    const rows = (await db.execute(sql`
      select email, password_hash from fleet_owner_credentials order by email
    `)) as unknown as Array<{ email: string; password_hash: string }>;

    expect(rows.map((r) => r.email).sort()).toEqual(
      FLEETS.map((f) => f.owner.email).sort(),
    );
    for (const row of rows) {
      await expect(verifyPassword(SEED_PASSWORD, row.password_hash)).resolves.toBe(true);
    }
  });
});
