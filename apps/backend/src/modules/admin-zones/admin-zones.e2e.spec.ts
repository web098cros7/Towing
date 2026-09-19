import type { INestApplication } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { adminZoneSchema, adminZoneVersionSchema, adminZonesResponseSchema, type GeoJsonPolygon } from '@towing/api-contracts';
import { adminActions, drivers, serviceZones } from '../../db/schema';
import { adminAuthHeaderFor, createTestApp, customerAuthHeaderFor } from '../../test/app';
import { expectMatchesContract } from '../../test/contracts';
import {
  seedAdmin,
  seedCustomer,
  setupTestDatabase,
  testDb,
  truncateAll,
  type TestDatabase,
} from '../../test/db';
import { closeTestRedis, flushTestRedis } from '../../test/redis';
import { seedOnlineDriver, seedZone } from '../dispatch/dispatch-fixtures';
import { seedPricingFixtures } from '../pricing/pricing.e2e.spec';

/**
 * W13 — §9.4.8's service-zone editor.
 *
 * The four things that make this a feature rather than a form:
 *   • a shape the resolver USES the moment it is saved (no cache to wait for);
 *   • a shape the database refuses to store if it is invalid;
 *   • a deactivation that blocks go-online and empties the zone;
 *   • a reconcile pass that re-homes or evicts whoever was standing in it.
 */
