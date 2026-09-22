import type { INestApplication } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { complianceDocuments, drivers, payouts } from '../../db/schema';
import { authHeaderFor, createTestApp } from '../../test/app';
import { ComplianceService } from '../compliance/compliance.service';
import { PayoutsService } from '../money/payouts.service';
import {
  seedCustomer,
  seedDriver,
  seedFleet,
  setupTestDatabase,
  truncateAll,
  type TestDatabase,
} from '../../test/db';
import { seedBooking, seedTruck, seedWalletWithLedger } from '../../test/fixtures';

describe('dashboard e2e (/v1/fleet/dashboard)', () => {
  let app: INestApplication;
  let db: TestDatabase;
  let auth: string;
  let fleetId: string;

  beforeAll(async () => {
    db = await setupTestDatabase();
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await truncateAll();
    const fleet = await seedFleet(db, 'Dashboard Fleet');
    fleetId = fleet.fleetId;
    auth = await authHeaderFor(app, { userId: fleet.ownerId, fleetId });
  });

  it('computes KPIs and serves stored alerts produced by the compliance sweep', async () => {
    // 2 active trucks + 1 inactive → activeTrucks 2, totalTrucks 3.
    const truck1 = await seedTruck(db, fleetId, { plate: 'KA-DB-0001' });
    await seedTruck(db, fleetId, { plate: 'KA-DB-0002' });
    await seedTruck(db, fleetId, { plate: 'KA-DB-0003', status: 'inactive' });

    // One driver on truck1 with a live booking → utilization 1/2 = 50%.
    const driverId = await seedDriver(db, { fleetId, name: 'Busy Driver' });
    await db.update(drivers).set({ assignedTruckId: truck1 }).where(eq(drivers.id, driverId));
    const customerId = await seedCustomer(db);
    await seedBooking(db, { userId: customerId, fleetId, driverId, status: 'en_route' });
    // A second booking today, not active → jobsToday 2, utilization unchanged.
    await seedBooking(db, { userId: customerId, fleetId, driverId, status: 'paid' });

    // ₹150 fleet share today + ₹999 yesterday → revenueTodayPaise 15000.
    await seedWalletWithLedger(db, { ownerId: fleetId, ownerType: 'fleet' }, [
      { type: 'fleet_share_credit', amount: '150.00' },
      {
        type: 'fleet_share_credit',
        amount: '999.00',
        createdAt: new Date(Date.now() - 2 * 86_400_000),
      },
    ]);

    // Expired doc + failed payout → two error alerts, from two DIFFERENT
    // mechanisms since Phase 7.
    await db.insert(complianceDocuments).values({
      truckId: truck1,
      docType: 'insurance',
      expiresAt: new Date(Date.now() - 86_400_000),
      status: 'expired',
    });

    // Phase 6: alerts are STORED, not derived on read. Running the sweep is
    // what turns the fixture above into alert rows — which means this test
    // covers the whole pipeline rather than a read-time projection.
    await app.get(ComplianceService).sweep('manual', fleetId);

    // The payout alert no longer comes from that sweep. Phase 6 synced failed
    // payouts inside it as an explicit stopgap; Phase 7 opens the alert AT THE
    // POINT OF FAILURE, so this goes through the real transition instead.
    const [payout] = await db
      .insert(payouts)
      .values({
        ownerId: fleetId,
        ownerType: 'fleet',
        amount: '42300.00',
        status: 'processing',
        idempotencyKey: 'test:dashboard:payout',
      })
      .returning({ id: payouts.id });
    // The compensating `adjustment` credit this writes does not touch
    // `revenueTodayPaise` — that KPI counts `fleet_share_credit` only.
    await app.get(PayoutsService).markFailed(payout!.id, 'check bank details');

    const res = await request(app.getHttpServer())
      .get('/v1/fleet/dashboard')
      .set('Authorization', auth)
      .expect(200);

    // truck1's insurance is expired, so the sweep moved it to `non_compliant`
    // (§3.2 — expired papers exclude a truck from dispatch). That is the whole
    // point of the phase, and it moves both KPIs: 3 trucks, of which one is
    // manually inactive and one is now blocked, leaves 1 active. The blocked
    // truck is still the one on a job, so utilization is 1/1.
    expect(res.body.kpis).toEqual({
      activeTrucks: 1,
      totalTrucks: 3,
      jobsToday: 2,
      revenueTodayPaise: 15_000,
      utilizationPct: 100,
    });

    // The assertion survives Phase 7 unchanged while the mechanism behind half
    // of it moved: `doc_expired` still comes from the sweep, `payout_failed`
    // now comes from `PayoutsService.markFailed` at the point of failure.
    const types = res.body.alerts.map((a: { type: string }) => a.type).sort();
    expect(types).toEqual(['doc_expired', 'payout_failed']);
    const docAlert = res.body.alerts.find((a: { type: string }) => a.type === 'doc_expired');
    expect(docAlert.message).toContain('KA-DB-0001');
    expect(docAlert.href).toMatch(/^\/trucks\?truck=[0-9a-f-]{36}$/);
  });

  it('serves from the 15s cache within the TTL', async () => {
    const customerId = await seedCustomer(db);
    const first = await request(app.getHttpServer())
      .get('/v1/fleet/dashboard')
      .set('Authorization', auth)
      .expect(200);
    expect(first.body.kpis.jobsToday).toBe(0);

    // New booking lands after the first read — the cached value must win.
    await seedBooking(db, { userId: customerId, fleetId, status: 'paid' });
    const second = await request(app.getHttpServer())
      .get('/v1/fleet/dashboard')
      .set('Authorization', auth)
      .expect(200);
    expect(second.body.kpis.jobsToday).toBe(0);
  });

  it('shows a failed-payout alert immediately, not after the 15s TTL', async () => {
    // The regression net for `FleetEvent.payout_status`. The alert feed lives
    // inside `dash:{fleetId}`, so without the emit (and its cache bust) a
    // payout failure would be invisible for up to 15 seconds — which is the
    // exact class of bug FleetEventsService was created to prevent.
    const warm = await request(app.getHttpServer())
      .get('/v1/fleet/dashboard')
      .set('Authorization', auth)
      .expect(200);
    expect(warm.body.alerts).toEqual([]);

    const [payout] = await db
      .insert(payouts)
      .values({
        ownerId: fleetId,
        ownerType: 'fleet',
        amount: '1000.00',
        status: 'processing',
        idempotencyKey: 'test:dashboard:live-payout',
      })
      .returning({ id: payouts.id });
    await app.get(PayoutsService).markFailed(payout!.id, 'bank rejected');

    const res = await request(app.getHttpServer())
      .get('/v1/fleet/dashboard')
      .set('Authorization', auth)
      .expect(200);

    expect(res.body.alerts.map((a: { type: string }) => a.type)).toEqual(['payout_failed']);
  });

  it('reports zero utilization with no active trucks instead of dividing by zero', async () => {
    const res = await request(app.getHttpServer())
      .get('/v1/fleet/dashboard')
      .set('Authorization', auth)
      .expect(200);
    expect(res.body.kpis.utilizationPct).toBe(0);
    expect(res.body.kpis.totalTrucks).toBe(0);
  });
});
