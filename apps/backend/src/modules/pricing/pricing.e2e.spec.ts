import type { INestApplication } from '@nestjs/common';
import { pricingEstimateResponseSchema, serviceCatalogResponseSchema } from '@towing/api-contracts';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  appConfig,
  chargeConfig,
  commissionConfig,
  commissionGuardrail,
  dispatchConfig,
  pricingRules,
  serviceZones,
  services,
} from '../../db/schema';
import { SERVICE_CATALOG } from '../../db/seed/fixtures';
import { KillSwitchService } from '../../common/killswitch/killswitch.service';
import {
  adminAuthHeaderFor,
  createTestApp,
  customerAuthHeaderFor,
  driverAuthHeaderFor,
} from '../../test/app';
import { expectMatchesContract } from '../../test/contracts';
import {
  seedAdmin,
  seedCustomer,
  seedDriver,
  setupTestDatabase,
  truncateAll,
  type TestDatabase,
} from '../../test/db';
import { closeTestRedis, flushTestRedis } from '../../test/redis';
import { DEFAULT_PRICING_RULES, toRupees } from './pricing.math';

/**
 * `GET /v1/services` and `POST /v1/pricing/estimate` (§16.2, §7).
 *
 * Points used throughout — all inside the polygons seeded below:
 *   BENGALURU  city zone, standard surge
 *   HIGHWAY    the NH-44 corridor, `is_highway`
 *   CHENNAI    city zone, `high` surge
 *   MUMBAI     no zone at all
 */
const BENGALURU = { lat: 12.9716, lng: 77.5946 };
const BENGALURU_DROP = { lat: 12.9569, lng: 77.7011 };
const HIGHWAY = { lat: 12.75, lng: 77.66 };
const CHENNAI = { lat: 13.0418, lng: 80.2341 };
const MUMBAI = { lat: 19.076, lng: 72.8777 };

