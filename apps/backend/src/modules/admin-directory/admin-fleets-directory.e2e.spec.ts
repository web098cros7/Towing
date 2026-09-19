import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  adminFleetDetailSchema,
  adminFleetsResponseSchema,
  driversListResponseSchema,
  earningsSummarySchema,
  trucksListResponseSchema,
  type AdminFleetItem,
} from '@towing/api-contracts';
import { desc, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppModule } from '../../app.module';
import { NotificationService } from '../../common/notifications/notification.service';
import { adminActions, drivers, fleets, suspensionRequests } from '../../db/schema';
import { AdminOpsBroadcasterService } from '../../realtime/admin-ops-broadcaster.service';
import { adminAuthHeaderFor, authHeaderFor } from '../../test/app';
import { expectMatchesContract } from '../../test/contracts';
import {
  seedAdmin,
  seedDriver,
  seedFleet,
  setupTestDatabase,
  truncateAll,
  type TestDatabase,
} from '../../test/db';
import { seedTruck } from '../../test/fixtures';
import { closeTestRedis, flushTestRedis } from '../../test/redis';
import { seedPricingFixtures } from '../pricing/pricing.e2e.spec';

/**
 * W6 — the fleets directory (§9.4.5): search/detail with the dry-run counts,
 * the fleet's trucks/drivers/earnings through the FLEET console's own
 * services, and A15's suspend routes.
 *
 * The acceptance here is the suspend: the trio lands, the audit names the
 * reason, the drivers are NOTIFIED (G6's carry-forward), and support's attempt
 * 403s while filing a request. Reactivation clears the trio so a reinstated
 * fleet does not read as suspended somewhere downstream.
 */
