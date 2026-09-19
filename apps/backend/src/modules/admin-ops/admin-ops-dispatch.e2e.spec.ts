import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  adminDispatchInspectorListResponseSchema,
  adminDispatchInspectorResponseSchema,
  type AdminDispatchInspectorResponse,
} from '@towing/api-contracts';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppModule } from '../../app.module';
import { bookings } from '../../db/schema';
import { AdminOpsBroadcasterService } from '../../realtime/admin-ops-broadcaster.service';
import { adminAuthHeaderFor, authHeaderFor } from '../../test/app';
import { expectMatchesContract } from '../../test/contracts';
import {
  seedAdmin,
  seedCustomer,
  seedFleet,
  setupTestDatabase,
  truncateAll,
  type TestDatabase,
} from '../../test/db';
import { closeTestRedis, flushTestRedis } from '../../test/redis';
import {
  seedDispatchConfig,
  seedOnlineDriver,
  seedSearchingBooking,
  seedZone,
} from '../dispatch/dispatch-fixtures';
import { DispatchRepo } from '../dispatch/dispatch.repo';
import { DispatchService } from '../dispatch/dispatch.service';

/**
 * W5 — the dispatch inspector (§9.4.6): `/v1/admin/ops/dispatch` and
 * `/v1/admin/ops/dispatch/:bookingId`.
 *
 * THE WAVE LOG IS ASSERTED AGAINST THE REAL ENGINE, not a stubbed selection:
 * each test drives `DispatchService.runWave` (the suite runs queue-off, which
 * is exactly why that method is public and directly drivable) and then reads
 * the inspector the way an operator would. The property that matters is the
 * one nothing else can check — the stored per-term values must RECOMPUTE to
 * the stored score, or the candidate table shows bars that add up to a
 * different ranking than the one that ran.
 */