describe('pricing (/v1/services, /v1/pricing/estimate)', () => {
  let app: INestApplication;
  let db: TestDatabase;
  let customerAuth: string;

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
    // Redis holds the rate-card and catalogue caches. Without this flush a spec
    // that edits `pricing_rules` reads the previous spec's card and the
    // config-driven assertions pass for the wrong reason.
    await flushTestRedis();
    await seedPricingFixtures(db);
    customerAuth = await customerAuthHeaderFor(app, { userId: await seedCustomer(db) });
  });

  describe('GET /v1/services', () => {
    it('serves the Appendix B catalogue in display order', async () => {
      const response = await request(app.getHttpServer())
        .get('/v1/services')
        .set('Authorization', customerAuth)
        .expect(200);

      expectMatchesContract(serviceCatalogResponseSchema, response.body);
      expect(response.body).toHaveLength(10);
      expect(response.body.map((s: { slug: string }) => s.slug)).toEqual([
        'car_tow',
        'bike_tow',
        'flatbed_tow',
        'wheel_lift_tow',
        'battery',
        'flat_tyre',
        'lockout',
        'fuel',
        'breakdown',
        'accident_recovery',
      ]);
    });

    it('omits deactivated rows', async () => {
      await db.update(services).set({ isActive: false });
      await request(app.getHttpServer())
        .get('/v1/services')
        .set('Authorization', customerAuth)
        .expect(200)
        .expect(({ body }) => expect(body).toEqual([]));
    });
  });

  describe('POST /v1/pricing/estimate', () => {
    it('returns a §7 breakdown for a city tow', async () => {
      const response = await request(app.getHttpServer())
        .post('/v1/pricing/estimate')
        .set('Authorization', customerAuth)
        .send({
          serviceSlug: 'car_tow',
          vehicleClass: 'wheel_lift',
          pickup: BENGALURU,
          drop: BENGALURU_DROP,
          // Midday IST, so the §7.4 night window is definitively not in play.
          scheduledAt: '2026-08-16T06:30:00.000Z',
        })
        .expect(200);

      expectMatchesContract(pricingEstimateResponseSchema, response.body);
      expect(response.body.zone.name).toBe('Bengaluru Metro');
      expect(response.body.zone.isHighway).toBe(false);
      expect(response.body.breakdown.basePaise).toBeGreaterThan(0);
      expect(response.body.breakdown.nightPaise).toBe(0);
      expect(response.body.breakdown.highwayPaise).toBe(0);
      expect(response.body.breakdown.surgePaise).toBe(0);
      expect(response.body.surgeActive).toBe(false);
      expect(response.body.band).toBe('A');
      // No Maps key in CI, so the §19.2 fallback is the live path.
      expect(response.body.distanceSource).toBe('haversine');
    });

    it('NEVER exposes commission to the customer (§7.6)', async () => {
      const response = await request(app.getHttpServer())
        .post('/v1/pricing/estimate')
        .set('Authorization', customerAuth)
        .send({
          serviceSlug: 'car_tow',
          vehicleClass: 'flatbed',
          pickup: BENGALURU,
          drop: BENGALURU_DROP,
        })
        .expect(200);

      // `expectMatchesContract` toEquals, so an added field already fails — this
      // says out loud WHICH fields must never appear, because the engine
      // computes all of them and the mapping is one spread away from leaking.
      const serialised = JSON.stringify(response.body);
      for (const forbidden of ['commission', 'driverPayout', 'platformEarning', 'pool']) {
        expect(serialised.toLowerCase()).not.toContain(forbidden.toLowerCase());
      }
      expect(response.body.breakdown).not.toHaveProperty('commissionPaise');
    });

    it('adds the §7.4 highway surcharge for a pickup in a highway zone', async () => {
      const response = await request(app.getHttpServer())
        .post('/v1/pricing/estimate')
        .set('Authorization', customerAuth)
        .send({
          serviceSlug: 'car_tow',
          vehicleClass: 'wheel_lift',
          pickup: HIGHWAY,
          drop: BENGALURU_DROP,
        })
        .expect(200);

      expect(response.body.zone.isHighway).toBe(true);
      expect(response.body.breakdown.highwayPaise).toBe(50_000);
    });

    it('surges in a zone whose band is not standard, and flags it', async () => {
      const response = await request(app.getHttpServer())
        .post('/v1/pricing/estimate')
        .set('Authorization', customerAuth)
        .send({
          serviceSlug: 'car_tow',
          vehicleClass: 'wheel_lift',
          pickup: CHENNAI,
          drop: CHENNAI,
        })
        .expect(200);

      expect(response.body.zone.surgeBand).toBe('high');
      expect(response.body.breakdown.surgePaise).toBeGreaterThan(0);
      expect(response.body.surgeActive).toBe(true);
      // 10 % of the pre-surge subtotal.
      const b = response.body.breakdown;
      expect(b.surgePaise).toBe(
        Math.round((b.basePaise + b.nightPaise + b.highwayPaise + b.accidentPaise) * 0.1),
      );
    });

    it('applies the night charge on the SERVER clock, not the client (§7.4)', async () => {
      // 23:30 IST. A client cannot dodge this by lying about its own clock,
      // because the request carries an instant and never an hour.
      const response = await request(app.getHttpServer())
        .post('/v1/pricing/estimate')
        .set('Authorization', customerAuth)
        .send({
          serviceSlug: 'car_tow',
          vehicleClass: 'wheel_lift',
          pickup: BENGALURU,
          drop: BENGALURU_DROP,
          scheduledAt: '2026-08-16T18:00:00.000Z',
        })
        .expect(200);

      expect(response.body.breakdown.nightPaise).toBe(
        Math.round(response.body.breakdown.basePaise * 0.15),
      );
    });

    it('flat-rates a roadside service and needs no drop', async () => {
      const response = await request(app.getHttpServer())
        .post('/v1/pricing/estimate')
        .set('Authorization', customerAuth)
        .send({ serviceSlug: 'fuel', pickup: BENGALURU })
        .expect(200);

      expect(response.body.distanceKm).toBe(0);
      expect(response.body.breakdown.basePaise).toBe(69_900);
      expect(response.body.band).toBe('A');
    });

    it('rejects a tow with no drop', async () => {
      await request(app.getHttpServer())
        .post('/v1/pricing/estimate')
        .set('Authorization', customerAuth)
        .send({ serviceSlug: 'car_tow', vehicleClass: 'wheel_lift', pickup: BENGALURU })
        .expect(422);
    });

    it('rejects a pickup outside every service zone (§9.1.5)', async () => {
      const response = await request(app.getHttpServer())
        .post('/v1/pricing/estimate')
        .set('Authorization', customerAuth)
        .send({ serviceSlug: 'car_tow', vehicleClass: 'wheel_lift', pickup: MUMBAI, drop: MUMBAI })
        .expect(422);

      expect(JSON.stringify(response.body)).toMatch(/do not operate/i);
    });

    it('rejects an unknown service slug rather than defaulting to a tow', async () => {
      await request(app.getHttpServer())
        .post('/v1/pricing/estimate')
        .set('Authorization', customerAuth)
        .send({ serviceSlug: 'helicopter_lift', pickup: BENGALURU, drop: BENGALURU_DROP })
        .expect(422);
    });

    it('rejects an out-of-range coordinate at the edge', async () => {
      await request(app.getHttpServer())
        .post('/v1/pricing/estimate')
        .set('Authorization', customerAuth)
        .send({ serviceSlug: 'car_tow', pickup: { lat: 500, lng: 77 }, drop: BENGALURU_DROP })
        .expect(422);
    });

    it('IS CONFIG-DRIVEN — editing a slab row changes the quote', async () => {
      const before = await estimate(app, customerAuth);

      // Double the 0–5 km wheel-lift slab. Nothing is redeployed, nothing is
      // recompiled: this is the whole point of §6.7.
      await db
        .update(pricingRules)
        .set({ price: toRupees(199_800) })
        .where(eq(pricingRules.ruleKind, 'slab'));
      await flushTestRedis();

      const after = await estimate(app, customerAuth);
      expect(after.breakdown.basePaise).toBe(199_800);
      expect(after.breakdown.basePaise).not.toBe(before.breakdown.basePaise);
    });

    it('IS CONFIG-DRIVEN — editing charge_config changes the night rate', async () => {
      await db.update(chargeConfig).set({ nightPct: '40.00' });
      await flushTestRedis();

      const response = await request(app.getHttpServer())
        .post('/v1/pricing/estimate')
        .set('Authorization', customerAuth)
        .send({
          serviceSlug: 'car_tow',
          vehicleClass: 'wheel_lift',
          pickup: BENGALURU,
          drop: BENGALURU_DROP,
          scheduledAt: '2026-08-16T18:00:00.000Z',
        })
        .expect(200);

      expect(response.body.breakdown.nightPaise).toBe(
        Math.round(response.body.breakdown.basePaise * 0.4),
      );
    });

    describe('§19.8 kill-switch warnings (A11)', () => {
      // Same ~170 km drop as the bookings-create spec — Band C.
      const FAR_DROP = { lat: 14.5, lng: 77.6 };

      const quote = (drop: { lat: number; lng: number }) =>
        request(app.getHttpServer())
          .post('/v1/pricing/estimate')
          .set('Authorization', customerAuth)
          .send({ serviceSlug: 'car_tow', vehicleClass: 'wheel_lift', pickup: BENGALURU, drop })
          .expect(200);

      it('serves no warnings when nothing is paused', async () => {
        const response = await quote(BENGALURU_DROP);
        expectMatchesContract(pricingEstimateResponseSchema, response.body);
        expect(response.body.warnings).toEqual([]);
      });

      it('warns instead of failing in a paused zone', async () => {
        const [zone] = await db
          .select({ id: serviceZones.id })
          .from(serviceZones)
          .where(eq(serviceZones.name, 'Bengaluru Metro'));
        await app.get(KillSwitchService).setPausedZones([zone!.id]);

        const response = await quote(BENGALURU_DROP);
        expect(response.status).toBe(200);
        expectMatchesContract(pricingEstimateResponseSchema, response.body);
        expect(response.body.warnings).toEqual(['dispatch_paused']);
      });

      it('warns on a long-distance quote while long-distance is disabled', async () => {
        await app.get(KillSwitchService).setLongDistanceDisabled(true);

        const response = await quote(FAR_DROP);
        expect(response.status).toBe(200);
        expect(response.body.band).toBe('C');
        expect(response.body.warnings).toEqual(['long_distance_disabled']);
      });
    });
  });

  describe('realm isolation', () => {
    it('403s a driver and an admin, and 401s an anonymous caller', async () => {
      const driverId = await seedDriver(db, { kycStatus: 'approved' });
      const driverAuth = await driverAuthHeaderFor(app, { driverId, kycStatus: 'approved' });
      const admin = await seedAdmin(db, { subRole: 'super_admin' });
      const adminAuth = await adminAuthHeaderFor(app, {
        adminId: admin.id,
        subRole: 'super_admin',
      });

      for (const auth of [driverAuth, adminAuth]) {
        await request(app.getHttpServer())
          .get('/v1/services')
          .set('Authorization', auth)
          .expect(403);
      }
      await request(app.getHttpServer()).get('/v1/services').expect(401);
    });
  });
});

