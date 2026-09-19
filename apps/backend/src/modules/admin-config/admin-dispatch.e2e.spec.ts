import type { INestApplication } from '@nestjs/common';
import type { AdminDispatchConfig } from '@towing/api-contracts';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { KillSwitchService } from '../../common/killswitch/killswitch.service';
import { adminActions, serviceZones } from '../../db/schema';
import { adminAuthHeaderFor, createTestApp, driverAuthHeaderFor } from '../../test/app';
import {
  seedAdmin,
  seedDriver,
  setupTestDatabase,
  testDb,
  truncateAll,
  type TestDatabase,
} from '../../test/db';
import { closeTestRedis, flushTestRedis } from '../../test/redis';
import { DispatchConfigRepo } from '../bookings/dispatch-config.repo';
import { DriverPresenceService } from '../driver-presence/driver-presence.service';
import { seedDispatchConfig, seedOnlineDriver, seedZone } from '../dispatch/dispatch-fixtures';

/**
 * §16.5's `GET/PUT /v1/admin/dispatch-config`.
 *
 * §6.7 requires every knob here to change with NO DEPLOY, which is only true
 * because the engine reads each of them at query time. The last test in this
 * file is the one that proves it — a config edit followed by an immediate
 * behaviour change, with nothing restarted.
 */

let app: INestApplication;
let db: TestDatabase;

async function getConfig(auth: string): Promise<AdminDispatchConfig> {
  const res = await request(app.getHttpServer())
    .get('/v1/admin/dispatch-config')
    .set('Authorization', auth)
    .expect(200);
  return res.body as AdminDispatchConfig;
}

