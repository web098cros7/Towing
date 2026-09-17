import type { INestApplication } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { KillSwitchService } from '../../common/killswitch/killswitch.service';
import { QUEUE, type QueuePort } from '../../common/queue/queue.port';
import { bookings, dispatchAttempts, drivers } from '../../db/schema';
import {
  createTestApp,
  customerAuthHeaderFor,
} from '../../test/app';
import {
  seedCustomer,
  setupTestDatabase,
  testDb,
  truncateAll,
  type TestDatabase,
} from '../../test/db';
import { closeTestRedis, flushTestRedis } from '../../test/redis';
import { PresenceStore } from '../driver-presence/presence-store';
import { DriverGateway } from '../driver-presence/driver.gateway';
import { DispatchConfigRepo } from '../bookings/dispatch-config.repo';
import { DispatchRepo } from './dispatch.repo';
import { DispatchService } from './dispatch.service';
import { OfferService } from './offer.service';
import { seedOnlineDriver, seedSearchingBooking, seedZone } from './dispatch-fixtures';

/**
 * A12 — live offers die with the search, not with the offer timer.
 *
 * A driver holding an offer for a cancelled (or paused) booking must be told
 * immediately, and their acceptance rate must not pay for a job nobody could
 * have accepted. The suite runs with `QUEUE_ENABLED=false`, so `runWave` and
 * `revokeAll` are called directly and the cancel→queue wiring is asserted
 * with a spy — the same split `wave.e2e.spec.ts` uses.
 */
describe('offer revocation (A12)', () => {
  let app: INestApplication;
  let db: TestDatabase;
  let dispatch: DispatchService;
  let offers: OfferService;
  let presence: PresenceStore;
  let killSwitch: KillSwitchService;
  let zoneId: string;
  let userId: string;
  let auth: string;

  beforeAll(async () => {
    await setupTestDatabase();
    db = testDb();
    app = await createTestApp();
    dispatch = app.get(DispatchService);
    offers = app.get(OfferService);
    presence = app.get(PresenceStore);
    killSwitch = app.get(KillSwitchService);
  });

  afterAll(async () => {
    await app.close();
    await closeTestRedis();
  });

  beforeEach(async () => {
    await truncateAll();
    await flushTestRedis();
    await app.get(DispatchConfigRepo).invalidate();
    zoneId = await seedZone(db, { dispatchConfig: { radiusLadderKm: [2], offersPerWave: 2 } });
    userId = await seedCustomer(db);
    auth = await customerAuthHeaderFor(app, { userId });
  });

  const attemptsFor = (bookingId: string) =>
    db.select().from(dispatchAttempts).where(eq(dispatchAttempts.bookingId, bookingId));

  const acceptanceRateOf = async (driverId: string): Promise<string | null> => {
    const [row] = await db
      .select({ rate: drivers.acceptanceRate })
      .from(drivers)
      .where(eq(drivers.id, driverId));
    return row?.rate ?? null;
  };

  const holdOffer = async (): Promise<{ bookingId: string; driverId: string }> => {
    const bookingId = await seedSearchingBooking(db, { userId, zoneId });
    const driverId = await seedOnlineDriver(db, {
      zoneId,
      metersAway: 800,
      acceptanceRate: '80.00',
    });
    await dispatch.runWave(bookingId);
    const attempts = await attemptsFor(bookingId);
    expect(attempts).toHaveLength(1);
    expect(attempts[0]).toMatchObject({ driverId, outcome: 'offered' });
    return { bookingId, driverId };
  };

  it('revokeAll resolves held offers as revoked, releases locks, emits cancelled', async () => {
    const { bookingId, driverId } = await holdOffer();
    const emit = vi.spyOn(app.get(DriverGateway), 'emitJobRevoked').mockImplementation(() => {});

    const revoked = await offers.revokeAll(bookingId, 'cancelled');

    expect(revoked).toEqual([driverId]);
    const attempts = await attemptsFor(bookingId);
    expect(attempts).toHaveLength(1);
    expect(attempts[0]!.outcome).toBe('revoked');
    expect(await presence.lockedDrivers([driverId])).toEqual(new Set());
    expect(emit).toHaveBeenCalledWith(driverId, bookingId, 'cancelled');
    // The point of the task: a timeout for an unwinnable job must not touch this.
    expect(await acceptanceRateOf(driverId)).toBe('80.00');
  });

  it('an expiry still counts against the rate — the revoke asymmetry is deliberate', async () => {
    const { bookingId, driverId } = await holdOffer();

    await offers.expire(bookingId, driverId);

    const attempts = await attemptsFor(bookingId);
    expect(attempts[0]!.outcome).toBe('expired');
    expect(await acceptanceRateOf(driverId)).toBe('0.00');
  });

  it('revokeAll is idempotent — a second pass moves nothing', async () => {
    const { bookingId } = await holdOffer();

    expect(await offers.revokeAll(bookingId, 'cancelled')).toHaveLength(1);
    expect(await offers.revokeAll(bookingId, 'cancelled')).toEqual([]);
  });

  it('customer cancel enqueues a dispatch.revoke job', async () => {
    const bookingId = await seedSearchingBooking(db, { userId, zoneId });
    const enqueue = vi.spyOn(app.get<QueuePort>(QUEUE), 'enqueue');

    // Free tier (fresh search, no coupon): no payment needed.
    await request(app.getHttpServer())
      .post(`/v1/bookings/${bookingId}/cancel`)
      .set('Authorization', auth)
      .send({ reason: 'changed my mind' })
      .expect(200);

    expect(enqueue).toHaveBeenCalledWith(
      'dispatch.revoke',
      { bookingId, reason: 'cancelled' },
      expect.objectContaining({ jobId: `revoke-${bookingId}` }),
    );
    const [row] = await db.select({ status: bookings.status }).from(bookings).where(eq(bookings.id, bookingId));
    expect(row!.status).toBe('cancelled');
  });

  it('a paused wave revokes held offers with reason paused', async () => {
    const bookingId = await seedSearchingBooking(db, { userId, zoneId });
    const driverId = await seedOnlineDriver(db, { zoneId, metersAway: 800, acceptanceRate: '80.00' });
    await dispatch.runWave(bookingId);
    expect((await attemptsFor(bookingId))[0]!.outcome).toBe('offered');

    const emit = vi.spyOn(app.get(DriverGateway), 'emitJobRevoked').mockImplementation(() => {});
    await killSwitch.setPausedZones([zoneId]);

    const outcome = await dispatch.runWave(bookingId);

    expect(outcome).toMatchObject({ ran: false, reason: 'paused' });
    expect((await attemptsFor(bookingId))[0]!.outcome).toBe('revoked');
    expect(emit).toHaveBeenCalledWith(driverId, bookingId, 'paused');
    expect(await presence.lockedDrivers([driverId])).toEqual(new Set());
    expect(await acceptanceRateOf(driverId)).toBe('80.00');
  });
});