async function estimate(app: INestApplication, auth: string) {
  const response = await request(app.getHttpServer())
    .post('/v1/pricing/estimate')
    .set('Authorization', auth)
    .send({
      serviceSlug: 'car_tow',
      vehicleClass: 'wheel_lift',
      pickup: BENGALURU,
      drop: BENGALURU_DROP,
      scheduledAt: '2026-08-16T06:30:00.000Z',
    })
    .expect(200);
  return response.body;
}

/**
 * The Phase 14 config, seeded the way `db/seed/seed.ts` seeds it. Kept local
 * rather than calling `runSeed` because that builds 506 bookings and 14 drivers
 * this file does not need, in a suite that runs serially.
 */
export async function seedPricingFixtures(db: TestDatabase): Promise<void> {
  await db.insert(serviceZones).values([
    {
      name: 'Bengaluru Metro',
      area: 'SRID=4326;POLYGON((77.45 12.80,77.80 12.80,77.80 13.15,77.45 13.15,77.45 12.80))',
      surgeBand: 'standard',
      dispatchConfig: { radiusLadderKm: [2, 4, 7, 10, 15], offersPerWave: 3 },
    },
    {
      name: 'Chennai Metro',
      area: 'SRID=4326;POLYGON((80.05 12.85,80.32 12.85,80.32 13.15,80.05 13.15,80.05 12.85))',
      surgeBand: 'high',
    },
    {
      name: 'NH-44 Bengaluru–Hosur Corridor',
      area: 'SRID=4326;POLYGON((77.62 12.70,77.72 12.70,77.72 12.95,77.62 12.95,77.62 12.70))',
      isHighway: true,
      surgeBand: 'standard',
    },
  ]);

  await db.insert(services).values(
    SERVICE_CATALOG.map((service, index) => ({
      slug: service.slug,
      serviceType: service.serviceType,
      defaultVehicleClass: service.defaultVehicleClass,
      name: service.name,
      description: service.description,
      requiresDrop: service.requiresDrop,
      displayOrder: index,
    })),
  );

  const rules: Array<typeof pricingRules.$inferInsert> = [];
  for (const vehicleClass of ['wheel_lift', 'flatbed'] as const) {
    for (const slab of DEFAULT_PRICING_RULES.slabs[vehicleClass]) {
      rules.push({
        ruleKind: 'slab',
        vehicleClass,
        maxKm: slab.maxKm.toFixed(2),
        price: toRupees(slab.pricePaise),
      });
    }
  }
  for (const band of DEFAULT_PRICING_RULES.longDistance) {
    rules.push({
      ruleKind: 'long_distance',
      vehicleClass: 'flatbed',
      maxKm: band.maxKm.toFixed(2),
      price: toRupees(band.pricePaise),
      priceMax: toRupees(band.priceMaxPaise ?? band.pricePaise),
    });
  }
  for (const [serviceType, farePaise] of Object.entries(DEFAULT_PRICING_RULES.roadside)) {
    rules.push({
      ruleKind: 'roadside',
      serviceType: serviceType as 'battery',
      price: toRupees(farePaise),
    });
  }
  await db.insert(pricingRules).values(rules);

  await db.insert(chargeConfig).values({});
  await db.insert(dispatchConfig).values({});
  // W12 — the public `GET /v1/app-config` reader falls back to code defaults
  // without this, which would make an app-config spec pass for the wrong reason.
  await db.insert(appConfig).values({});
  await db.insert(commissionConfig).values([
    { band: 'A', pct: '10.00' },
    { band: 'B', pct: '8.00' },
    { band: 'C', pct: '5.00' },
  ]);
  // W11 — the §3.3 window (decision G2). Migration 0026 inserts it and the real
  // seed repeats it; this fixture is what the specs truncate-and-seed against,
  // and a missing row would silently fall back to the code constants, making a
  // guardrail test pass for the wrong reason.
  await db.insert(commissionGuardrail).values({ floorPct: '5.00', capPct: '10.00' });
}