describe('admin directory fleets (W6)', () => {
  let app: INestApplication;
  let db: TestDatabase;
  let opsToken: string;
  let supportToken: string;
  let financeToken: string;

  beforeAll(async () => {
    db = await setupTestDatabase();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AdminOpsBroadcasterService)
      .useValue({ onModuleInit: () => undefined, onModuleDestroy: () => undefined })
      .compile();

    const instance = moduleRef.createNestApplication({ logger: false, rawBody: true });
    instance.setGlobalPrefix('v1');
    await instance.init();
    app = instance;
  });

  afterAll(async () => {
    await app.close();
    await closeTestRedis();
  });

  beforeEach(async () => {
    await truncateAll();
    await flushTestRedis();
    await seedPricingFixtures(db);
    const ops = await seedAdmin(db, { subRole: 'operations' });
    opsToken = await adminAuthHeaderFor(app, { adminId: ops.id, subRole: 'operations' });
    const support = await seedAdmin(db, { subRole: 'support' });
    supportToken = await adminAuthHeaderFor(app, { adminId: support.id, subRole: 'support' });
    const finance = await seedAdmin(db, { subRole: 'finance' });
    financeToken = await adminAuthHeaderFor(app, { adminId: finance.id, subRole: 'finance' });
  });

  it('finds fleets by partial name, owner mobile and id prefix, and filters by status', async () => {
    const bengaluru = await seedFleet(db, 'Bengaluru Heavy Towing');
    await seedFleet(db, 'Mysuru Quick Tow');

    const byName = await request(app.getHttpServer())
      .get('/v1/admin/fleets?q=bengaluru')
      .set('Authorization', opsToken)
      .expect(200);
    expectMatchesContract(adminFleetsResponseSchema, byName.body);
    expect(byName.body.items.map((item: AdminFleetItem) => item.id)).toEqual([bengaluru.fleetId]);

    const byPrefix = await request(app.getHttpServer())
      .get(`/v1/admin/fleets?q=${bengaluru.fleetId.slice(0, 8)}`)
      .set('Authorization', opsToken)
      .expect(200);
    expect(byPrefix.body.items.map((item: AdminFleetItem) => item.id)).toEqual([
      bengaluru.fleetId,
    ]);

    const suspended = await request(app.getHttpServer())
      .get('/v1/admin/fleets?status=suspended')
      .set('Authorization', opsToken)
      .expect(200);
    expect(suspended.body.items).toEqual([]);
  });

  it('serves detail with the dry-run counts, and 404s an unknown fleet', async () => {
    const fleet = await seedFleet(db, 'Counted Fleet');
    const onlineDriver = await seedDriver(db, { fleetId: fleet.fleetId, name: 'Online One' });
    await db.update(drivers).set({ isOnline: true }).where(eq(drivers.id, onlineDriver));
    await seedDriver(db, { fleetId: fleet.fleetId, name: 'Idle Two' });
    await seedTruck(db, fleet.fleetId);

    const detail = await request(app.getHttpServer())
      .get(`/v1/admin/fleets/${fleet.fleetId}`)
      .set('Authorization', opsToken)
      .expect(200);
    expectMatchesContract(adminFleetDetailSchema, detail.body);
    expect(detail.body).toMatchObject({
      businessName: 'Counted Fleet',
      driversCount: 2,
      onlineDriversCount: 1,
      trucksCount: 1,
      suspendedAt: null,
      suspensionReason: null,
    });

    await request(app.getHttpServer())
      .get(`/v1/admin/fleets/${randomUUID()}`)
      .set('Authorization', opsToken)
      .expect(404);
  });

  it("serves the fleet's trucks, drivers and earnings through the fleet services", async () => {
    const fleet = await seedFleet(db, 'Fleet Console Fleet');
    await seedDriver(db, { fleetId: fleet.fleetId });
    await seedTruck(db, fleet.fleetId);

    const trucks = await request(app.getHttpServer())
      .get(`/v1/admin/fleets/${fleet.fleetId}/trucks`)
      .set('Authorization', opsToken)
      .expect(200);
    expectMatchesContract(trucksListResponseSchema, trucks.body);
    expect(trucks.body.items).toHaveLength(1);

    const driverList = await request(app.getHttpServer())
      .get(`/v1/admin/fleets/${fleet.fleetId}/drivers`)
      .set('Authorization', opsToken)
      .expect(200);
    expectMatchesContract(driversListResponseSchema, driverList.body);
    expect(driverList.body.items).toHaveLength(1);

    const earnings = await request(app.getHttpServer())
      .get(`/v1/admin/fleets/${fleet.fleetId}/earnings`)
      .set('Authorization', opsToken)
      .expect(200);
    expectMatchesContract(earningsSummarySchema, earnings.body);

    // Unknown fleets 404 on the sub-reads too — "empty" would read as "no trucks".
    await request(app.getHttpServer())
      .get(`/v1/admin/fleets/${randomUUID()}/trucks`)
      .set('Authorization', opsToken)
      .expect(404);
    await request(app.getHttpServer())
      .get(`/v1/admin/fleets/${randomUUID()}/earnings`)
      .set('Authorization', opsToken)
      .expect(404);
  });

  it('suspends with the trio, the audit reason, and a notification per driver', async () => {
    const fleet = await seedFleet(db, 'Suspend Me Towing');
    const first = await seedDriver(db, { fleetId: fleet.fleetId, name: 'Driver One' });
    const second = await seedDriver(db, { fleetId: fleet.fleetId, name: 'Driver Two' });
    const notify = vi.spyOn(app.get(NotificationService), 'emit');

    const res = await request(app.getHttpServer())
      .post(`/v1/admin/fleets/${fleet.fleetId}/suspend`)
      .set('Authorization', opsToken)
      .send({ reason: 'Operating without valid insurance' })
      .expect(200);
    expect(res.body).toMatchObject({
      fleetId: fleet.fleetId,
      status: 'suspended',
      driverCount: 2,
    });

    const [row] = await db.select().from(fleets).where(eq(fleets.id, fleet.fleetId));
    expect(row!.status).toBe('suspended');
    expect(row!.suspensionReason).toBe('Operating without valid insurance');
    expect(row!.suspendedAt).not.toBeNull();

    const [audit] = await db
      .select()
      .from(adminActions)
      .where(eq(adminActions.action, 'fleet.suspend'))
      .orderBy(desc(adminActions.createdAt))
      .limit(1);
    expect(audit!.reason).toBe('Operating without valid insurance');

    // G6 carry-forward: one `fleet.suspended` per driver, naming the fleet.
    const fleetEvents = notify.mock.calls.filter(([event]) => event === 'fleet.suspended');
    expect(fleetEvents).toHaveLength(2);
    expect(fleetEvents.map(([, payload]) => (payload as { driverId: string }).driverId).sort()).toEqual(
      [first, second].sort(),
    );
    notify.mockRestore();

    // Reactivation clears the trio.
    const reactivated = await request(app.getHttpServer())
      .post(`/v1/admin/fleets/${fleet.fleetId}/reactivate`)
      .set('Authorization', opsToken)
      .expect(200);
    expect(reactivated.body).toMatchObject({ fleetId: fleet.fleetId, status: 'active' });
    const [after] = await db.select().from(fleets).where(eq(fleets.id, fleet.fleetId));
    expect(after!.suspendedAt).toBeNull();
    expect(after!.suspensionReason).toBeNull();
  });

  it("support's suspend files a fleet request; finance gets a plain 403", async () => {
    const fleet = await seedFleet(db, 'Requested Fleet');

    const refused = await request(app.getHttpServer())
      .post(`/v1/admin/fleets/${fleet.fleetId}/suspend`)
      .set('Authorization', supportToken)
      .send({ reason: 'Several unpaid fines on the account' })
      .expect(403);
    expect(refused.body.error.details.requestId).toBeTruthy();

    const [requestRow] = await db
      .select()
      .from(suspensionRequests)
      .where(eq(suspensionRequests.subjectId, fleet.fleetId));
    expect(requestRow).toBeDefined();
    expect(requestRow!.subjectType).toBe('fleet');

    // Finance holds neither permission: the guard refuses before any handler
    // code, so no request row is filed.
    await request(app.getHttpServer())
      .post(`/v1/admin/fleets/${fleet.fleetId}/suspend`)
      .set('Authorization', financeToken)
      .send({ reason: 'Finance should not reach here' })
      .expect(403);
    const rows = await db
      .select()
      .from(suspensionRequests)
      .where(eq(suspensionRequests.subjectId, fleet.fleetId));
    expect(rows).toHaveLength(1);
  });

  it('enforces the role matrix on reads and earnings', async () => {
    const fleet = await seedFleet(db, 'Matrix Fleet');
    const fleetToken = await authHeaderFor(app, { userId: fleet.ownerId, fleetId: fleet.fleetId });

    for (const token of [supportToken, financeToken]) {
      await request(app.getHttpServer())
        .get('/v1/admin/fleets')
        .set('Authorization', token)
        .expect(200);
    }
    await request(app.getHttpServer())
      .get('/v1/admin/fleets')
      .set('Authorization', fleetToken)
      .expect(403);
    await request(app.getHttpServer()).get('/v1/admin/fleets').expect(401);

    // Earnings are finance.summary: ops and finance hold it, support does not.
    await request(app.getHttpServer())
      .get(`/v1/admin/fleets/${fleet.fleetId}/earnings`)
      .set('Authorization', financeToken)
      .expect(200);
    await request(app.getHttpServer())
      .get(`/v1/admin/fleets/${fleet.fleetId}/earnings`)
      .set('Authorization', supportToken)
      .expect(403);
  });
});
