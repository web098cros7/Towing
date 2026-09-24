import type { INestApplication } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { complianceDocuments, fleetTrucks } from '../../db/schema';
import { authHeaderFor, createTestApp } from '../../test/app';
import { seedFleet, setupTestDatabase, truncateAll, type TestDatabase } from '../../test/db';
import { seedTruck } from '../../test/fixtures';

describe('trucks e2e (/v1/fleet/trucks)', () => {
  let app: INestApplication;
  let db: TestDatabase;
  let authA: string;
  let authB: string;
  let fleetA: string;
  let fleetB: string;

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
    authA = await authHeaderFor(app, { userId: a.ownerId, fleetId: a.fleetId });
    authB = await authHeaderFor(app, { userId: b.ownerId, fleetId: b.fleetId });
  });

  it('lists trucks with mapped statuses and synthesized missing docs', async () => {
    const truckId = await seedTruck(db, fleetA, { plate: 'KA-01-TEST-1' });
    await db.insert(complianceDocuments).values({
      truckId,
      docType: 'insurance',
      expiresAt: new Date(Date.now() + 10 * 86_400_000),
      status: 'expiring_soon',
    });

    const res = await request(app.getHttpServer())
      .get('/v1/fleet/trucks')
      .set('Authorization', authA)
      .expect(200);

    expect(res.body.total).toBe(1);
    const truck = res.body.items[0];
    expect(truck.plate).toBe('KA-01-TEST-1');
    expect(truck.capacityTons).toBe(5);

    const byType = Object.fromEntries(
      truck.compliance.map((d: { docType: string; status: string }) => [d.docType, d.status]),
    );
    // DB `expiring_soon` → client `expiring`; absent rows synthesized as `missing`.
    expect(byType).toEqual({ insurance: 'expiring', rc: 'missing', puc: 'missing', permit: 'missing' });
  });

  it('creates a truck and rejects a duplicate plate within the fleet (409)', async () => {
    await request(app.getHttpServer())
      .post('/v1/fleet/trucks')
      .set('Authorization', authA)
      .send({ plate: 'ka-99-zz-1111', type: 'wheel_lift', capacityTons: 2.5 })
      .expect(201);

    const dup = await request(app.getHttpServer())
      .post('/v1/fleet/trucks')
      .set('Authorization', authA)
      .send({ plate: 'KA-99-ZZ-1111', type: 'flatbed', capacityTons: 5 })
      .expect(409);
    expect(dup.body.error.code).toBe('duplicate_plate');

    // Per-fleet uniqueness: fleet B may register the same plate.
    await request(app.getHttpServer())
      .post('/v1/fleet/trucks')
      .set('Authorization', authB)
      .send({ plate: 'KA-99-ZZ-1111', type: 'flatbed', capacityTons: 5 })
      .expect(201);
  });

  it('stores the make and model the customer card shows, and clears them with blanks', async () => {
    const created = await request(app.getHttpServer())
      .post('/v1/fleet/trucks')
      .set('Authorization', authA)
      .send({ plate: 'KA-99-MM-4070', type: 'flatbed', capacityTons: 5, make: ' Tata ', model: '407' })
      .expect(201);
    expect(created.body).toMatchObject({ make: 'Tata', model: '407' });

    // Only the model changes; the make is left alone.
    const renamed = await request(app.getHttpServer())
      .put(`/v1/fleet/trucks/${created.body.id}`)
      .set('Authorization', authA)
      .send({ model: '407 Gold' })
      .expect(200);
    expect(renamed.body).toMatchObject({ make: 'Tata', model: '407 Gold', plate: 'KA-99-MM-4070' });

    await request(app.getHttpServer())
      .put(`/v1/fleet/trucks/${created.body.id}`)
      .set('Authorization', authA)
      .send({ make: '', model: null })
      .expect(200);
    const [row] = await db
      .select({ make: fleetTrucks.make, model: fleetTrucks.model })
      .from(fleetTrucks)
      .where(eq(fleetTrucks.id, created.body.id));
    expect(row).toEqual({ make: null, model: null });

    // A truck created without them has none.
    const bare = await request(app.getHttpServer())
      .post('/v1/fleet/trucks')
      .set('Authorization', authA)
      .send({ plate: 'KA-99-MM-0001', type: 'wheel_lift', capacityTons: 2 })
      .expect(201);
    expect(bare.body).toMatchObject({ make: null, model: null });
  });

  it('compliance upsert recomputes truck status — and manual inactive is sticky', async () => {
    const truckId = await seedTruck(db, fleetA);
    const server = app.getHttpServer();

    // Expired doc → non_compliant.
    await request(server)
      .post(`/v1/fleet/trucks/${truckId}/compliance`)
      .set('Authorization', authA)
      .field('docType', 'insurance')
      .field('expiresAt', new Date(Date.now() - 86_400_000).toISOString())
      .expect(201);
    let [row] = await db.select().from(fleetTrucks).where(eq(fleetTrucks.id, truckId));
    expect(row!.status).toBe('non_compliant');

    // Renewed doc → back to active.
    await request(server)
      .post(`/v1/fleet/trucks/${truckId}/compliance`)
      .set('Authorization', authA)
      .field('docType', 'insurance')
      .field('expiresAt', new Date(Date.now() + 200 * 86_400_000).toISOString())
      .expect(201);
    [row] = await db.select().from(fleetTrucks).where(eq(fleetTrucks.id, truckId));
    expect(row!.status).toBe('active');

    // Parked truck stays parked no matter what the docs say.
    await request(server)
      .put(`/v1/fleet/trucks/${truckId}`)
      .set('Authorization', authA)
      .send({ status: 'inactive' })
      .expect(200);
    await request(server)
      .post(`/v1/fleet/trucks/${truckId}/compliance`)
      .set('Authorization', authA)
      .field('docType', 'puc')
      .field('expiresAt', new Date(Date.now() - 86_400_000).toISOString())
      .expect(201);
    [row] = await db.select().from(fleetTrucks).where(eq(fleetTrucks.id, truckId));
    expect(row!.status).toBe('inactive');
  });

  it('stores an uploaded document file and keeps it on metadata-only renewals', async () => {
    const truckId = await seedTruck(db, fleetA);

    await request(app.getHttpServer())
      .post(`/v1/fleet/trucks/${truckId}/compliance`)
      .set('Authorization', authA)
      .field('docType', 'permit')
      .field('expiresAt', new Date(Date.now() + 90 * 86_400_000).toISOString())
      .attach('file', Buffer.from('%PDF-1.4 test'), {
        filename: 'permit.pdf',
        contentType: 'application/pdf',
      })
      .expect(201);

    const [doc] = await db
      .select()
      .from(complianceDocuments)
      .where(eq(complianceDocuments.truckId, truckId));
    expect(doc!.fileUrl).toMatch(/^local:\/\/compliance\//);

    // Metadata-only renewal must not erase the stored file.
    await request(app.getHttpServer())
      .post(`/v1/fleet/trucks/${truckId}/compliance`)
      .set('Authorization', authA)
      .field('docType', 'permit')
      .field('expiresAt', new Date(Date.now() + 400 * 86_400_000).toISOString())
      .expect(201);
    const [renewed] = await db
      .select()
      .from(complianceDocuments)
      .where(eq(complianceDocuments.truckId, truckId));
    expect(renewed!.fileUrl).toBe(doc!.fileUrl);
  });

  it('never leaks or mutates across tenants', async () => {
    const truckA = await seedTruck(db, fleetA, { plate: 'KA-TEN-A-0001' });

    const listB = await request(app.getHttpServer())
      .get('/v1/fleet/trucks')
      .set('Authorization', authB)
      .expect(200);
    expect(listB.body.total).toBe(0);

    await request(app.getHttpServer())
      .put(`/v1/fleet/trucks/${truckA}`)
      .set('Authorization', authB)
      .send({ status: 'inactive' })
      .expect(404);

    await request(app.getHttpServer())
      .post(`/v1/fleet/trucks/${truckA}/compliance`)
      .set('Authorization', authB)
      .field('docType', 'rc')
      .field('expiresAt', new Date().toISOString())
      .expect(404);
  });
});
