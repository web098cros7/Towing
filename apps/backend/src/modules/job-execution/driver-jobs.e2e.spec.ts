import type { INestApplication } from '@nestjs/common';
import {
  driverJobHistoryResponseSchema,
  driverProfileSchema,
  driverTruckSchema,
} from '@towing/api-contracts';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createTestApp,
  customerAuthHeaderFor,
  driverAuthHeaderFor,
} from '../../test/app';
import { expectMatchesContract } from '../../test/contracts';
import { complianceDocuments } from '../../db/schema/trucks';
import { drivers } from '../../db/schema/drivers';
import {
  seedCustomer,
  seedDriver,
  seedFleet,
  setupTestDatabase,
  truncateAll,
  type TestDatabase,
} from '../../test/db';
import { seedBooking, seedTruck } from '../../test/fixtures';
import { closeTestRedis, flushTestRedis } from '../../test/redis';

/**
 * The driver's own card and job history — the two reads the driver app's Home,
 * Jobs tab, Profile and Personal Information screens need.
 */
describe('driver jobs', () => {
  let app: INestApplication;
  let db: TestDatabase;
  let driverId: string;
  let driverAuth: string;
  let otherDriverId: string;

  beforeAll(async () => {
    db = await setupTestDatabase();
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
    await closeTestRedis();
  });

  beforeEach(async () => {
    await truncateAll();
    await flushTestRedis();
    driverId = await seedDriver(db);
    driverAuth = await driverAuthHeaderFor(app, { driverId });
    otherDriverId = await seedDriver(db);
  });

  it('returns the driver\'s own card', async () => {
    const response = await request(app.getHttpServer())
      .get('/v1/driver/me')
      .set('Authorization', driverAuth)
      .expect(200);

    expectMatchesContract(driverProfileSchema, response.body);
    expect(response.body.id).toBe(driverId);
    expect(typeof response.body.mobile).toBe('string');
    expect(typeof response.body.totalTrips).toBe('number');
    expect(response.body.truck === null || typeof response.body.truck === 'object').toBe(true);
  });

  it('lists only the driver\'s own bookings, newest first', async () => {
    const customerId = await seedCustomer(db);
    const older = await seedBooking(db, {
      userId: customerId,
      driverId,
      status: 'paid',
      total: '1000.00',
      commissionBand: 'B',
      commissionPct: '8.00',
      createdAt: new Date('2024-01-01T00:00:00Z'),
    });
    const newer = await seedBooking(db, {
      userId: customerId,
      driverId,
      status: 'cancelled',
      total: '500.00',
      commissionBand: 'B',
      commissionPct: '8.00',
      createdAt: new Date('2024-02-01T00:00:00Z'),
    });
    await seedBooking(db, {
      userId: customerId,
      driverId: otherDriverId,
      status: 'paid',
      total: '2000.00',
      createdAt: new Date('2024-03-01T00:00:00Z'),
    });

    const response = await request(app.getHttpServer())
      .get('/v1/driver/job-history')
      .set('Authorization', driverAuth)
      .expect(200);

    expectMatchesContract(driverJobHistoryResponseSchema, response.body);
    expect(response.body.items).toHaveLength(2);
    expect(response.body.items[0].bookingId).toBe(newer);
    expect(response.body.items[1].bookingId).toBe(older);
    for (const item of response.body.items) {
      expect(item.earnings.netPaise).toBeGreaterThan(0);
    }
  });

  it('filters by status and paginates with a cursor', async () => {
    const customerId = await seedCustomer(db);
    const paid = await seedBooking(db, {
      userId: customerId,
      driverId,
      status: 'paid',
      total: '1000.00',
      commissionBand: 'B',
      commissionPct: '8.00',
      createdAt: new Date('2024-01-01T00:00:00Z'),
    });
    const cancelled = await seedBooking(db, {
      userId: customerId,
      driverId,
      status: 'cancelled',
      total: '500.00',
      commissionBand: 'B',
      commissionPct: '8.00',
      createdAt: new Date('2024-02-01T00:00:00Z'),
    });

    const cancelledOnly = await request(app.getHttpServer())
      .get('/v1/driver/job-history?status=cancelled')
      .set('Authorization', driverAuth)
      .expect(200);

    expect(cancelledOnly.body.items).toHaveLength(1);
    expect(cancelledOnly.body.items[0].bookingId).toBe(cancelled);

    const firstPage = await request(app.getHttpServer())
      .get('/v1/driver/job-history?limit=1')
      .set('Authorization', driverAuth)
      .expect(200);

    expect(firstPage.body.items).toHaveLength(1);
    expect(firstPage.body.items[0].bookingId).toBe(cancelled);
    expect(firstPage.body.nextCursor).not.toBeNull();

    const secondPage = await request(app.getHttpServer())
      .get(`/v1/driver/job-history?limit=1&cursor=${firstPage.body.nextCursor}`)
      .set('Authorization', driverAuth)
      .expect(200);

    expect(secondPage.body.items).toHaveLength(1);
    expect(secondPage.body.items[0].bookingId).toBe(paid);
  });

  it('returns the detail of an own booking and 404s another driver\'s', async () => {
    const customerId = await seedCustomer(db);
    const own = await seedBooking(db, {
      userId: customerId,
      driverId,
      status: 'paid',
      total: '1000.00',
      commissionBand: 'B',
      commissionPct: '8.00',
    });
    const other = await seedBooking(db, {
      userId: customerId,
      driverId: otherDriverId,
      status: 'paid',
      total: '1000.00',
    });

    const response = await request(app.getHttpServer())
      .get(`/v1/driver/job-history/${own}`)
      .set('Authorization', driverAuth)
      .expect(200);

    expect(response.body.bookingId).toBe(own);
    expect(typeof response.body.payment).toBe('object');

    await request(app.getHttpServer())
      .get(`/v1/driver/job-history/${other}`)
      .set('Authorization', driverAuth)
      .expect(404);
  });

  it('lets a driver change their own email, and nothing else', async () => {
    const before = await request(app.getHttpServer())
      .get('/v1/driver/me')
      .set('Authorization', driverAuth)
      .expect(200);

    const response = await request(app.getHttpServer())
      .put('/v1/driver/me')
      .set('Authorization', driverAuth)
      .send({ email: 'ravi@example.com' })
      .expect(200);

    expectMatchesContract(driverProfileSchema, response.body);
    expect(response.body.email).toBe('ravi@example.com');

    // Fields outside the schema are stripped, not honoured — the same rule the
    // customer's `PUT /v1/me` follows. What matters is that they cannot land.
    //
    // The NAME is the one on the driver's licence: the identity the platform
    // verified and shows to a customer. A driver retyping it would be a driver
    // becoming somebody else, so it must not move through this route however
    // it is sent. The mobile is the login and must not move either.
    const ignored = await request(app.getHttpServer())
      .put('/v1/driver/me')
      .set('Authorization', driverAuth)
      .send({ name: 'Somebody Else', mobile: '+919999999999' })
      .expect(200);

    expect(ignored.body.name).toBe(before.body.name);
    expect(ignored.body.mobile).toBe(before.body.mobile);
  });

  it('refuses a photo key that was issued to another driver', async () => {
    const presign = await request(app.getHttpServer())
      .post('/v1/driver/photo/presign')
      .set('Authorization', driverAuth)
      .expect(200);

    expect(typeof presign.body.key).toBe('string');

    const otherAuth = await driverAuthHeaderFor(app, { driverId: otherDriverId });
    await request(app.getHttpServer())
      .post('/v1/driver/photo/confirm')
      .set('Authorization', otherAuth)
      .send({ key: presign.body.key })
      .expect(403);

    // The driver it was minted for can claim it, and reads back fetchable.
    const confirmed = await request(app.getHttpServer())
      .post('/v1/driver/photo/confirm')
      .set('Authorization', driverAuth)
      .send({ key: presign.body.key })
      .expect(200);

    expectMatchesContract(driverProfileSchema, confirmed.body);
    expect(confirmed.body.photoUrl).toBeTruthy();
    expect(confirmed.body.photoUrl.startsWith('local://')).toBe(false);
  });

  it('returns no truck and no documents for a driver with nothing assigned', async () => {
    const response = await request(app.getHttpServer())
      .get('/v1/driver/truck')
      .set('Authorization', driverAuth)
      .expect(200);

    expectMatchesContract(driverTruckSchema, response.body);
    expect(response.body.truck).toBeNull();
    expect(response.body.documents).toEqual([]);
  });

  it('returns the assigned truck with insurance first and missing papers filled in', async () => {
    const { fleetId } = await seedFleet(db, 'Compliance Fleet');
    const truckId = await seedTruck(db, fleetId, { plate: 'KA-01-AB-1234', make: 'Tata' });
    const expiresAt = new Date('2027-06-30T00:00:00Z');
    await db.insert(complianceDocuments).values({
      truckId,
      docType: 'rc',
      expiresAt,
      status: 'valid',
    });
    await db
      .update(drivers)
      .set({ fleetId, assignedTruckId: truckId })
      .where(eq(drivers.id, driverId));

    const response = await request(app.getHttpServer())
      .get('/v1/driver/truck')
      .set('Authorization', driverAuth)
      .expect(200);

    expectMatchesContract(driverTruckSchema, response.body);
    expect(response.body.truck.plate).toBe('KA-01-AB-1234');
    expect(response.body.fleetName).toBe('Compliance Fleet');

    // Always the full checklist, insurance leading — it is the one that makes
    // the truck `non_compliant` and stops offers reaching the driver.
    expect(response.body.documents.map((d: { docType: string }) => d.docType)).toEqual([
      'insurance',
      'rc',
      'puc',
      'permit',
    ]);
    const byType = Object.fromEntries(
      response.body.documents.map((d: { docType: string; status: string }) => [d.docType, d.status]),
    );
    expect(byType.rc).toBe('valid');
    expect(byType.insurance).toBe('missing');
  });

  it('refuses a customer token on the driver realm', async () => {
    const customerId = await seedCustomer(db);
    const customerAuth = await customerAuthHeaderFor(app, { userId: customerId });

    const response = await request(app.getHttpServer())
      .get('/v1/driver/me')
      .set('Authorization', customerAuth);

    expect([401, 403]).toContain(response.status);
  });
});
