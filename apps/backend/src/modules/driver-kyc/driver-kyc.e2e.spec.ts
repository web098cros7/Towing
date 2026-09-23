import type { INestApplication } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { drivers } from '../../db/schema';
import { createTestApp, driverAuthHeaderFor } from '../../test/app';
import { seedDriver, setupTestDatabase, truncateAll, type TestDatabase } from '../../test/db';

const DOC_TYPES = ['license', 'rc', 'gov_id', 'inspection', 'selfie'] as const;

describe('driver KYC (/v1/driver/kyc, /v1/driver/capabilities)', () => {
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

  /** PUTs bytes to a presigned URL — strips the origin, supertest talks to the in-process server directly. */
  async function uploadTo(uploadUrl: string, body: Buffer) {
    const { pathname, search } = new URL(uploadUrl);
    return request(app.getHttpServer())
      .put(`${pathname}${search}`)
      .set('Content-Type', 'application/octet-stream')
      .send(body)
      .expect(204);
  }

  async function submitAllDocuments(driverId: string, auth: string) {
    for (const docType of DOC_TYPES) {
      const presign = await request(app.getHttpServer())
        .post('/v1/driver/kyc/documents/presign')
        .set('Authorization', auth)
        .send({ docType })
        .expect(201);

      await uploadTo(presign.body.uploadUrl, Buffer.from(`fixture-${docType}`));

      await request(app.getHttpServer())
        .post('/v1/driver/kyc/documents/confirm')
        .set('Authorization', auth)
        .send({ docType, key: presign.body.key })
        .expect(204);
    }
  }

  it('presign -> upload -> confirm -> submit flips incomplete to pending with all 5 documents', async () => {
    const driverId = await seedDriver(db, { kycStatus: 'incomplete', vehicleClass: null });
    const auth = await driverAuthHeaderFor(app, { driverId, kycStatus: 'incomplete' });

    await submitAllDocuments(driverId, auth);

    const submitted = await request(app.getHttpServer())
      .post('/v1/driver/kyc/submit')
      .set('Authorization', auth)
      .expect(200);
    expect(submitted.body.kycStatus).toBe('pending');
    expect(submitted.body.kycSubmittedAt).toBeTruthy();

    const status = await request(app.getHttpServer())
      .get('/v1/driver/kyc/status')
      .set('Authorization', auth)
      .expect(200);
    expect(status.body.kycStatus).toBe('pending');
    expect(status.body.documents).toHaveLength(5);
    expect(status.body.documents.every((d: { status: string }) => d.status === 'pending')).toBe(true);

    const [row] = await db.select().from(drivers).where(eq(drivers.id, driverId));
    expect(row!.kycStatus).toBe('pending');
    expect(row!.kycSubmittedAt).not.toBeNull();
  });

  it('refuses to submit with documents missing', async () => {
    const driverId = await seedDriver(db, { kycStatus: 'incomplete', vehicleClass: null });
    const auth = await driverAuthHeaderFor(app, { driverId, kycStatus: 'incomplete' });

    // Only 2 of 5.
    for (const docType of ['license', 'selfie'] as const) {
      const presign = await request(app.getHttpServer())
        .post('/v1/driver/kyc/documents/presign')
        .set('Authorization', auth)
        .send({ docType })
        .expect(201);
      await uploadTo(presign.body.uploadUrl, Buffer.from('x'));
      await request(app.getHttpServer())
        .post('/v1/driver/kyc/documents/confirm')
        .set('Authorization', auth)
        .send({ docType, key: presign.body.key })
        .expect(204);
    }

    const res = await request(app.getHttpServer())
      .post('/v1/driver/kyc/submit')
      .set('Authorization', auth)
      .expect(422);
    expect(res.body.error.details.missing.sort()).toEqual(['gov_id', 'inspection', 'rc']);
  });

  it('refuses to submit from a status other than incomplete', async () => {
    const driverId = await seedDriver(db, { kycStatus: 'pending' });
    const auth = await driverAuthHeaderFor(app, { driverId, kycStatus: 'pending' });

    await request(app.getHttpServer())
      .post('/v1/driver/kyc/submit')
      .set('Authorization', auth)
      .expect(409);
  });

  it('rejects a confirm whose key was not issued to this driver', async () => {
    const driverId = await seedDriver(db, { kycStatus: 'incomplete', vehicleClass: null });
    const auth = await driverAuthHeaderFor(app, { driverId, kycStatus: 'incomplete' });

    await request(app.getHttpServer())
      .post('/v1/driver/kyc/documents/confirm')
      .set('Authorization', auth)
      .send({ docType: 'license', key: 'driver-documents/someone-else/license-x.jpg' })
      .expect(403);
  });

  it('rejects a traversal key that STARTS WITH the caller\'s own prefix (security regression)', async () => {
    // A bare `key.startsWith('driver-documents/<me>/')` is bypassable: this
    // string also starts with that prefix, then walks out via `..` to land on
    // a DIFFERENT driver's real key. Confirming it would let this driver's
    // driver_documents row resolve to someone else's uploaded document.
    const driverId = await seedDriver(db, { kycStatus: 'incomplete', vehicleClass: null });
    const auth = await driverAuthHeaderFor(app, { driverId, kycStatus: 'incomplete' });
    const victimKey = `driver-documents/${driverId}/../other-driver/selfie-11111111-1111-4111-8111-111111111111.jpg`;

    await request(app.getHttpServer())
      .post('/v1/driver/kyc/documents/confirm')
      .set('Authorization', auth)
      .send({ docType: 'selfie', key: victimKey })
      .expect(403);
  });

  it('rejects confirming a presigned key under a doc type other than the one it was issued for', async () => {
    // Without tying docType into the ownership check, one uploaded file could
    // be confirmed 5 times under all 5 required doc types, satisfying submit()
    // without 5 real documents.
    const driverId = await seedDriver(db, { kycStatus: 'incomplete', vehicleClass: null });
    const auth = await driverAuthHeaderFor(app, { driverId, kycStatus: 'incomplete' });

    const presign = await request(app.getHttpServer())
      .post('/v1/driver/kyc/documents/presign')
      .set('Authorization', auth)
      .send({ docType: 'license' })
      .expect(201);
    await uploadTo(presign.body.uploadUrl, Buffer.from('one real upload'));

    await request(app.getHttpServer())
      .post('/v1/driver/kyc/documents/confirm')
      .set('Authorization', auth)
      .send({ docType: 'rc', key: presign.body.key })
      .expect(403);
  });

  it('resubmitting over a rejected document resets its review', async () => {
    const driverId = await seedDriver(db, { kycStatus: 'pending' });
    const auth = await driverAuthHeaderFor(app, { driverId, kycStatus: 'pending' });

    const presign1 = await request(app.getHttpServer())
      .post('/v1/driver/kyc/documents/presign')
      .set('Authorization', auth)
      .send({ docType: 'license' })
      .expect(201);
    await uploadTo(presign1.body.uploadUrl, Buffer.from('first'));
    await request(app.getHttpServer())
      .post('/v1/driver/kyc/documents/confirm')
      .set('Authorization', auth)
      .send({ docType: 'license', key: presign1.body.key })
      .expect(204);

    // Re-submit the same doc type — should upsert, not duplicate.
    const presign2 = await request(app.getHttpServer())
      .post('/v1/driver/kyc/documents/presign')
      .set('Authorization', auth)
      .send({ docType: 'license' })
      .expect(201);
    await uploadTo(presign2.body.uploadUrl, Buffer.from('second'));
    await request(app.getHttpServer())
      .post('/v1/driver/kyc/documents/confirm')
      .set('Authorization', auth)
      .send({ docType: 'license', key: presign2.body.key })
      .expect(204);

    const status = await request(app.getHttpServer())
      .get('/v1/driver/kyc/status')
      .set('Authorization', auth)
      .expect(200);
    const licenseDocs = status.body.documents.filter(
      (d: { docType: string }) => d.docType === 'license',
    );
    expect(licenseDocs).toHaveLength(1);
    expect(licenseDocs[0].status).toBe('pending');
  });

  describe('GET /v1/driver/capabilities', () => {
    it('returns the driver\'s current capabilities, matching a prior PUT', async () => {
      const driverId = await seedDriver(db, { kycStatus: 'approved', vehicleClass: 'wheel_lift' });
      const auth = await driverAuthHeaderFor(app, { driverId, kycStatus: 'approved' });

      await request(app.getHttpServer())
        .put('/v1/driver/capabilities')
        .set('Authorization', auth)
        .send({ vehicleClass: 'flatbed', longDistanceEnabled: true })
        .expect(200);

      const res = await request(app.getHttpServer())
        .get('/v1/driver/capabilities')
        .set('Authorization', auth)
        .expect(200);
      expect(res.body).toEqual({ vehicleClass: 'flatbed', longDistanceEnabled: true, services: [] });
    });

    it('200s for a driver whose kycStatus is NOT approved (guard asymmetry vs the PUT)', async () => {
      const driverId = await seedDriver(db, { kycStatus: 'suspended', vehicleClass: 'flatbed' });
      const auth = await driverAuthHeaderFor(app, { driverId, kycStatus: 'suspended' });

      // The PUT is refused…
      await request(app.getHttpServer())
        .put('/v1/driver/capabilities')
        .set('Authorization', auth)
        .send({ longDistanceEnabled: true })
        .expect(403);

      // …but the GET still shows what they are set to.
      const res = await request(app.getHttpServer())
        .get('/v1/driver/capabilities')
        .set('Authorization', auth)
        .expect(200);
      expect(res.body).toEqual({ vehicleClass: 'flatbed', longDistanceEnabled: false, services: [] });
    });
  });

  describe('PUT /v1/driver/capabilities (KycApprovedGuard)', () => {
    it('403s an incomplete driver with reason kyc_not_approved', async () => {
      const driverId = await seedDriver(db, { kycStatus: 'incomplete', vehicleClass: null });
      const auth = await driverAuthHeaderFor(app, { driverId, kycStatus: 'incomplete' });

      const res = await request(app.getHttpServer())
        .put('/v1/driver/capabilities')
        .set('Authorization', auth)
        .send({ longDistanceEnabled: true })
        .expect(403);
      expect(res.body.error.details.reason).toBe('kyc_not_approved');
    });

    it('403s a pending driver even though pending is "closer" than incomplete', async () => {
      const driverId = await seedDriver(db, { kycStatus: 'pending' });
      const auth = await driverAuthHeaderFor(app, { driverId, kycStatus: 'pending' });

      await request(app.getHttpServer())
        .put('/v1/driver/capabilities')
        .set('Authorization', auth)
        .send({ longDistanceEnabled: true })
        .expect(403);
    });

    it('allows an approved driver and persists the change', async () => {
      const driverId = await seedDriver(db, { kycStatus: 'approved', vehicleClass: 'wheel_lift' });
      const auth = await driverAuthHeaderFor(app, { driverId, kycStatus: 'approved' });

      const res = await request(app.getHttpServer())
        .put('/v1/driver/capabilities')
        .set('Authorization', auth)
        .send({ vehicleClass: 'flatbed', longDistanceEnabled: true })
        .expect(200);
      expect(res.body).toEqual({ vehicleClass: 'flatbed', longDistanceEnabled: true, services: [] });

      const [row] = await db.select().from(drivers).where(eq(drivers.id, driverId));
      expect(row!.vehicleClass).toBe('flatbed');
      expect(row!.longDistanceEnabled).toBe(true);
    });

    it('saves the roadside services the driver ticked at onboarding', async () => {
      const driverId = await seedDriver(db, { kycStatus: 'approved', vehicleClass: 'flatbed' });
      const auth = await driverAuthHeaderFor(app, { driverId, kycStatus: 'approved' });

      const res = await request(app.getHttpServer())
        .put('/v1/driver/capabilities')
        .set('Authorization', auth)
        .send({ services: ['battery', 'lockout'] })
        .expect(200);
      expect(res.body.services).toEqual(['battery', 'lockout']);

      const [row] = await db.select().from(drivers).where(eq(drivers.id, driverId));
      expect(row!.services).toEqual(['battery', 'lockout']);
    });

    it('treats the list as the whole set, so unticking the last one sticks', async () => {
      // The failure this guards: a PUT that MERGED would make the services
      // impossible to give up. A driver who sells their jump pack has to be
      // able to say so, and `[]` is how they say it.
      const driverId = await seedDriver(db, { kycStatus: 'approved', vehicleClass: 'flatbed' });
      const auth = await driverAuthHeaderFor(app, { driverId, kycStatus: 'approved' });

      await request(app.getHttpServer())
        .put('/v1/driver/capabilities')
        .set('Authorization', auth)
        .send({ services: ['battery', 'fuel'] })
        .expect(200);

      const res = await request(app.getHttpServer())
        .put('/v1/driver/capabilities')
        .set('Authorization', auth)
        .send({ services: [] })
        .expect(200);
      expect(res.body.services).toEqual([]);
    });

    it('leaves the services alone when the key is omitted', async () => {
      // An older build of the app sends only `vehicleClass`. It must not read
      // as "I offer nothing" and wipe a driver's opt-ins on their next save.
      const driverId = await seedDriver(db, { kycStatus: 'approved', vehicleClass: 'flatbed' });
      const auth = await driverAuthHeaderFor(app, { driverId, kycStatus: 'approved' });

      await request(app.getHttpServer())
        .put('/v1/driver/capabilities')
        .set('Authorization', auth)
        .send({ services: ['fuel'] })
        .expect(200);

      const res = await request(app.getHttpServer())
        .put('/v1/driver/capabilities')
        .set('Authorization', auth)
        .send({ vehicleClass: 'wheel_lift' })
        .expect(200);
      expect(res.body.services).toEqual(['fuel']);
    });

    it('422s a service that is not a driver-selectable roadside one', async () => {
      // `tow` is a real `serviceType` and NOT a real answer here — vehicle
      // class decides tows, and accepting it would give that fact a second,
      // conflicting home.
      const driverId = await seedDriver(db, { kycStatus: 'approved', vehicleClass: 'flatbed' });
      const auth = await driverAuthHeaderFor(app, { driverId, kycStatus: 'approved' });

      await request(app.getHttpServer())
        .put('/v1/driver/capabilities')
        .set('Authorization', auth)
        .send({ services: ['tow'] })
        .expect(422);
    });

    it('422s a body with none of the three fields', async () => {
      const driverId = await seedDriver(db, { kycStatus: 'approved', vehicleClass: 'flatbed' });
      const auth = await driverAuthHeaderFor(app, { driverId, kycStatus: 'approved' });

      await request(app.getHttpServer())
        .put('/v1/driver/capabilities')
        .set('Authorization', auth)
        .send({})
        .expect(422);
    });

    it('re-reads the DB and 403s when the token claims approved but the DB has since moved on', async () => {
      // The whole point of the two-layer guard: a claim minted before a
      // suspension must not out-live it for the rest of its TTL.
      const driverId = await seedDriver(db, { kycStatus: 'suspended' });
      const auth = await driverAuthHeaderFor(app, { driverId, kycStatus: 'approved' });

      const res = await request(app.getHttpServer())
        .put('/v1/driver/capabilities')
        .set('Authorization', auth)
        .send({ longDistanceEnabled: true })
        .expect(403);
      expect(res.body.error.details.reason).toBe('kyc_not_approved');
    });
  });
});