describe('admin zones (W13)', () => {
  let app: INestApplication;
  let db: TestDatabase;
  let adminId: string;
  let auth: string;

  /** A box around Mumbai — outside every seeded zone, so a create is observable. */
  const MUMBAI_BOX = {
    type: 'Polygon' as const,
    coordinates: [
      [
        [72.75, 18.9],
        [72.99, 18.9],
        [72.99, 19.25],
        [72.75, 19.25],
        [72.75, 18.9],
      ],
    ],
  };
  const MUMBAI = { lat: 19.076, lng: 72.8777 };

  beforeAll(async () => {
    await setupTestDatabase();
    db = testDb();
    app = await createTestApp();
  });

  beforeEach(async () => {
    await truncateAll();
    await flushTestRedis();
    await seedPricingFixtures(db);
    const admin = await seedAdmin(db, { subRole: 'operations' });
    adminId = admin.id;
    auth = await adminAuthHeaderFor(app, { adminId, subRole: 'operations' });
  });

  afterAll(async () => {
    await app.close();
    await closeTestRedis();
  });

  const createZone = (body: Record<string, unknown>) =>
    request(app.getHttpServer())
      .post('/v1/admin/zones')
      .set('Authorization', auth)
      .send(body);

  it('lists zones with their code, GeoJSON and PostGIS area', async () => {
    await seedZone(db, { name: 'Bengaluru Metro' });

    const response = await request(app.getHttpServer())
      .get('/v1/admin/zones')
      .set('Authorization', auth)
      .expect(200);

    expectMatchesContract(adminZonesResponseSchema, response.body);
    const metro = response.body.items.find(
      (zone: { name: string }) => zone.name === 'Bengaluru Metro',
    );
    expect(metro.code).toMatch(/^zone-/);
    expect(metro.area.type).toBe('Polygon');
    // The seeded polygon is roughly 0.35° × 0.35°; PostGIS says ~1,500 km².
    expect(metro.areaKm2).toBeGreaterThan(100);
    expect(response.body.resolution).toHaveLength(3);
  });

  it('creates a zone the resolver uses on the very NEXT estimate', async () => {
    const customerAuth = await customerAuthHeaderFor(app, { userId: await seedCustomer(db) });
    const quote = () =>
      request(app.getHttpServer())
        .post('/v1/pricing/estimate')
        .set('Authorization', customerAuth)
        .send({ serviceSlug: 'car_tow', vehicleClass: 'wheel_lift', pickup: MUMBAI, drop: MUMBAI });

    // Nothing covers Mumbai yet — §9.1.5's out-of-area refusal.
    await quote().expect(422);

    const created = await createZone({
      code: 'mumbai-metro',
      name: 'Mumbai Metro',
      area: MUMBAI_BOX,
      surgeBand: 'high',
      isHighway: false,
      reason: 'New city launch',
    }).expect(200);

    expect(created.body.version).toBe(1);
    expect(created.body.code).toBe('mumbai-metro');
    expectMatchesContract(adminZoneSchema, created.body);

    // THE RESOLVER DOES NOT CACHE — a saved zone is live immediately.
    const after = await quote().expect(200);
    expect(after.body.zone.name).toBe('Mumbai Metro');
    expect(after.body.zone.surgeBand).toBe('high');

    const audits = await db.select().from(adminActions).where(eq(adminActions.action, 'zone.create'));
    expect(audits).toHaveLength(1);
    expect(audits[0]!.adminId).toBe(adminId);
  });

  it('refuses a SELF-INTERSECTING polygon with PostGIS’ own reason', async () => {
    // A bow-tie: the ring crosses itself between the second and fourth points.
    const bowtie = {
      type: 'Polygon' as const,
      coordinates: [
        [
          [72.8, 19.0],
          [72.9, 19.1],
          [72.8, 19.1],
          [72.9, 19.0],
          [72.8, 19.0],
        ],
      ],
    };

    const response = await createZone({ code: 'bad-shape', name: 'Bad Shape', area: bowtie }).expect(
      422,
    );
    expect(JSON.stringify(response.body)).toMatch(/crosses itself/i);
    expect(response.body.error.details.reason).toBeTruthy();

    // Nothing was written — not even an inactive row.
    const [bad] = await db.select().from(serviceZones).where(eq(serviceZones.code, 'bad-shape'));
    expect(bad).toBeUndefined();
  });

  it('refuses an OVERSIZE zone', async () => {
    // Half of India — far past the 5,000 km² cap.
    const huge: GeoJsonPolygon = {
      type: 'Polygon',
      coordinates: [
        [
          [70, 15],
          [85, 15],
          [85, 25],
          [70, 25],
          [70, 15],
        ],
      ],
    };

    const response = await createZone({ code: 'too-big', name: 'Too Big', area: huge }).expect(422);
    expect(JSON.stringify(response.body)).toMatch(/plausible range/i);
  });

  it('refuses a duplicate code with a 409 naming it', async () => {
    await createZone({ code: 'mumbai-metro', name: 'Mumbai Metro', area: MUMBAI_BOX }).expect(200);
    const response = await createZone({
      code: 'mumbai-metro',
      name: 'Mumbai Again',
      area: MUMBAI_BOX,
    }).expect(409);
    expect(JSON.stringify(response.body)).toMatch(/mumbai-metro/);
  });

  it('previews what a shape would affect, and REPORTS an overlap rather than refusing it', async () => {
    await seedZone(db, { name: 'Bengaluru Metro' });

    // The same box the seeded zone covers — an overlap on purpose.
    const response = await request(app.getHttpServer())
      .post('/v1/admin/zones/preview')
      .set('Authorization', auth)
      .send({
        area: {
          type: 'Polygon',
          coordinates: [
            [
              [77.5, 12.85],
              [77.75, 12.85],
              [77.75, 13.1],
              [77.5, 13.1],
              [77.5, 12.85],
            ],
          ],
        },
        isActive: true,
      })
      .expect(200);

    expect(response.body.overlaps.map((zone: { zoneName: string }) => zone.zoneName)).toContain(
      'Bengaluru Metro',
    );
    expect(response.body.areaKm2).toBeGreaterThan(0);
  });

  it('versions every edit, and a restore is a NEW version', async () => {
    const created = await createZone({
      code: 'mumbai-metro',
      name: 'Mumbai Metro',
      area: MUMBAI_BOX,
    }).expect(200);

    const second = await request(app.getHttpServer())
      .put(`/v1/admin/zones/${created.body.id}`)
      .set('Authorization', auth)
      .send({ name: 'Mumbai Metro (north)', reason: 'Naming after the split' })
      .expect(200);
    expect(second.body.version).toBe(2);

    const versions = await request(app.getHttpServer())
      .get(`/v1/admin/zones/${created.body.id}/versions`)
      .set('Authorization', auth)
      .expect(200);
    expect(versions.body).toHaveLength(2);
    expect(versions.body[0].version).toBe(2);
    expectMatchesContract(z.array(adminZoneVersionSchema), versions.body);

    // Restoring version 1 writes version 3 with version 1's name… well: with
    // version 1's SHAPE. The history is append-only.
    const restored = await request(app.getHttpServer())
      .post(`/v1/admin/zones/${created.body.id}/versions/${versions.body[1].id}/restore`)
      .set('Authorization', auth)
      .expect(200);
    expect(restored.body.version).toBe(3);

    const after = await request(app.getHttpServer())
      .get(`/v1/admin/zones/${created.body.id}/versions`)
      .set('Authorization', auth)
      .expect(200);
    expect(after.body).toHaveLength(3);
  });

  it('deactivating a zone with nothing else covering it EVICTS the driver', async () => {
    // Only this zone exists, so the deactivated driver has nowhere to be
    // re-homed TO — the stranded case the reconcile exists for.
    await db.delete(serviceZones);
    const zoneId = await seedZone(db, { name: 'Bengaluru Metro' });
    const driverId = await seedOnlineDriver(db, { zoneId, metersAway: 500 });

    const before = await db.select().from(drivers).where(eq(drivers.id, driverId));
    expect(before[0]!.isOnline).toBe(true);
    expect(before[0]!.currentZoneId).toBe(zoneId);

    await request(app.getHttpServer())
      .post(`/v1/admin/zones/${zoneId}/deactivate`)
      .set('Authorization', auth)
      .expect(200);

    // The driver was standing inside a zone that no longer exists — the
    // reconcile EVICTS rather than leaving them invisible to dispatch.
    const after = await db.select().from(drivers).where(eq(drivers.id, driverId));
    expect(after[0]!.isOnline).toBe(false);
    expect(after[0]!.currentZoneId).toBeNull();

    // And the resolver no longer sees the zone at all.
    const customerAuth = await customerAuthHeaderFor(app, { userId: await seedCustomer(db) });
    await request(app.getHttpServer())
      .post('/v1/pricing/estimate')
      .set('Authorization', customerAuth)
      .send({
        serviceSlug: 'car_tow',
        vehicleClass: 'wheel_lift',
        pickup: { lat: 12.9716, lng: 77.5946 },
        drop: { lat: 12.9569, lng: 77.7011 },
      })
      .expect(422);
  });

  it('deactivating one of two overlapping zones RE-HOMES the driver to the survivor', async () => {
    await db.delete(serviceZones);
    const outer = await seedZone(db, { name: 'Outer Bengaluru' });
    const inner = await seedZone(db, {
      name: 'Inner Bengaluru',
      dispatchConfig: null,
    });
    const driverId = await seedOnlineDriver(db, { zoneId: inner, metersAway: 100 });

    await request(app.getHttpServer())
      .post(`/v1/admin/zones/${inner}/deactivate`)
      .set('Authorization', auth)
      .expect(200);

    const after = await db.select().from(drivers).where(eq(drivers.id, driverId));
    expect(after[0]!.isOnline).toBe(true);
    expect(after[0]!.currentZoneId).toBe(outer);
  });
});

