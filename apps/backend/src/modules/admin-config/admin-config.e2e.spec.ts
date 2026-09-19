import type { INestApplication } from '@nestjs/common';
import {
  adminCommissionConfigSchema,
  adminPricingConfigSchema,
  adminPricingHistoryEntrySchema,
  adminPricingRuleSchema,
} from '@towing/api-contracts';
import { desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { adminActions, commissionConfig, commissionConfigHistory, pricingRules } from '../../db/schema';
import { adminAuthHeaderFor, createTestApp, customerAuthHeaderFor } from '../../test/app';
import { expectMatchesContract } from '../../test/contracts';
import {
  seedAdmin,
  seedCustomer,
  setupTestDatabase,
  truncateAll,
  type TestDatabase,
} from '../../test/db';
import { closeTestRedis, flushTestRedis } from '../../test/redis';
import { seedPricingFixtures } from '../pricing/pricing.e2e.spec';

/**
 * §16.5 `GET/PUT /v1/admin/pricing` · `GET/PUT /v1/admin/commission`.
 *
 * The reason these routes exist in Phase 14 at all is that the §3.3 guardrail
 * needs a way to be exercised — so the assertions that matter here are the
 * rejection, the audit row that accompanies it, and the history trail.
 */
describe('admin config (/v1/admin/pricing, /v1/admin/commission)', () => {
  let app: INestApplication;
  let db: TestDatabase;
  let financeId: string;
  let financeAuth: string;

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
    await seedPricingFixtures(db);
    const finance = await seedAdmin(db, { subRole: 'finance' });
    financeId = finance.id;
    financeAuth = await adminAuthHeaderFor(app, { adminId: finance.id, subRole: 'finance' });
  });

  describe('RBAC (§4.2 + W10 decision G1)', () => {
    it('lets operations, finance and super_admin reach PRICING, and keeps support out', async () => {
      // G1: §4.2 gives Operations the pricing and surge levers, and the shared
      // permission map has always granted `operations` `pricing.edit` — the nav
      // item existed while the route answered 403. This is the route agreeing.
      for (const subRole of ['operations', 'finance', 'super_admin'] as const) {
        const admin = await seedAdmin(db, { subRole });
        await request(app.getHttpServer())
          .get('/v1/admin/pricing')
          .set('Authorization', await adminAuthHeaderFor(app, { adminId: admin.id, subRole }))
          .expect(200);
      }

      const support = await seedAdmin(db, { subRole: 'support' });
      await request(app.getHttpServer())
        .get('/v1/admin/pricing')
        .set('Authorization', await adminAuthHeaderFor(app, { adminId: support.id, subRole: 'support' }))
        .expect(403);
    });

    it('lets operations WRITE pricing (G1) but never commission', async () => {
      const ops = await seedAdmin(db, { subRole: 'operations' });
      const opsAuth = await adminAuthHeaderFor(app, { adminId: ops.id, subRole: 'operations' });

      await request(app.getHttpServer())
        .put('/v1/admin/pricing')
        .set('Authorization', opsAuth)
        .send({ charges: { nightPct: 17 }, reason: 'Ops winter tweak' })
        .expect(200);

      // Setting a commission rate is a money decision; operations proposes
      // (W11's `commission_proposals`), it does not set.
      await request(app.getHttpServer())
        .put('/v1/admin/commission')
        .set('Authorization', opsAuth)
        .send({ bands: [{ band: 'A', pct: 9 }] })
        .expect(403);
    });

    it('keeps commission at finance and super_admin, and refuses operations and support', async () => {
      for (const subRole of ['finance', 'super_admin'] as const) {
        const admin = await seedAdmin(db, { subRole });
        await request(app.getHttpServer())
          .get('/v1/admin/commission')
          .set('Authorization', await adminAuthHeaderFor(app, { adminId: admin.id, subRole }))
          .expect(200);
      }

      for (const subRole of ['operations', 'support'] as const) {
        const admin = await seedAdmin(db, { subRole });
        await request(app.getHttpServer())
          .get('/v1/admin/commission')
          .set('Authorization', await adminAuthHeaderFor(app, { adminId: admin.id, subRole }))
          .expect(403);
      }
    });

    it('refuses a customer token and an anonymous caller', async () => {
      const customerAuth = await customerAuthHeaderFor(app, { userId: await seedCustomer(db) });
      await request(app.getHttpServer())
        .get('/v1/admin/pricing')
        .set('Authorization', customerAuth)
        .expect(403);
      await request(app.getHttpServer()).get('/v1/admin/pricing').expect(401);
    });

    it('refuses a support admin the WRITE as well as the read', async () => {
      const support = await seedAdmin(db, { subRole: 'support' });
      const supportAuth = await adminAuthHeaderFor(app, {
        adminId: support.id,
        subRole: 'support',
      });

      await request(app.getHttpServer())
        .put('/v1/admin/commission')
        .set('Authorization', supportAuth)
        .send({ bands: [{ band: 'A', pct: 9 }] })
        .expect(403);

      await request(app.getHttpServer())
        .put('/v1/admin/pricing')
        .set('Authorization', supportAuth)
        .send({ charges: { nightPct: 17 } })
        .expect(403);
    });
  });

  describe('GET', () => {
    it('serves the pricing config against its contract', async () => {
      const response = await request(app.getHttpServer())
        .get('/v1/admin/pricing')
        .set('Authorization', financeAuth)
        .expect(200);

      expectMatchesContract(adminPricingConfigSchema, response.body);
      expect(response.body.charges.nightPct).toBe(15);
      expect(response.body.rules.length).toBeGreaterThan(0);
    });

    it('serves the commission config with its guardrail, so a form can render it', async () => {
      const response = await request(app.getHttpServer())
        .get('/v1/admin/commission')
        .set('Authorization', financeAuth)
        .expect(200);

      expectMatchesContract(adminCommissionConfigSchema, response.body);
      expect(response.body.floorPct).toBe(5);
      expect(response.body.capPct).toBe(10);
      expect(response.body.bands.map((b: { band: string; pct: number }) => [b.band, b.pct])).toEqual([
        ['A', 10],
        ['B', 8],
        ['C', 5],
      ]);
    });
  });

  describe('PUT /v1/admin/commission — the §3.3 guardrail', () => {
    it('accepts a change inside the band and writes config, history and audit', async () => {
      const response = await request(app.getHttpServer())
        .put('/v1/admin/commission')
        .set('Authorization', financeAuth)
        .send({ bands: [{ band: 'A', pct: 9.5 }], reason: 'Festive season retention' })
        .expect(200);

      expect(response.body.bands.find((b: { band: string }) => b.band === 'A').pct).toBe(9.5);

      const [row] = await db.select().from(commissionConfig).where(eq(commissionConfig.band, 'A'));
      expect(Number(row!.pct)).toBe(9.5);
      expect(row!.updatedBy).toBe(financeId);

      // §3.3 "versioned + audited" — the version half.
      const history = await db
        .select()
        .from(commissionConfigHistory)
        .where(eq(commissionConfigHistory.band, 'A'))
        .orderBy(desc(commissionConfigHistory.createdAt));
      expect(Number(history[0]!.oldPct)).toBe(10);
      expect(Number(history[0]!.newPct)).toBe(9.5);
      expect(history[0]!.reason).toBe('Festive season retention');

      // …and the audited half, joined to it.
      const audits = await db
        .select()
        .from(adminActions)
        .where(eq(adminActions.action, 'commission.update'));
      expect(audits).toHaveLength(1);
      expect(audits[0]!.adminId).toBe(financeId);
      expect(history[0]!.adminActionId).toBe(audits[0]!.id);
    });

    it('REJECTS an out-of-band percentage AND audits the attempt (§3.3)', async () => {
      // Both halves of §3.3's sentence: "attempts outside the band are rejected
      // AND audited". A rejection nobody can see afterwards is half a control —
      // someone probing the fare engine's limits is exactly what the audit log
      // is for.
      const response = await request(app.getHttpServer())
        .put('/v1/admin/commission')
        .set('Authorization', financeAuth)
        .send({ bands: [{ band: 'A', pct: 11 }], reason: 'Trying it on' })
        .expect(422);

      expect(JSON.stringify(response.body)).toMatch(/5.*10/);

      // THE AUDIT ROW. This is the half that a pipe-level range check would
      // have silently dropped: the schema deliberately stops at a sanity bound
      // so an out-of-band attempt reaches the service, which records it before
      // refusing.
      const rejected = await db
        .select()
        .from(adminActions)
        .where(eq(adminActions.action, 'commission.update.rejected'));
      expect(rejected).toHaveLength(1);
      expect(rejected[0]!.adminId).toBe(financeId);
      expect(rejected[0]!.reason).toBe('Trying it on');
      expect(rejected[0]!.after).toBeNull();

      // Nothing moved.
      const [row] = await db.select().from(commissionConfig).where(eq(commissionConfig.band, 'A'));
      expect(Number(row!.pct)).toBe(10);
      expect(await db.select().from(commissionConfigHistory).where(eq(commissionConfigHistory.oldPct, '10.00'))).toHaveLength(0);
    });

    it('rejects below the floor as well as above the cap', async () => {
      for (const pct of [4.99, 0, -5, 10.01, 50]) {
        await request(app.getHttpServer())
          .put('/v1/admin/commission')
          .set('Authorization', financeAuth)
          .send({ bands: [{ band: 'B', pct }] })
          .expect(422);
      }
      const [row] = await db.select().from(commissionConfig).where(eq(commissionConfig.band, 'B'));
      expect(Number(row!.pct)).toBe(8);
    });

    it('rejects the WHOLE request when any one band is out of range', async () => {
      // Partial application would leave the platform half re-rated, and the
      // admin with no signal about which half.
      await request(app.getHttpServer())
        .put('/v1/admin/commission')
        .set('Authorization', financeAuth)
        .send({
          bands: [
            { band: 'A', pct: 9 },
            { band: 'B', pct: 99 },
          ],
        })
        .expect(422);

      const rows = await db.select().from(commissionConfig);
      expect(rows.map((r) => Number(r.pct)).sort((a, b) => a - b)).toEqual([5, 8, 10]);
    });

    it('exposes the change through GET /commission/history', async () => {
      await request(app.getHttpServer())
        .put('/v1/admin/commission')
        .set('Authorization', financeAuth)
        .send({ bands: [{ band: 'C', pct: 6 }] })
        .expect(200);

      const response = await request(app.getHttpServer())
        .get('/v1/admin/commission/history')
        .set('Authorization', financeAuth)
        .expect(200);

      // Three genesis rows from the fixture would be here too if it seeded them;
      // this fixture does not, so the newest row is the edit.
      expect(response.body[0].band).toBe('C');
      expect(response.body[0].newPct).toBe(6);
      expect(response.body[0].oldPct).toBe(5);
    });
  });

  describe('PUT /v1/admin/pricing', () => {
    it('patches a single charge without resetting its neighbours', async () => {
      // Phase 13's `.partial()` bug, in the place it would hurt most: a one-key
      // PUT that silently rewrites the whole fare matrix. The assertion is that
      // every OTHER key is untouched, not merely that this one changed.
      const before = (
        await request(app.getHttpServer()).get('/v1/admin/pricing').set('Authorization', financeAuth)
      ).body;

      await request(app.getHttpServer())
        .put('/v1/admin/pricing')
        .set('Authorization', financeAuth)
        .send({ charges: { nightPct: 20 } })
        .expect(200);

      const after = (
        await request(app.getHttpServer()).get('/v1/admin/pricing').set('Authorization', financeAuth)
      ).body;

      expect(after.charges.nightPct).toBe(20);
      expect({ ...after.charges, nightPct: 0 }).toEqual({ ...before.charges, nightPct: 0 });
    });

    it('edits a slab price and audits it', async () => {
      const before = (
        await request(app.getHttpServer()).get('/v1/admin/pricing').set('Authorization', financeAuth)
      ).body;
      const slab = before.rules.find((r: { ruleKind: string }) => r.ruleKind === 'slab');

      await request(app.getHttpServer())
        .put('/v1/admin/pricing')
        .set('Authorization', financeAuth)
        .send({ rules: [{ id: slab.id, pricePaise: 123_400 }], reason: 'Fuel cost' })
        .expect(200);

      const after = (
        await request(app.getHttpServer()).get('/v1/admin/pricing').set('Authorization', financeAuth)
      ).body;
      expect(after.rules.find((r: { id: string }) => r.id === slab.id).pricePaise).toBe(123_400);

      const audits = await db.select().from(adminActions).where(eq(adminActions.action, 'pricing.update'));
      expect(audits).toHaveLength(1);
      expect(audits[0]!.reason).toBe('Fuel cost');
      // Whole-row snapshots, so "what changed" is answerable without a diff log.
      expect(audits[0]!.before).toBeTruthy();
      expect(audits[0]!.after).toBeTruthy();
    });

    it('rejects an empty update rather than writing an audit row for nothing', async () => {
      await request(app.getHttpServer())
        .put('/v1/admin/pricing')
        .set('Authorization', financeAuth)
        .send({})
        .expect(422);

      expect(await db.select().from(adminActions).where(eq(adminActions.action, 'pricing.update'))).toHaveLength(0);
    });

    it('rejects a charge value outside its schema range', async () => {
      for (const charges of [
        { nightPct: 150 },
        { nightStartHour: 25 },
        { haversineRoadFactor: 0.5 },
        { surgePctPeak: -1 },
      ]) {
        await request(app.getHttpServer())
          .put('/v1/admin/pricing')
          .set('Authorization', financeAuth)
          .send({ charges })
          .expect(422);
      }
    });
  });

  describe('POST /v1/admin/pricing/rules (W10)', () => {
    // ~0.5 km apart, so the quote lands in the 0–5 km slab — where a new 3 km
    // band can be made to matter.
    const SHORT_PICKUP = { lat: 12.9716, lng: 77.5946 };
    const SHORT_DROP = { lat: 12.974, lng: 77.597 };

    const estimateShortTrip = (customerAuth: string) =>
      request(app.getHttpServer())
        .post('/v1/pricing/estimate')
        .set('Authorization', customerAuth)
        .send({
          serviceSlug: 'car_tow',
          vehicleClass: 'wheel_lift',
          pickup: SHORT_PICKUP,
          drop: SHORT_DROP,
          scheduledAt: '2026-08-16T18:00:00.000Z',
        })
        .expect(200);

    it('adds a slab and prices the very NEXT estimate from it', async () => {
      const customerAuth = await customerAuthHeaderFor(app, { userId: await seedCustomer(db) });

      const before = await estimateShortTrip(customerAuth);
      expect(before.body.breakdown.basePaise).toBe(99_900);

      const created = await request(app.getHttpServer())
        .post('/v1/admin/pricing/rules')
        .set('Authorization', financeAuth)
        .send({
          ruleKind: 'slab',
          vehicleClass: 'wheel_lift',
          maxKm: 3,
          pricePaise: 123_400,
          reason: 'Airport runs',
        })
        .expect(200);

      expectMatchesContract(adminPricingRuleSchema, created.body);
      expect(created.body.maxKm).toBe(3);
      expect(created.body.isActive).toBe(true);

      // NO cache flush between these two calls: the write invalidated the rate
      // card. §6.7 promises "no deploy", not "no deploy but wait for the TTL".
      const after = await estimateShortTrip(customerAuth);
      expect(after.body.breakdown.basePaise).toBe(123_400);

      const audits = await db
        .select()
        .from(adminActions)
        .where(eq(adminActions.action, 'pricing.rule.create'));
      expect(audits).toHaveLength(1);
      expect(audits[0]!.subjectId).toBe(created.body.id);
      expect(audits[0]!.reason).toBe('Airport runs');
    });

    it('refuses a shape the CHECK would refuse, as a field-level 422', async () => {
      const seeded = await db.select().from(pricingRules);
      const cases: Array<Record<string, unknown>> = [
        // slab with a service_type — the service column is roadside-only.
        { ruleKind: 'slab', serviceType: 'battery', vehicleClass: 'wheel_lift', maxKm: 5, pricePaise: 1_000 },
        // slab with a ceiling — slabs are single prices.
        { ruleKind: 'slab', vehicleClass: 'wheel_lift', maxKm: 5, pricePaise: 1_000, priceMaxPaise: 2_000 },
        // slab without its band.
        { ruleKind: 'slab', vehicleClass: 'wheel_lift', pricePaise: 1_000 },
        // long_distance without a ceiling.
        { ruleKind: 'long_distance', vehicleClass: 'flatbed', maxKm: 700, pricePaise: 1_000 },
        // inverted §7.3 range — would quote a longer tow LESS (the price_range
        // CHECK's whole reason for existing).
        { ruleKind: 'long_distance', vehicleClass: 'flatbed', maxKm: 700, pricePaise: 5_000, priceMaxPaise: 4_000 },
        // roadside without a service…
        { ruleKind: 'roadside', maxKm: 5, pricePaise: 1_000 },
        // …and roadside that carries fields no lookup path reads.
        { ruleKind: 'roadside', serviceType: 'battery', maxKm: 5, pricePaise: 1_000 },
      ];

      for (const body of cases) {
        await request(app.getHttpServer())
          .post('/v1/admin/pricing/rules')
          .set('Authorization', financeAuth)
          .send(body)
          .expect(422);
      }

      // Nothing was written and nothing was audited — a refused shape never
      // reached the database, so no rollback story is needed.
      expect(await db.select().from(pricingRules)).toHaveLength(seeded.length);
      expect(
        await db.select().from(adminActions).where(eq(adminActions.action, 'pricing.rule.create')),
      ).toHaveLength(0);
    });

    it('refuses a second ACTIVE rule on the same band, and deactivation frees it', async () => {
      const response = await request(app.getHttpServer())
        .post('/v1/admin/pricing/rules')
        .set('Authorization', financeAuth)
        .send({ ruleKind: 'slab', vehicleClass: 'wheel_lift', maxKm: 5, pricePaise: 111_100 })
        .expect(409);
      expect(JSON.stringify(response.body)).toMatch(/deactivate/i);

      // The unique indexes are PARTIAL on `is_active`, so retiring the incumbent
      // is the documented way to reuse a band — prove it, rather than documenting
      // a conflict the operator cannot get out of.
      const config = (
        await request(app.getHttpServer()).get('/v1/admin/pricing').set('Authorization', financeAuth)
      ).body;
      const incumbent = config.rules.find(
        (rule: { ruleKind: string; vehicleClass: string; maxKm: number }) =>
          rule.ruleKind === 'slab' && rule.vehicleClass === 'wheel_lift' && rule.maxKm === 5,
      );

      await request(app.getHttpServer())
        .post(`/v1/admin/pricing/rules/${incumbent.id}/deactivate`)
        .set('Authorization', financeAuth)
        .send({ reason: 'Superseded by the 3 km band' })
        .expect(200);

      await request(app.getHttpServer())
        .post('/v1/admin/pricing/rules')
        .set('Authorization', financeAuth)
        .send({
          ruleKind: 'slab',
          vehicleClass: 'wheel_lift',
          maxKm: 5,
          pricePaise: 111_100,
          reason: 'Replacement band',
        })
        .expect(200);
    });
  });

  describe('POST /v1/admin/pricing/rules/:id/deactivate (W10)', () => {
    it('retires a rule without deleting it, and a double tap writes one audit row', async () => {
      const config = (
        await request(app.getHttpServer()).get('/v1/admin/pricing').set('Authorization', financeAuth)
      ).body;
      const slab = config.rules.find(
        (rule: { ruleKind: string; vehicleClass: string; maxKm: number }) =>
          rule.ruleKind === 'slab' && rule.vehicleClass === 'wheel_lift' && rule.maxKm === 10,
      );

      const retired = await request(app.getHttpServer())
        .post(`/v1/admin/pricing/rules/${slab.id}/deactivate`)
        .set('Authorization', financeAuth)
        .send({ reason: 'Season over' })
        .expect(200);
      expect(retired.body.isActive).toBe(false);

      // RETIRED, NOT DELETED — the row survives so the audit trail's reference
      // stays coherent and history keeps saying what old bookings were priced on.
      const rows = await db.select().from(pricingRules).where(eq(pricingRules.id, slab.id));
      expect(rows).toHaveLength(1);
      expect(rows[0]!.isActive).toBe(false);

      // Idempotent: the second call is a no-op, not a second audit row.
      await request(app.getHttpServer())
        .post(`/v1/admin/pricing/rules/${slab.id}/deactivate`)
        .set('Authorization', financeAuth)
        .send({})
        .expect(200);
      const audits = await db
        .select()
        .from(adminActions)
        .where(eq(adminActions.action, 'pricing.rule.deactivate'));
      expect(audits).toHaveLength(1);
      expect(audits[0]!.before).toBeTruthy();
      expect(audits[0]!.after).toBeTruthy();
    });

    it('404s an unknown rule', async () => {
      await request(app.getHttpServer())
        .post('/v1/admin/pricing/rules/00000000-0000-0000-0000-000000000000/deactivate')
        .set('Authorization', financeAuth)
        .send({})
        .expect(404);
    });
  });

  describe('GET /v1/admin/pricing/history (W10)', () => {
    it('reads the audit rows back as the version history, newest first', async () => {
      await request(app.getHttpServer())
        .put('/v1/admin/pricing')
        .set('Authorization', financeAuth)
        .send({ charges: { nightPct: 20 }, reason: 'Winter adjustments' })
        .expect(200);

      await request(app.getHttpServer())
        .post('/v1/admin/pricing/rules')
        .set('Authorization', financeAuth)
        .send({
          ruleKind: 'roadside',
          serviceType: 'accident_recovery',
          pricePaise: 88_000,
          reason: 'New roadside service',
        })
        .expect(200);

      const response = await request(app.getHttpServer())
        .get('/v1/admin/pricing/history')
        .set('Authorization', financeAuth)
        .expect(200);

      expectMatchesContract(z.array(adminPricingHistoryEntrySchema), response.body);
      expect(response.body.map((entry: { action: string }) => entry.action)).toEqual([
        'pricing.rule.create',
        'pricing.update',
      ]);
      // Whole before/after snapshots — §9.4.8's "saved (versioned)".
      expect(response.body[0].after).toBeTruthy();
      expect(response.body[1].before).toBeTruthy();
      expect(response.body[1].reason).toBe('Winter adjustments');
    });
  });

  describe('cache invalidation (§6.7 "no deploy needed")', () => {
    it('makes an admin edit visible to the very next estimate', async () => {
      const customerAuth = await customerAuthHeaderFor(app, { userId: await seedCustomer(db) });
      const estimate = () =>
        request(app.getHttpServer())
          .post('/v1/pricing/estimate')
          .set('Authorization', customerAuth)
          .send({
            serviceSlug: 'car_tow',
            vehicleClass: 'wheel_lift',
            pickup: { lat: 12.9716, lng: 77.5946 },
            drop: { lat: 12.9569, lng: 77.7011 },
            scheduledAt: '2026-08-16T18:00:00.000Z',
          })
          .expect(200);

      const before = await estimate();
      expect(before.body.breakdown.nightPaise).toBe(
        Math.round(before.body.breakdown.basePaise * 0.15),
      );

      await request(app.getHttpServer())
        .put('/v1/admin/pricing')
        .set('Authorization', financeAuth)
        .send({ charges: { nightPct: 50 } })
        .expect(200);

      // NO cache flush between these two calls — the write path must have
      // invalidated it. §6.7 promises "no deploy", not "no deploy but wait five
      // minutes for the TTL".
      const after = await estimate();
      expect(after.body.breakdown.nightPaise).toBe(
        Math.round(after.body.breakdown.basePaise * 0.5),
      );
    });
  });
});
