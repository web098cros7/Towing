import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  adminDirectoryUserBookingsResponseSchema,
  adminDirectoryUserDetailSchema,
  adminDirectoryUsersResponseSchema,
} from '@towing/api-contracts';
import { randomUUID } from 'node:crypto';
import { desc, eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../../app.module';
import {
  adminActions,
  bookingStatusHistory,
  bookings,
  suspensionRequests,
  users,
} from '../../db/schema';
import { AdminOpsBroadcasterService } from '../../realtime/admin-ops-broadcaster.service';
import { adminAuthHeaderFor, authHeaderFor, customerAuthHeaderFor } from '../../test/app';
import { expectMatchesContract } from '../../test/contracts';
import {
  seedAdmin,
  seedCustomer,
  seedDriver,
  seedFleet,
  setupTestDatabase,
  truncateAll,
  type TestDatabase,
} from '../../test/db';
import { seedBooking } from '../../test/fixtures';
import { closeTestRedis, flushTestRedis } from '../../test/redis';
import { seedPricingFixtures } from '../pricing/pricing.e2e.spec';

/**
 * W6 — the users directory and suspension (§9.4.4), including the acceptance
 * the work order names: suspend then booking creation returns
 * `account_not_active`; support's attempt 403s but files a request; trigram
 * finds a partial name.
 *
 * The side-effect split is asserted precisely because it is easy to get wrong:
 * an active trip must SURVIVE a customer suspension (a driver is mid-job), and
 * only `searching` bookings are cancelled.
 */
describe('admin directory users (W6)', () => {
  let app: INestApplication;
  let db: TestDatabase;
  let opsToken: string;
  let opsId: string;

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
    opsId = ops.id;
    opsToken = await adminAuthHeaderFor(app, { adminId: ops.id, subRole: 'operations' });
  });

  async function namedCustomer(name: string): Promise<string> {
    const userId = await seedCustomer(db);
    await db.update(users).set({ name }).where(eq(users.id, userId));
    return userId;
  }

  it('finds users by partial name, exact mobile and id prefix', async () => {
    const meera = await namedCustomer('Meera Iyer');
    await namedCustomer('Ravi Kumar');
    const [row] = await db.select({ mobile: users.mobile }).from(users).where(eq(users.id, meera));

    const byName = await request(app.getHttpServer())
      .get('/v1/admin/users?q=meer')
      .set('Authorization', opsToken)
      .expect(200);
    expectMatchesContract(adminDirectoryUsersResponseSchema, byName.body);
    expect(byName.body.items.map((item: { id: string }) => item.id)).toEqual([meera]);

    const byMobile = await request(app.getHttpServer())
      .get(`/v1/admin/users?q=${encodeURIComponent(row!.mobile)}`)
      .set('Authorization', opsToken)
      .expect(200);
    expect(byMobile.body.items.map((item: { id: string }) => item.id)).toEqual([meera]);

    const byPrefix = await request(app.getHttpServer())
      .get(`/v1/admin/users?q=${meera.slice(0, 8)}`)
      .set('Authorization', opsToken)
      .expect(200);
    expect(byPrefix.body.items.map((item: { id: string }) => item.id)).toEqual([meera]);

    // The parameterised routes the contracts guard excludes: asserted here
    // against their published schemas, which is the exclusion's condition.
    const detail = await request(app.getHttpServer())
      .get(`/v1/admin/users/${meera}`)
      .set('Authorization', opsToken)
      .expect(200);
    expectMatchesContract(adminDirectoryUserDetailSchema, detail.body);
    expect(detail.body.bookingsCount).toBe(0);

    const trips = await request(app.getHttpServer())
      .get(`/v1/admin/users/${meera}/bookings`)
      .set('Authorization', opsToken)
      .expect(200);
    expectMatchesContract(adminDirectoryUserBookingsResponseSchema, trips.body);
  });

  it('suspends: status + audit, searching bookings cancelled, an active trip kept, bookings refused', async () => {
    const userId = await namedCustomer('Asha Rao');
    const searchingId = await seedBooking(db, { userId, status: 'searching' });
    const customerAuth = await customerAuthHeaderFor(app, { userId });

    // §3.8 allows one active booking per customer, so the "kept trip" case is
    // a SECOND customer — suspended while mid-ride; the trip must survive.
    const riderId = await namedCustomer('Live Rider');
    const driverId = await seedDriver(db);
    const activeId = await seedBooking(db, { userId: riderId, driverId, status: 'en_route' });

    const res = await request(app.getHttpServer())
      .post(`/v1/admin/users/${userId}/suspend`)
      .set('Authorization', opsToken)
      .send({ reason: 'Fraud investigation' })
      .expect(200);

    expect(res.body).toMatchObject({
      subjectId: userId,
      subjectType: 'user',
      status: 'suspended',
      cancelledSearchingBookings: 1,
    });

    const [user] = await db.select().from(users).where(eq(users.id, userId));
    expect(user!.status).toBe('suspended');
    expect(user!.suspendedAt).not.toBeNull();
    expect(user!.suspensionReason).toBe('Fraud investigation');

    const auditRows = await db
      .select()
      .from(adminActions)
      .where(eq(adminActions.action, 'user.suspend'));
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]!.adminId).toBe(opsId);

    // Only the SEARCHING booking died, with an admin-attributed history row.
    const [searching] = await db.select().from(bookings).where(eq(bookings.id, searchingId));
    expect(searching!.status).toBe('cancelled');
    const history = await db
      .select()
      .from(bookingStatusHistory)
      .where(eq(bookingStatusHistory.bookingId, searchingId))
      .orderBy(desc(bookingStatusHistory.createdAt));
    expect(history[0]!.status).toBe('cancelled');
    expect(history[0]!.actor).toBe('admin');

    // A live trip survives its customer's suspension — a driver is mid-job.
    const riderSuspension = await request(app.getHttpServer())
      .post(`/v1/admin/users/${riderId}/suspend`)
      .set('Authorization', opsToken)
      .send({ reason: 'Chargeback review' })
      .expect(200);
    expect(riderSuspension.body.cancelledSearchingBookings).toBe(0);
    const [active] = await db.select().from(bookings).where(eq(bookings.id, activeId));
    expect(active!.status).toBe('en_route');

    // THE acceptance: the suspended account cannot create a booking.
    const refused = await request(app.getHttpServer())
      .post('/v1/bookings')
      .set('Authorization', customerAuth)
      .set('Idempotency-Key', randomUUID())
      .send({
        serviceSlug: 'car_tow',
        vehicleClass: 'wheel_lift',
        pickup: { lat: 12.9716, lng: 77.5946 },
        pickupAddress: 'MG Road, Bengaluru',
        drop: { lat: 12.9569, lng: 77.7011 },
        dropAddress: 'Marathahalli, Bengaluru',
      })
      .expect(403);
    expect(refused.body.error.code).toBe('account_not_active');
  });

  it("support's attempt 403s but files a request; ops approves it and the suspension executes", async () => {
    const userId = await namedCustomer('Vikram Shah');
    const support = await seedAdmin(db, { subRole: 'support' });
    const supportToken = await adminAuthHeaderFor(app, {
      adminId: support.id,
      subRole: 'support',
    });

    const refused = await request(app.getHttpServer())
      .post(`/v1/admin/users/${userId}/suspend`)
      .set('Authorization', supportToken)
      .send({ reason: 'Repeated COD failures' })
      .expect(403);
    expect(refused.body.error.details.requestId).toBeTruthy();

    // Not suspended — the request only queued the decision.
    const [before] = await db.select().from(users).where(eq(users.id, userId));
    expect(before!.status).toBe('active');

    const rows = await db
      .select()
      .from(suspensionRequests)
      .where(eq(suspensionRequests.subjectId, userId));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe('open');
    expect(rows[0]!.requestedBy).toBe(support.id);

    // While one request is OPEN, a second for the same subject is a conflict —
    // the partial unique index is what the inbox's sanity rests on.
    const duplicate = await request(app.getHttpServer())
      .post('/v1/admin/suspension-requests')
      .set('Authorization', supportToken)
      .send({ subjectType: 'user', subjectId: userId, reason: 'One request too many' })
      .expect(409);
    expect(duplicate.body.error.code).toBe('conflict');

    // Support can read the inbox; ops approves, executing through the one service.
    const inbox = await request(app.getHttpServer())
      .get('/v1/admin/suspension-requests')
      .set('Authorization', supportToken)
      .expect(200);
    expect(inbox.body.items).toHaveLength(1);

    await request(app.getHttpServer())
      .post(`/v1/admin/suspension-requests/${rows[0]!.id}/approve`)
      .set('Authorization', opsToken)
      .send({ note: 'Confirmed with support' })
      .expect(200);

    const [after] = await db.select().from(users).where(eq(users.id, userId));
    expect(after!.status).toBe('suspended');
    const [decided] = await db
      .select()
      .from(suspensionRequests)
      .where(eq(suspensionRequests.id, rows[0]!.id));
    expect(decided!.status).toBe('approved');
    expect(decided!.decidedBy).toBe(opsId);

    // Enqueue a fresh one for a different action check: reject path.
    const another = await namedCustomer('Pending Reject');
    const filed = await request(app.getHttpServer())
      .post('/v1/admin/suspension-requests')
      .set('Authorization', supportToken)
      .send({ subjectType: 'user', subjectId: another, reason: 'Looked suspicious' })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/v1/admin/suspension-requests/${filed.body.id}/reject`)
      .set('Authorization', opsToken)
      .send({ note: 'Evidence insufficient' })
      .expect(200);
    const [rejected] = await db
      .select()
      .from(suspensionRequests)
      .where(eq(suspensionRequests.id, filed.body.id));
    expect(rejected!.status).toBe('rejected');
    const [untouched] = await db.select().from(users).where(eq(users.id, another));
    expect(untouched!.status).toBe('active');
  });

  it('reactivates and audits the reversal', async () => {
    const userId = await namedCustomer('Back To Life');
    await request(app.getHttpServer())
      .post(`/v1/admin/users/${userId}/suspend`)
      .set('Authorization', opsToken)
      .send({ reason: 'Temporary block' })
      .expect(200);

    const res = await request(app.getHttpServer())
      .post(`/v1/admin/users/${userId}/reactivate`)
      .set('Authorization', opsToken)
      .expect(200);
    expect(res.body.status).toBe('active');

    const [user] = await db.select().from(users).where(eq(users.id, userId));
    expect(user!.status).toBe('active');
    expect(user!.suspensionReason).toBeNull();
    const auditRows = await db
      .select()
      .from(adminActions)
      .where(eq(adminActions.action, 'user.reactivate'));
    expect(auditRows).toHaveLength(1);
  });

  it('applies the role matrix: reads for every user.read holder, writes for ops only', async () => {
    const target = await namedCustomer('Matrix Target');
    const fleet = await seedFleet(db, 'Directory Fleet');
    const fleetToken = await authHeaderFor(app, { userId: fleet.ownerId, fleetId: fleet.fleetId });

    // Reads: ops, support and finance all hold `user.read` (Part 6).
    for (const subRole of ['support', 'finance'] as const) {
      const admin = await seedAdmin(db, { subRole });
      const token = await adminAuthHeaderFor(app, { adminId: admin.id, subRole });
      await request(app.getHttpServer())
        .get('/v1/admin/users')
        .set('Authorization', token)
        .expect(200);
    }
    await request(app.getHttpServer()).get('/v1/admin/users').expect(401);
    await request(app.getHttpServer())
      .get('/v1/admin/users')
      .set('Authorization', fleetToken)
      .expect(403);

    // Writes: finance lacks even the request permission.
    const finance = await seedAdmin(db, { subRole: 'finance' });
    const financeToken = await adminAuthHeaderFor(app, {
      adminId: finance.id,
      subRole: 'finance',
    });
    await request(app.getHttpServer())
      .post(`/v1/admin/users/${target}/suspend`)
      .set('Authorization', financeToken)
      .send({ reason: 'Not allowed' })
      .expect(403);
    await request(app.getHttpServer())
      .post(`/v1/admin/users/${target}/suspend`)
      .set('Authorization', fleetToken)
      .send({ reason: 'Not allowed' })
      .expect(403);
    await request(app.getHttpServer())
      .post(`/v1/admin/users/${target}/suspend`)
      .send({ reason: 'Not allowed' })
      .expect(401);
  });
});
