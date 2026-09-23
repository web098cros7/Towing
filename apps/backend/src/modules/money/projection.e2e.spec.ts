import type { INestApplication } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp } from '../../test/app';
import { seedDriver, seedFleet, setupTestDatabase, truncateAll, type TestDatabase } from '../../test/db';
import { seedCustomerBooking } from '../../test/fixtures';
import { LedgerService } from '../../db/ledger/ledger.service';
import { projectCell, rebuildEarnings } from './earnings-projector';
import { EarningsProjectorService } from './earnings-projector.service';

describe('earnings_daily projection (e2e)', () => {
  let app: INestApplication;
  let db: TestDatabase;
  let ledger: LedgerService;
  let projector: EarningsProjectorService;
  let fleetA: string;
  let fleetB: string;
  let driverA: string;

  beforeAll(async () => {
    db = await setupTestDatabase();
    app = await createTestApp();
    ledger = app.get(LedgerService);
    projector = app.get(EarningsProjectorService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await truncateAll();
    const a = await seedFleet(db, 'Projection Fleet A');
    const b = await seedFleet(db, 'Projection Fleet B');
    fleetA = a.fleetId;
    fleetB = b.fleetId;
    driverA = await seedDriver(db, { fleetId: fleetA, name: 'Projection Driver' });
  });

  const cells = async (fleetId: string) =>
    (await db.execute(sql`
      select to_char(day, 'YYYY-MM-DD') as day, driver_id, jobs, gross, commission,
             pool, driver_share, fleet_share
        from earnings_daily where fleet_id = ${fleetId}::uuid
       order by day
    `)) as unknown as Array<{
      day: string;
      driver_id: string;
      jobs: number;
      gross: string;
      commission: string;
      pool: string;
      driver_share: string;
      fleet_share: string;
    }>;

  /** Settle a booking at a given instant, then project its cell. */
  const settleAt = async (at: Date, totalPaise = 449_900): Promise<string> => {
    const bookingId = await seedCustomerBooking(db, {
      fleetId: fleetA,
      driverId: driverA,
      status: 'paid',
      total: (totalPaise / 100).toFixed(2),
    });

    await ledger.creditBookingSettlement({
      bookingId,
      totalPaise,
      band: 'A',
      driverId: driverA,
      fleet: { fleetId: fleetA, driverSharePct: 80 },
    });

    // The credits carry `now()`; back-date them so the IST-day assertions can
    // pick their own instant.
    await db.execute(sql`
      update wallet_transactions set created_at = ${at.toISOString()}::timestamptz
       where ref_id = ${bookingId}::uuid
    `);
    await db.execute(sql`
      update bookings set commission_amount = '449.90', driver_payout = '4049.10'
       where id = ${bookingId}::uuid
    `);

    return bookingId;
  };

  it('projects a settled booking into its IST-day cell', async () => {
    await settleAt(new Date('2026-07-15T09:00:00Z'));
    await rebuildEarnings(db, {});

    const rows = await cells(fleetA);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      day: '2026-07-15',
      driver_id: driverA,
      jobs: 1,
      gross: '4499.00',
      commission: '449.90',
      pool: '4049.10',
      driver_share: '3239.28',
      fleet_share: '809.82',
    });
  });

  it('is idempotent — projecting the same cell twice writes identical numbers', async () => {
    await settleAt(new Date('2026-07-15T09:00:00Z'));
    const key = { fleetId: fleetA, day: '2026-07-15', driverId: driverA };

    await projectCell(db, key);
    const first = await cells(fleetA);
    await projectCell(db, key);
    await projectCell(db, key);
    const third = await cells(fleetA);

    // The whole reason the projector recomputes absolutely instead of applying
    // a delta: BullMQ is at-least-once, and a redelivered additive job would
    // silently double these numbers with nothing failing.
    expect(third).toEqual(first);
  });

  it('DELETES the cell when its source credits are reversed', async () => {
    const bookingId = await settleAt(new Date('2026-07-15T09:00:00Z'));
    const key = { fleetId: fleetA, day: '2026-07-15', driverId: driverA };

    await projectCell(db, key);
    expect(await cells(fleetA)).toHaveLength(1);

    // A dispute reverses the credits (§14.5 compensating entries). The cell must
    // go to nothing — the classic projection bug is leaving stale numbers here
    // because the upsert simply matches zero rows and does nothing.
    await db.execute(sql`delete from wallet_transactions where ref_id = ${bookingId}::uuid`);

    expect(await projectCell(db, key)).toBe(false);
    expect(await cells(fleetA)).toHaveLength(0);
  });

  it('assigns money to the IST day, not the UTC day', async () => {
    // 2026-07-15T18:15:00Z is 2026-07-15 23:45 IST — same UTC day, same IST day.
    // 2026-07-15T19:30:00Z is 2026-07-16 01:00 IST — the UTC day has NOT rolled
    // over but the IST day has. A UTC-day projection puts this on the 15th and
    // disagrees with the dashboard's istDayStart()-based revenue by up to 5.5
    // hours of jobs every single night, with nothing failing loudly.
    await settleAt(new Date('2026-07-15T18:15:00Z'));
    await settleAt(new Date('2026-07-15T19:30:00Z'));
    await rebuildEarnings(db, {});

    const rows = await cells(fleetA);
    expect(rows.map((r) => r.day)).toEqual(['2026-07-15', '2026-07-16']);
    expect(rows.every((r) => r.jobs === 1)).toBe(true);
  });

  it('keeps fleets apart', async () => {
    await settleAt(new Date('2026-07-15T09:00:00Z'));
    await rebuildEarnings(db, {});

    expect(await cells(fleetA)).toHaveLength(1);
    expect(await cells(fleetB)).toHaveLength(0);
  });

  it('rebuild removes cells whose source rows are gone', async () => {
    const bookingId = await settleAt(new Date('2026-07-15T09:00:00Z'));
    await rebuildEarnings(db, {});
    expect(await cells(fleetA)).toHaveLength(1);

    await db.execute(sql`delete from wallet_transactions where ref_id = ${bookingId}::uuid`);
    const result = await rebuildEarnings(db, {});

    expect(result.cells).toBe(0);
    expect(result.deleted).toBe(1);
    expect(await cells(fleetA)).toHaveLength(0);
  });

  it('reconcile passes on a clean ledger and reports through /v1/health/ledger', async () => {
    await settleAt(new Date('2026-07-15T09:00:00Z'));
    await rebuildEarnings(db, {});

    const report = await projector.reconcile('manual');
    expect(report).toMatchObject({
      walletDrift: 0,
      bookingDrift: 0,
      ledgerDrift: 0,
      projectionDrift: 0,
      maxDeltaPaise: 0,
    });

    const res = await request(app.getHttpServer()).get('/v1/health/ledger').expect(200);
    expect(res.body).toMatchObject({ walletDrift: 0, driftedWallets: 0, maxDeltaPaise: 0 });
    expect(res.body.lastRun).toMatchObject({ walletDrift: 0 });
    // No tenant data on an unauthenticated probe.
    expect(JSON.stringify(res.body)).not.toContain(fleetA);
  });

  it('reconcile reports NO drift for a clean fleet trip inside its window', async () => {
    // Found 24 Sep: every fleet trip read as drift, ledger exactly double the
    // projection. A fleet trip settles as TWO legs (fleet share + driver
    // share) and the check summed the booking's total once per leg. The test
    // above could not see it: its trip is dated 15 July, outside the check's
    // 7-day window, so it passed without checking anything.
    await settleAt(new Date());
    await rebuildEarnings(db, {});

    const report = await projector.reconcile('manual');
    expect(report.projectionDrift).toBe(0);
  });

  it('reconcile detects injected wallet drift, surfaces it, and THROWS', async () => {
    await settleAt(new Date('2026-07-15T09:00:00Z'));

    // Exactly what a rogue second ledger writer would leave behind.
    await db.execute(sql`
      update wallets set balance = balance + 1
       where owner_type = 'driver' and owner_id = ${driverA}::uuid
    `);

    // Throwing is the alarm: BullMQ records a failed job, which raises
    // `deadLettered` on /health/queues and trips the depth alarm that already
    // exists. Auto-repair is deliberately not an option — it would erase the
    // evidence of whatever caused the drift.
    await expect(projector.reconcile('manual')).rejects.toThrow(/drift/i);

    const res = await request(app.getHttpServer()).get('/v1/health/ledger').expect(200);
    expect(res.body.walletDrift).toBe(1);
    expect(res.body.driftedWallets).toBe(1);
    expect(res.body.maxDeltaPaise).toBe(100);
  });

  it('reconcile re-enqueues a drifted projection cell instead of only counting it', async () => {
    await settleAt(new Date());
    await rebuildEarnings(db, {});

    // Corrupt the projection the way a lost job would.
    await db.execute(sql`update earnings_daily set gross = gross + 100 where fleet_id = ${fleetA}::uuid`);

    const report = await projector.reconcile('manual');
    expect(report.projectionDrift).toBe(1);
    // Ledger itself is untouched, so the job must not fail on this alone.
    expect(report.walletDrift).toBe(0);
  });
});