describe('admin dispatch inspector (W5)', () => {
  let app: INestApplication;
  let db: TestDatabase;
  let token: string;
  let dispatch: DispatchService;
  let repo: DispatchRepo;

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
    dispatch = app.get(DispatchService);
    repo = app.get(DispatchRepo);
  });

  afterAll(async () => {
    await app.close();
    await closeTestRedis();
  });

  beforeEach(async () => {
    await truncateAll();
    await flushTestRedis();
    await seedDispatchConfig(db);
    const admin = await seedAdmin(db, { subRole: 'operations' });
    token = await adminAuthHeaderFor(app, { adminId: admin.id, subRole: 'operations' });
  });

  async function inspector(bookingId: string): Promise<AdminDispatchInspectorResponse> {
    const res = await request(app.getHttpServer())
      .get(`/v1/admin/ops/dispatch/${bookingId}`)
      .set('Authorization', token)
      .expect(200);
    expectMatchesContract(adminDispatchInspectorResponseSchema, res.body);
    return res.body;
  }

  it('records the wave with per-term candidates that recompute to the score', async () => {
    const zoneId = await seedZone(db);
    const bookingId = await seedSearchingBooking(db, { userId: await seedCustomer(db), zoneId });
    const driverId = await seedOnlineDriver(db, { zoneId, metersAway: 800 });
    // A second driver who cannot take the job — the exclusion list must name
    // them, not just count them, or the inspector's expandable ids are empty.
    const wrongClassId = await seedOnlineDriver(db, { zoneId, vehicleClass: 'wheel_lift' });

    const outcome = await dispatch.runWave(bookingId);
    expect(outcome).toMatchObject({ ran: true, wave: 1, offered: 1 });

    const body = await inspector(bookingId);

    expect(body.waves).toHaveLength(1);
    const wave = body.waves[0]!;
    expect(wave.wave).toBe(1);
    expect(wave.radiusKm).toBe(2);
    expect(wave.considered).toBe(2);
    expect(wave.eligible).toBe(1);
    expect(wave.offered).toBe(1);
    expect(wave.degraded).toBe(false);
    expect(wave.weights).toEqual({ proximity: 60, rating: 15, acceptance: 15, completion: 10 });

    expect(wave.candidates).toHaveLength(1);
    const candidate = wave.candidates[0]!;
    expect(candidate.driverId).toBe(driverId);
    expect(candidate.offered).toBe(true);
    expect(candidate.distanceM).toBeGreaterThan(700);
    expect(candidate.distanceM).toBeLessThan(900);

    // THE property the inspector exists for: the stored terms, weighted by the
    // stored weights, must land on the stored score.
    const weights = wave.weights;
    const recomputed =
      candidate.proximity * weights.proximity +
      candidate.rating * weights.rating +
      candidate.acceptance * weights.acceptance +
      candidate.completion * weights.completion;
    expect(recomputed).toBeCloseTo(candidate.score, 1);

    expect(wave.excluded.wrong_vehicle_class).toEqual({
      count: 1,
      driverIds: [wrongClassId],
    });

    // The attempt log is joined to the driver, not just an id.
    expect(body.attempts).toHaveLength(1);
    expect(body.attempts[0]).toMatchObject({ driverId, wave: 1, outcome: 'offered' });
    expect(body.attempts[0]!.respondedAt).toBeNull();

    // The header: live wave + deadline stamped on the first wave.
    expect(body.liveWave).toBe(1);
    expect(body.deadlineAt).not.toBeNull();
    expect(body.config.offersPerWave).toBe(3);
    expect(body.weights).toEqual(wave.weights);
  });

  it('a failed wave-log insert does not fail the wave', async () => {
    const zoneId = await seedZone(db);
    const bookingId = await seedSearchingBooking(db, { userId: await seedCustomer(db), zoneId });
    await seedOnlineDriver(db, { zoneId });

    const failing = vi
      .spyOn(repo, 'recordWaveLog')
      .mockRejectedValueOnce(new Error('insert exploded'));
    const outcome = await dispatch.runWave(bookingId);
    failing.mockRestore();

    // The wave did its actual job: offers out, position advanced.
    expect(outcome).toMatchObject({ ran: true, wave: 1, offered: 1 });
    const [row] = await db
      .select({ searchWave: bookings.searchWave })
      .from(bookings)
      .where(eq(bookings.id, bookingId));
    expect(row!.searchWave).toBe(1);

    // The gap is honest: the inspector shows no wave rather than a fake one.
    const body = await inspector(bookingId);
    expect(body.waves).toHaveLength(0);
  });

  it('skips the log for empty waves past the last rung', async () => {
    const zoneId = await seedZone(db);
    const bookingId = await seedSearchingBooking(db, { userId: await seedCustomer(db), zoneId });

    // Nobody online: every wave is empty. The default ladder has five rungs,
    // so waves 1–5 log their emptiness (an answer) and wave 6+ does not (the
    // search re-checks every two seconds until its deadline; those rows would
    // bury every wave that could have matched).
    for (let i = 0; i < 6; i += 1) {
      const outcome = await dispatch.runWave(bookingId);
      expect(outcome).toMatchObject({ ran: true, offered: 0 });
    }

    const body = await inspector(bookingId);
    expect(body.waves.map((wave) => wave.wave)).toEqual([1, 2, 3, 4, 5]);
    expect(body.waves.every((wave) => wave.considered === 0 && wave.offered === 0)).toBe(true);
  });

  it('lists live searches with their wave, resolved radius and contacted count', async () => {
    const zoneId = await seedZone(db);
    const bookingId = await seedSearchingBooking(db, { userId: await seedCustomer(db), zoneId });
    await seedOnlineDriver(db, { zoneId });

    // A dormant scheduled booking sits in `searching` and must not appear — it
    // is not a live search, the same rule the dashboard KPI applies.
    await seedSearchingBooking(db, {
      userId: await seedCustomer(db),
      zoneId,
      scheduledAt: new Date(Date.now() + 3_600_000),
    });

    await dispatch.runWave(bookingId);

    const res = await request(app.getHttpServer())
      .get('/v1/admin/ops/dispatch')
      .set('Authorization', token)
      .expect(200);
    expectMatchesContract(adminDispatchInspectorListResponseSchema, res.body);

    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0]).toMatchObject({
      bookingId,
      zoneId,
      wave: 1,
      radiusKm: 2,
      contacted: 1,
    });
  });

  it('404s an unknown booking and applies the ops.dispatch.inspect role matrix', async () => {
    const zoneId = await seedZone(db);
    const bookingId = await seedSearchingBooking(db, { userId: await seedCustomer(db), zoneId });

    const fleet = await seedFleet(db, 'Inspector Fleet');
    const fleetToken = await authHeaderFor(app, {
      userId: fleet.ownerId,
      fleetId: fleet.fleetId,
    });

    const paths = ['/v1/admin/ops/dispatch', `/v1/admin/ops/dispatch/${bookingId}`];
    for (const path of paths) {
      await request(app.getHttpServer()).get(path).expect(401);
      await request(app.getHttpServer()).get(path).set('Authorization', fleetToken).expect(403);
      for (const subRole of ['operations', 'support'] as const) {
        const admin = await seedAdmin(db, { subRole });
        const ok = await adminAuthHeaderFor(app, { adminId: admin.id, subRole });
        await request(app.getHttpServer()).get(path).set('Authorization', ok).expect(200);
      }
      const finance = await seedAdmin(db, { subRole: 'finance' });
      const financeToken = await adminAuthHeaderFor(app, {
        adminId: finance.id,
        subRole: 'finance',
      });
      await request(app.getHttpServer()).get(path).set('Authorization', financeToken).expect(403);
    }

    await request(app.getHttpServer())
      .get('/v1/admin/ops/dispatch/00000000-0000-4000-8000-000000000000')
      .set('Authorization', token)
      .expect(404);
  });
});