describe('admin dispatch config (§16.5)', () => {
  let auth: string;
  let adminId: string;

  beforeAll(async () => {
    await setupTestDatabase();
    db = testDb();
    app = await createTestApp();
  });

  beforeEach(async () => {
    await truncateAll();
    await flushTestRedis();
    await app.get(DispatchConfigRepo).invalidate();
    const admin = await seedAdmin(db, { subRole: 'operations' });
    adminId = admin.id;
    auth = await adminAuthHeaderFor(app, { adminId, subRole: 'operations' });
  });

  afterAll(async () => {
    await app.close();
    await closeTestRedis();
  });

  describe('reading', () => {
    it('reports the seeded global row and every zone', async () => {
      await seedDispatchConfig(db, { stalePingSeconds: 15 });
      const zoneId = await seedZone(db, { name: 'Bengaluru Metro' });

      const config = await getConfig(auth);

      expect(config.global).toMatchObject({
        weights: { proximity: 60, rating: 15, acceptance: 15, completion: 10 },
        stalePingSeconds: 15,
      });
      expect(config.zones).toHaveLength(1);
      expect(config.zones[0]).toMatchObject({ zoneId, zoneName: 'Bengaluru Metro' });
    });

    it('reports documented defaults for a database with no global row', async () => {
      // A fresh or half-seeded environment must show what the engine WOULD use,
      // not 500 — `DispatchConfigRepo` takes the same view.
      await seedZone(db);

      const config = await getConfig(auth);

      expect(config.global.stalePingSeconds).toBe(15);
      expect(config.global.weights.proximity).toBe(60);
    });

    it('shows an untuned zone as override:null with the resolved defaults beside it', async () => {
      /**
       * The distinction that keeps §6.7 working. Showing the RESOLVED values in
       * the editable field would make an admin's first save write the code
       * defaults as explicit overrides — and that zone would then stop tracking
       * any future change to those defaults, silently, forever.
       */
      await seedZone(db, { dispatchConfig: null });

      const config = await getConfig(auth);

      expect(config.zones[0]!.override).toBeNull();
      expect(config.zones[0]!.resolved.radiusLadderKm).toEqual([2, 4, 7, 10, 15]);
    });
  });

  describe('writing', () => {
    it('updates only the keys sent, leaving the rest alone', async () => {
      // Phase 13 shipped a bug where a `.partial()` schema kept each field's
      // `.default()`, so a one-key PUT arrived as every key and reset the rest.
      // Every field on the update schema is explicitly `.optional()` for this.
      await seedDispatchConfig(db, { stalePingSeconds: 15 });

      await request(app.getHttpServer())
        .put('/v1/admin/dispatch-config')
        .set('Authorization', auth)
        .send({ stalePingSeconds: 45, reason: 'Patchy coverage in the north zone' })
        .expect(200);

      const config = await getConfig(auth);
      expect(config.global.stalePingSeconds).toBe(45);
      // Untouched.
      expect(config.global.weights).toMatchObject({ proximity: 60, rating: 15 });
      expect(config.global.oneActiveBookingPerCustomer).toBe(true);
    });

    it('sets and CLEARS a per-zone override', async () => {
      const zoneId = await seedZone(db, { dispatchConfig: null });

      await request(app.getHttpServer())
        .put('/v1/admin/dispatch-config')
        .set('Authorization', auth)
        .send({ zones: [{ zoneId, override: { radiusLadderKm: [1, 3], offersPerWave: 5 } }] })
        .expect(200);

      let config = await getConfig(auth);
      expect(config.zones[0]!.resolved.radiusLadderKm).toEqual([1, 3]);
      expect(config.zones[0]!.resolved.offersPerWave).toBe(5);
      // A key the override did not mention falls back to the default rather than
      // being blanked — `resolveDispatchConfig`'s explicit merge.
      expect(config.zones[0]!.resolved.maxSearchSeconds).toBe(180);

      // `null` is the undo, and an admin must be able to reach it without
      // knowing what the defaults were.
      await request(app.getHttpServer())
        .put('/v1/admin/dispatch-config')
        .set('Authorization', auth)
        .send({ zones: [{ zoneId, override: null }] })
        .expect(200);

      config = await getConfig(auth);
      expect(config.zones[0]!.override).toBeNull();
      expect(config.zones[0]!.resolved.radiusLadderKm).toEqual([2, 4, 7, 10, 15]);
    });

    it('rejects a ladder that is not strictly ascending', async () => {
      // The same typed schema Phase 14 seeds with, so an admin cannot write a
      // ladder the matcher would then have to defend against.
      const zoneId = await seedZone(db);

      await request(app.getHttpServer())
        .put('/v1/admin/dispatch-config')
        .set('Authorization', auth)
        .send({ zones: [{ zoneId, override: { radiusLadderKm: [10, 4] } }] })
        .expect(422);
    });

    it('rejects scorer weights that do not sum to 100', async () => {
      await request(app.getHttpServer())
        .put('/v1/admin/dispatch-config')
        .set('Authorization', auth)
        .send({ weights: { proximity: 60, rating: 15, acceptance: 15, completion: 40 } })
        .expect(422);
    });

    it('rejects an unknown zone id rather than silently updating nothing', async () => {
      await seedZone(db);

      await request(app.getHttpServer())
        .put('/v1/admin/dispatch-config')
        .set('Authorization', auth)
        .send({ zones: [{ zoneId: '00000000-0000-4000-8000-000000000000', override: null }] })
        .expect(422);
    });

    it('audits every write to admin_actions', async () => {
      // These knobs decide which driver gets which job — which is to say who
      // earns what. A change with no attribution is not something anyone should
      // be able to make.
      await seedDispatchConfig(db);

      await request(app.getHttpServer())
        .put('/v1/admin/dispatch-config')
        .set('Authorization', auth)
        .send({ stalePingSeconds: 30, reason: 'Network incident' })
        .expect(200);

      const [action] = await db
        .select()
        .from(adminActions)
        .where(eq(adminActions.action, 'dispatch_config.update'));

      expect(action).toMatchObject({ adminId, reason: 'Network incident' });
      expect((action!.before as { global: { stalePingSeconds: number } }).global.stalePingSeconds).toBe(15);
      expect((action!.after as { global: { stalePingSeconds: number } }).global.stalePingSeconds).toBe(30);
    });
  });

  describe('§19.8 kill switches', () => {
    it('pauses and unpauses a zone', async () => {
      const zoneId = await seedZone(db);

      await request(app.getHttpServer())
        .put('/v1/admin/dispatch-config')
        .set('Authorization', auth)
        .send({ killSwitches: { pausedZoneIds: [zoneId] } })
        .expect(200);

      expect(await app.get(KillSwitchService).isZonePaused(zoneId)).toBe(true);
      expect((await getConfig(auth)).killSwitches.pausedZoneIds).toEqual([zoneId]);

      // Replaced wholesale, so an empty array is how "unpause everything" is
      // expressed — a diff-based update could not say it.
      await request(app.getHttpServer())
        .put('/v1/admin/dispatch-config')
        .set('Authorization', auth)
        .send({ killSwitches: { pausedZoneIds: [] } })
        .expect(200);

      expect(await app.get(KillSwitchService).isZonePaused(zoneId)).toBe(false);
    });

    it('forcing polling makes the customer ticket route refuse', async () => {
      // §19.2's client contract: the same `realtime_unavailable` code
      // `REALTIME_ENABLED=false` produces, so every app already knows how to
      // respond to it.
      await request(app.getHttpServer())
        .put('/v1/admin/dispatch-config')
        .set('Authorization', auth)
        .send({ killSwitches: { forcePolling: true } })
        .expect(200);

      expect(await app.get(KillSwitchService).isPollingForced()).toBe(true);

      await request(app.getHttpServer())
        .put('/v1/admin/dispatch-config')
        .set('Authorization', auth)
        .send({ killSwitches: { forcePolling: false } })
        .expect(200);
    });
  });

  describe('§4.2 RBAC', () => {
    it('lets operations in — these are operational levers, not money ones', async () => {
      await seedZone(db);
      await request(app.getHttpServer())
        .get('/v1/admin/dispatch-config')
        .set('Authorization', auth)
        .expect(200);
    });

    it('refuses finance, who owns pricing but not the map', async () => {
      const finance = await seedAdmin(db, { subRole: 'finance' });
      await request(app.getHttpServer())
        .get('/v1/admin/dispatch-config')
        .set('Authorization', await adminAuthHeaderFor(app, { adminId: finance.id, subRole: 'finance' }))
        .expect(403);
    });

    it('refuses support, who can read the KYC queue and nothing else here', async () => {
      const support = await seedAdmin(db, { subRole: 'support' });
      await request(app.getHttpServer())
        .put('/v1/admin/dispatch-config')
        .set('Authorization', await adminAuthHeaderFor(app, { adminId: support.id, subRole: 'support' }))
        .send({ stalePingSeconds: 60 })
        .expect(403);
    });

    it('refuses a driver token outright', async () => {
      const driverId = await seedDriver(db, { kycStatus: 'approved' });
      await request(app.getHttpServer())
        .get('/v1/admin/dispatch-config')
        .set('Authorization', await driverAuthHeaderFor(app, { driverId }))
        .expect(403);
    });
  });

  it('takes effect on the NEXT WAVE, with nothing restarted (§6.7)', async () => {
    /**
     * The claim the whole route exists to make good on. `DispatchConfigRepo`
     * caches for five minutes, so this only passes because the write path
     * invalidates — "no deploy" is not satisfied by "no deploy, but wait five
     * minutes".
     */
    await seedDispatchConfig(db, { stalePingSeconds: 15 });
    expect((await app.get(DispatchConfigRepo).load()).stalePingSeconds).toBe(15);

    await request(app.getHttpServer())
      .put('/v1/admin/dispatch-config')
      .set('Authorization', auth)
      .send({ stalePingSeconds: 90 })
      .expect(200);

    expect((await app.get(DispatchConfigRepo).load()).stalePingSeconds).toBe(90);
  });

  describe('W12 knobs: re-dispatch priority, ping cadence, per-service offers', () => {
    it('serves the documented defaults for a database that has never been tuned', async () => {
      await seedDispatchConfig(db);
      const config = await getConfig(auth);

      expect(config.global).toMatchObject({
        redispatchPriority: 'front',
        pingOnJobMs: 3_000,
        pingIdleMs: 10_000,
        perServiceMaxOffers: null,
      });
    });

    it('edits all four, and audits the change', async () => {
      await seedDispatchConfig(db);

      const response = await request(app.getHttpServer())
        .put('/v1/admin/dispatch-config')
        .set('Authorization', auth)
        .send({
          redispatchPriority: 'normal',
          pingOnJobMs: 5_000,
          pingIdleMs: 12_000,
          perServiceMaxOffers: { fuel: 1, breakdown: 2 },
          reason: 'Network incident tuning',
        })
        .expect(200);

      expect(response.body.global).toMatchObject({
        redispatchPriority: 'normal',
        pingOnJobMs: 5_000,
        pingIdleMs: 12_000,
        perServiceMaxOffers: { fuel: 1, breakdown: 2 },
      });

      const audits = await db
        .select()
        .from(adminActions)
        .where(eq(adminActions.action, 'dispatch_config.update'));
      expect(audits.length).toBeGreaterThan(0);
      expect(audits[audits.length - 1]!.reason).toBe('Network incident tuning');
    });

    it('CLEARS the platform per-service offers with null — different from omitting them', async () => {
      await seedDispatchConfig(db, { perServiceMaxOffers: { fuel: 1 } });

      // Omitting the key leaves it alone…
      await request(app.getHttpServer())
        .put('/v1/admin/dispatch-config')
        .set('Authorization', auth)
        .send({ pingIdleMs: 11_000 })
        .expect(200);

      let config = await getConfig(auth);
      expect(config.global.perServiceMaxOffers).toEqual({ fuel: 1 });

      // …and an explicit null clears it.
      await request(app.getHttpServer())
        .put('/v1/admin/dispatch-config')
        .set('Authorization', auth)
        .send({ perServiceMaxOffers: null })
        .expect(200);

      config = await getConfig(auth);
      expect(config.global.perServiceMaxOffers).toBeNull();
    });

    it('refuses an out-of-range cadence and an unknown priority at the schema', async () => {
      await seedDispatchConfig(db);

      for (const body of [
        { pingOnJobMs: 500 },
        { pingIdleMs: 400_000 },
        { redispatchPriority: 'sometimes' },
        { perServiceMaxOffers: { fuel: 99 } },
      ]) {
        await request(app.getHttpServer())
          .put('/v1/admin/dispatch-config')
          .set('Authorization', auth)
          .send(body)
          .expect(422);
      }
    });

    it('carries a cadence change straight through to the driver config (§11.3)', async () => {
      // The knob was a frozen constant in contracts; W12 made it a column. The
      // proof is that the pushed config reads it — with no restart, the same
      // route the handset gets its cadence from.
      await seedDispatchConfig(db, { pingIdleMs: 10_000, pingOnJobMs: 3_000 });
      const zoneId = await seedZone(db);
      const driverId = await seedOnlineDriver(db, { zoneId, metersAway: 500 });

      const presence = app.get(DriverPresenceService);
      expect((await presence.configFor(driverId)).pingIntervalMs).toBe(10_000);

      await request(app.getHttpServer())
        .put('/v1/admin/dispatch-config')
        .set('Authorization', auth)
        .send({ pingIdleMs: 7_000 })
        .expect(200);

      expect((await presence.configFor(driverId)).pingIntervalMs).toBe(7_000);
    });
  });
});