describe('migration 0028 zone editor', () => {
  const MIGRATION = resolve(__dirname, '../../../drizzle/0028_zone_editor.sql');

  it('adds the identity, authorship and version columns, backfilling the code from the id', () => {
    const sql = readFileSync(MIGRATION, 'utf8');
    expect(sql).toContain(`ADD COLUMN "code" text`);
    expect(sql).toContain(`SET "code" = 'zone-' || left(replace("id"::text, '-', ''), 8)`);
    expect(sql).toContain(`ADD CONSTRAINT "uq_service_zones_code" UNIQUE ("code")`);
    expect(sql).toContain(`ADD COLUMN "version" integer DEFAULT 1 NOT NULL`);
    expect(sql).toContain(`ADD COLUMN "updated_by" uuid REFERENCES "admin_users"("id")`);
  });

  it('rails the geometry with ST_IsValid — the editor’s backstop', () => {
    const sql = readFileSync(MIGRATION, 'utf8');
    expect(sql).toContain(
      `CHECK (ST_IsValid("area"::geometry))`,
    );
  });

  it('creates service_zone_versions as an append-only history and backfills the seed', () => {
    const sql = readFileSync(MIGRATION, 'utf8');
    expect(sql).toContain('CREATE TABLE "service_zone_versions"');
    expect(sql).toContain(`"area_geojson" jsonb NOT NULL`);
    expect(sql).toContain(`"uq_service_zone_versions_zone_version" UNIQUE ("zone_id", "version")`);
    // One version per existing zone, so "restore the previous shape" has
    // something to restore on the very first reshape.
    expect(sql).toContain('ST_AsGeoJSON("area"::geometry)::jsonb');
    expect(sql).toContain('FROM "service_zones"');
  });
});
