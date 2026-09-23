import type { INestApplication } from '@nestjs/common';
import { fleetDriverPerformanceSchema } from '@towing/api-contracts';
import { sql } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { istMonthStart } from '../../common/time/ist';
import { authHeaderFor, createTestApp } from '../../test/app';
import { expectMatchesContract } from '../../test/contracts';
import {
  seedCustomer,
  seedDriver,
  seedFleet,
  setupTestDatabase,
  truncateAll,
  uniqueMobile,
  type TestDatabase,
} from '../../test/db';
import { seedBooking, seedTruck, seedWalletWithLedger } from '../../test/fixtures';

describe('drivers e2e (/v1/fleet/drivers)', () => {
  let app: INestApplication;
  let db: TestDatabase;
  let authA: string;
  let authB: string;
  let fleetA: string;
  let fleetB: string;
  let ownerA: string;

  beforeAll(async () => {
    db = await setupTestDatabase();
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await truncateAll();
    const a = await seedFleet(db, 'Fleet A');
    const b = await seedFleet(db, 'Fleet B');
    fleetA = a.fleetId;
    fleetB = b.fleetId;
    ownerA = a.ownerId;
    authA = await authHeaderFor(app, { userId: a.ownerId, fleetId: a.fleetId });
    authB = await authHeaderFor(app, { userId: b.ownerId, fleetId: b.fleetId });
  });

  it('computes month-net from this month’s driver_share_credit only', async () => {
    const driverId = await seedDriver(db, { fleetId: fleetA, name: 'Ledger Driver' });
    const monthStart = istMonthStart();
    await seedWalletWithLedger(db, { ownerId: driverId, ownerType: 'driver' }, [
      { type: 'driver_share_credit', amount: '1000.00', createdAt: new Date(monthStart.getTime() + 3_600_000) },
      { type: 'driver_share_credit', amount: '499.50', createdAt: new Date() },
      // Excluded: last month, and a debit of the wrong type.
      { type: 'driver_share_credit', amount: '5000.00', createdAt: new Date(monthStart.getTime() - 86_400_000) },
      { type: 'payout_debit', amount: '-200.00', createdAt: new Date() },
    ]);

    const res = await request(app.getHttpServer())
      .get('/v1/fleet/drivers')
      .set('Authorization', authA)
      .expect(200);

    expect(res.body.total).toBe(1);
    expect(res.body.items[0].monthNetPaise).toBe(149_950); // 1000.00 + 499.50
  });

  it('invites a driver as kyc-incomplete and rejects duplicate mobiles (409)', async () => {
    const mobile = uniqueMobile();
    const created = await request(app.getHttpServer())
      .post('/v1/fleet/drivers')
      .set('Authorization', authA)
      .send({ name: 'New Driver', mobile, vehicleClass: 'wheel_lift' })
      .expect(201);
    expect(created.body.kycStatus).toBe('incomplete');

    const dup = await request(app.getHttpServer())
      .post('/v1/fleet/drivers')
      .set('Authorization', authB)
      .send({ name: 'Someone Else', mobile })
      .expect(409);
    expect(dup.body.error.code).toBe('duplicate_mobile');
  });

  it('assigns, conflicts, unassigns and reassigns trucks race-safely', async () => {
    const server = app.getHttpServer();
    const driver1 = await seedDriver(db, { fleetId: fleetA, name: 'Driver One' });
    const driver2 = await seedDriver(db, { fleetId: fleetA, name: 'Driver Two' });
    const truckId = await seedTruck(db, fleetA, { plate: 'KA-AS-SIGN-01' });

    const assigned = await request(server)
      .post(`/v1/fleet/drivers/${driver1}/assign-truck`)
      .set('Authorization', authA)
      .send({ truckId })
      .expect(200);
    expect(assigned.body.assignedTruckPlate).toBe('KA-AS-SIGN-01');

    // One driver per truck: the partial unique index arbitrates.
    const conflict = await request(server)
      .post(`/v1/fleet/drivers/${driver2}/assign-truck`)
      .set('Authorization', authA)
      .send({ truckId })
      .expect(409);
    expect(conflict.body.error.code).toBe('truck_already_assigned');

    // Unassign frees it for the second driver.
    const unassigned = await request(server)
      .post(`/v1/fleet/drivers/${driver1}/assign-truck`)
      .set('Authorization', authA)
      .send({ truckId: null })
      .expect(200);
    expect(unassigned.body.assignedTruckPlate).toBeNull();

    await request(server)
      .post(`/v1/fleet/drivers/${driver2}/assign-truck`)
      .set('Authorization', authA)
      .send({ truckId })
      .expect(200);
  });

  it('treats cross-tenant drivers and trucks as not found', async () => {
    const driverA = await seedDriver(db, { fleetId: fleetA });
    const truckB = await seedTruck(db, fleetB);

    // Fleet A driver + fleet B truck: the truck reads as absent.
    const res = await request(app.getHttpServer())
      .post(`/v1/fleet/drivers/${driverA}/assign-truck`)
      .set('Authorization', authA)
      .send({ truckId: truckB })
      .expect(404);
    expect(res.body.error.code).toBe('not_found');

    // Fleet B token on a fleet A driver: the driver reads as absent.
    await request(app.getHttpServer())
      .post(`/v1/fleet/drivers/${driverA}/assign-truck`)
      .set('Authorization', authB)
      .send({ truckId: null })
      .expect(404);

    const listB = await request(app.getHttpServer())
      .get('/v1/fleet/drivers')
      .set('Authorization', authB)
      .expect(200);
    expect(listB.body.total).toBe(0);
  });

  it('busts the dashboard cache when a truck is assigned', async () => {
    // Regression for a pre-existing bug: `utilizationPct` counts DISTINCT
    // drivers.assigned_truck_id on active bookings, but assignTruck never
    // invalidated `dash:{fleetId}` — so the KPI stayed wrong for up to the 15s
    // TTL. Fails before the FleetEventsService change, passes after.
    const driverId = await seedDriver(db, { fleetId: fleetA });
    const truckId = await seedTruck(db, fleetA);
    await seedBooking(db, { userId: ownerA, fleetId: fleetA, driverId, status: 'en_route' });

    // Warm the cache with utilization computed BEFORE the assignment.
    const before = await request(app.getHttpServer())
      .get('/v1/fleet/dashboard')
      .set('Authorization', authA)
      .expect(200);
    expect(before.body.kpis.utilizationPct).toBe(0);

    await request(app.getHttpServer())
      .post(`/v1/fleet/drivers/${driverId}/assign-truck`)
      .set('Authorization', authA)
      .send({ truckId })
      .expect(200);

    // Well inside the 15s TTL: only an invalidation can make this change.
    const after = await request(app.getHttpServer())
      .get('/v1/fleet/dashboard')
      .set('Authorization', authA)
      .expect(200);
    expect(after.body.kpis.utilizationPct).toBe(100);
  });

  describe('GET /v1/fleet/drivers/:id/performance (ADM-23)', () => {
    it("reports trips, rates and this fleet's earnings from the driver's jobs", async () => {
      const driverId = await seedDriver(db, { fleetId: fleetA, name: 'Arjun' });
      await db.execute(sql`
        update drivers set rating = 4.6, acceptance_rate = 82.50, completion_rate = 97.00
         where id = ${driverId}::uuid
      `);
      const customerId = await seedCustomer(db);
      const paid = await seedBooking(db, {
        userId: customerId, fleetId: fleetA, driverId, status: 'paid', total: '1000.00',
      });
      await seedBooking(db, {
        userId: customerId, fleetId: fleetA, driverId, status: 'cancelled',
      });
      await seedWalletWithLedger(db, { ownerType: 'fleet', ownerId: fleetA }, [
        { type: 'fleet_share_credit', amount: '270.00', refId: paid },
      ]);
      await seedWalletWithLedger(db, { ownerType: 'driver', ownerId: driverId }, [
        { type: 'driver_share_credit', amount: '630.00', refId: paid },
        // A later refund took some back; the panel shows the net.
        { type: 'refund_debit', amount: '-126.00', refId: paid },
      ]);

      const res = await request(app.getHttpServer())
        .get(`/v1/fleet/drivers/${driverId}/performance`)
        .set('Authorization', authA)
        .expect(200);

      const panel = expectMatchesContract(fleetDriverPerformanceSchema, res.body);
      expect(panel.trips).toEqual({ completed: 1, cancelled: 1, unable: 0 });
      expect(panel.rating).toBe(4.6);
      expect(panel.acceptanceRatePct).toBe(82.5);
      expect(panel.earnings).toEqual({ fleetSharePaise: 27_000, driverSharePaise: 50_400 });
      expect(panel.recentJobs).toHaveLength(2);
    });

    it("404s another fleet's driver", async () => {
      const theirs = await seedDriver(db, { fleetId: fleetB });
      await request(app.getHttpServer())
        .get(`/v1/fleet/drivers/${theirs}/performance`)
        .set('Authorization', authA)
        .expect(404);
    });
  });
});
