import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { consentRecords, deletionRequests } from '../../db/schema';
import { createTestApp, customerAuthHeaderFor, driverAuthHeaderFor } from '../../test/app';
import { seedCustomer, seedDriver, setupTestDatabase, truncateAll, type TestDatabase } from '../../test/db';

describe('account privacy (/v1/me — DPDP §20.4, dual-realm)', () => {
  let app: INestApplication;
  let db: TestDatabase;

  beforeAll(async () => {
    db = await setupTestDatabase();
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  describe('DELETE /me', () => {
    it('files a deletion request for a customer', async () => {
      const userId = await seedCustomer(db);
      const auth = await customerAuthHeaderFor(app, { userId });

      const res = await request(app.getHttpServer())
        .delete('/v1/me')
        .set('Authorization', auth)
        .send({ reason: 'No longer needed' })
        .expect(200);
      expect(res.body.status).toBe('requested');

      const rows = await db.select().from(deletionRequests);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ subjectType: 'user', subjectId: userId, reason: 'No longer needed' });
    });

    it('files a deletion request for a driver — same route, both realms', async () => {
      const driverId = await seedDriver(db);
      const auth = await driverAuthHeaderFor(app, { driverId });

      await request(app.getHttpServer()).delete('/v1/me').set('Authorization', auth).expect(200);

      const rows = await db.select().from(deletionRequests);
      expect(rows).toMatchObject([{ subjectType: 'driver', subjectId: driverId }]);
    });

    it('409s a second request while one is already open (uq_deletion_requests_one_open_per_subject)', async () => {
      const userId = await seedCustomer(db);
      const auth = await customerAuthHeaderFor(app, { userId });

      await request(app.getHttpServer()).delete('/v1/me').set('Authorization', auth).expect(200);
      await request(app.getHttpServer()).delete('/v1/me').set('Authorization', auth).expect(409);

      const rows = await db.select().from(deletionRequests);
      expect(rows).toHaveLength(1);
    });
  });

  describe('GET /me/export', () => {
    it('returns the customer bundle: profile + sub-resources + consents', async () => {
      const userId = await seedCustomer(db, 'Priya Sharma');
      const auth = await customerAuthHeaderFor(app, { userId });

      await request(app.getHttpServer())
        .post('/v1/me/vehicles')
        .set('Authorization', auth)
        .send({ type: 'hatchback' })
        .expect(201);
      await request(app.getHttpServer())
        .post('/v1/me/consent')
        .set('Authorization', auth)
        .send({ policyType: 'privacy_policy', policyVersion: '2026-08-10' })
        .expect(204);

      const res = await request(app.getHttpServer())
        .get('/v1/me/export')
        .set('Authorization', auth)
        .expect(200);
      expect(res.body.profile).toMatchObject({ id: userId, name: 'Priya Sharma' });
      expect(res.body.vehicles).toHaveLength(1);
      expect(res.body.consents).toMatchObject([{ policyType: 'privacy_policy', policyVersion: '2026-08-10' }]);
    });

    it('returns a driver bundle with no vehicles/addresses/emergencyContacts sections (customer-only tables)', async () => {
      const driverId = await seedDriver(db);
      const auth = await driverAuthHeaderFor(app, { driverId });

      const res = await request(app.getHttpServer())
        .get('/v1/me/export')
        .set('Authorization', auth)
        .expect(200);
      expect(res.body.profile).toMatchObject({ id: driverId });
      expect(res.body.vehicles).toBeUndefined();
      expect(res.body.addresses).toBeUndefined();
      expect(res.body.emergencyContacts).toBeUndefined();
    });
  });

  describe('POST /me/consent', () => {
    it('writes a consent record carrying the given policy version, for both realms', async () => {
      const userId = await seedCustomer(db);
      const driverId = await seedDriver(db);
      const customerAuth = await customerAuthHeaderFor(app, { userId });
      const driverAuth = await driverAuthHeaderFor(app, { driverId });

      await request(app.getHttpServer())
        .post('/v1/me/consent')
        .set('Authorization', customerAuth)
        .send({ policyType: 'terms_of_service', policyVersion: '2026-08-10' })
        .expect(204);
      await request(app.getHttpServer())
        .post('/v1/me/consent')
        .set('Authorization', driverAuth)
        .send({ policyType: 'privacy_policy', policyVersion: '2026-08-10' })
        .expect(204);

      const rows = await db.select().from(consentRecords);
      expect(rows).toHaveLength(2);
      expect(rows.find((r) => r.subjectType === 'user')).toMatchObject({
        subjectId: userId,
        policyType: 'terms_of_service',
        policyVersion: '2026-08-10',
      });
      expect(rows.find((r) => r.subjectType === 'driver')).toMatchObject({
        subjectId: driverId,
        policyType: 'privacy_policy',
      });
      for (const row of rows) expect(row.action).toBe('granted');
    });
  });

  describe('POST /me/consent/withdraw', () => {
    it('stops marketing, leaves the account working, and logs the withdrawal', async () => {
      const userId = await seedCustomer(db);
      const customerAuth = await customerAuthHeaderFor(app, { userId });

      await request(app.getHttpServer())
        .post('/v1/me/consent')
        .set('Authorization', customerAuth)
        .send({ policyType: 'privacy_policy', policyVersion: '2026-09-01' })
        .expect(204);

      // Marketing on, so the withdrawal has something to switch off.
      await request(app.getHttpServer())
        .put('/v1/me/notification-prefs')
        .set('Authorization', customerAuth)
        .send({ promotions: true })
        .expect(200);

      await request(app.getHttpServer())
        .post('/v1/me/consent/withdraw')
        .set('Authorization', customerAuth)
        .send({ policyType: 'privacy_policy' })
        .expect(204);

      const prefs = await request(app.getHttpServer())
        .get('/v1/me/notification-prefs')
        .set('Authorization', customerAuth)
        .expect(200);
      expect(prefs.body.promotions).toBe(false);

      // The account still works — withdrawal is not deletion.
      await request(app.getHttpServer())
        .get('/v1/me')
        .set('Authorization', customerAuth)
        .expect(200);

      // Appended, not mutated: the original agreement is still on the record,
      // carrying the version that was withdrawn from.
      const rows = await db.select().from(consentRecords);
      expect(rows).toHaveLength(2);
      expect(rows.filter((r) => r.action === 'granted')).toHaveLength(1);
      const withdrawn = rows.find((r) => r.action === 'withdrawn');
      expect(withdrawn).toMatchObject({
        subjectId: userId,
        policyType: 'privacy_policy',
        policyVersion: '2026-09-01',
      });
    });
  });
});
