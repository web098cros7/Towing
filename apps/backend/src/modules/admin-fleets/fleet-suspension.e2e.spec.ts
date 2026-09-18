import type { INestApplication } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { adminActions, bookings, dispatchAttempts, drivers, fleets, refreshTokens } from '../../db/schema';
import { createTestApp, driverAuthHeaderFor } from '../../test/app';
import {
  seedAdmin,
  seedCustomer,
  seedDriver,
  seedFleet,
  setupTestDatabase,
  truncateAll,
  type TestDatabase,
} from '../../test/db';
import { seedBooking } from '../../test/fixtures';
import { closeTestRedis, flushTestRedis } from '../../test/redis';
import { TokenService } from '../auth/token.service';
import { DispatchService } from '../dispatch/dispatch.service';
import { OfferService } from '../dispatch/offer.service';
import {
  PICKUP,
  putInCandidateStore,
  seedOnlineDriver,
  seedSearchingBooking,
  seedZone,
} from '../dispatch/dispatch-fixtures';
import { FleetSuspensionService } from './fleet-suspension.service';

/**
 * A15 — suspending a fleet stops its drivers earning (18 Sep rules).
 *
 * No HTTP yet (W6 wires the directory routes): the e2e drives the service
 * directly. Sessions and devices are NEVER touched — the go-online block is
 * what holds idle drivers, and mid-job drivers finish with tracking intact.
 */
describe('fleet suspension (A15)', () => {
  let app: INestApplication;
  let db: TestDatabase;
  let suspension: FleetSuspensionService;
  let adminId: string;

  beforeAll(async () => {
    db = await setupTestDatabase();
    app = await createTestApp();
    suspension = app.get(FleetSuspensionService);
  });

  afterAll(async () => {
    await app.close();
    await closeTestRedis();
  });

  beforeEach(async () => {
    await truncateAll();
    await flushTestRedis();

    adminId = (await seedAdmin(db, { subRole: 'super_admin' })).id;
  });

  const fleetStatus = async (fleetId: string): Promise<string> => {
    const [row] = await db.select({ status: fleets.status }).from(fleets).where(eq(fleets.id, fleetId));
    return row!.status;
  };

  const liveSessions = async (driverId: string): Promise<number> => {
    const rows = await db
      .select({ id: refreshTokens.id })
      .from(refreshTokens)
      .where(
        and(
          eq(refreshTokens.subjectId, driverId),
          eq(refreshTokens.realm, 'driver'),
          isNull(refreshTokens.revokedAt),
        ),
      );
    return rows.length;
  };

  const attemptsFor = (bookingId: string) =>
    db.select().from(dispatchAttempts).where(eq(dispatchAttempts.bookingId, bookingId));

  it('suspend flips the status, revokes offers, evicts only the jobless, touches no sessions', async () => {
    const fleet = await seedFleet(db, 'Doomed Fleet');
    const idle = await seedDriver(db, { fleetId: fleet.fleetId, name: 'Idle Driver' });
    await db.update(drivers).set({ isOnline: true }).where(eq(drivers.id, idle));
    const userId = await seedCustomer(db);
    const midJob = await seedDriver(db, { fleetId: fleet.fleetId, name: 'Mid-job Driver' });
    const jobId = await seedBooking(db, { userId, driverId: midJob, status: 'assigned' });
    // Online and tracked, like a driver mid-trip: suspension must leave all
    // of this alone.
    await db.update(drivers).set({ isOnline: true }).where(eq(drivers.id, midJob));
    await app.get(TokenService).issueSession({ subjectId: idle, realm: 'driver' });
    await app.get(TokenService).issueSession({ subjectId: midJob, realm: 'driver' });

    // A live offer to the idle driver, revoked on suspend. A second customer:
    // one user cannot hold two active bookings (§3.8).
    const zoneId = await seedZone(db, { dispatchConfig: { radiusLadderKm: [5], offersPerWave: 2 } });
    const searchingId = await seedSearchingBooking(db, { userId: await seedCustomer(db), zoneId });
    const offered = await seedOnlineDriver(db, { zoneId, fleetId: fleet.fleetId, metersAway: 400 });
    await app.get(DispatchService).runWave(searchingId);
    expect((await attemptsFor(searchingId)).map((a) => a.driverId)).toEqual([offered]);

    const result = await suspension.suspend(adminId, fleet.fleetId);

    expect(result).toMatchObject({ fleetId: fleet.fleetId, status: 'suspended', driverCount: 3 });
    expect(await fleetStatus(fleet.fleetId)).toBe('suspended');

    // Offer revoked through the no-rate-damage path.
    const attempts = await attemptsFor(searchingId);
    expect(attempts).toHaveLength(1);
    expect(attempts[0]!.outcome).toBe('revoked');

    // Jobless driver evicted; mid-job driver untouched — still online, still
    // assigned, sessions live on both (nothing here logs anyone out).
    const [idleRow] = await db.select().from(drivers).where(eq(drivers.id, idle));
    expect(idleRow!.isOnline).toBe(false);
    const [busyRow] = await db.select().from(drivers).where(eq(drivers.id, midJob));
    expect(busyRow!.isOnline).toBe(true);
    expect(await liveSessions(idle)).toBeGreaterThan(0);
    expect(await liveSessions(midJob)).toBeGreaterThan(0);
    const [job] = await db.select().from(bookings).where(eq(bookings.id, jobId));
    expect(job!.status).toBe('assigned');
    expect(job!.driverId).toBe(midJob);

    const [action] = await db
      .select()
      .from(adminActions)
      .where(eq(adminActions.subjectId, fleet.fleetId));
    expect(action!).toMatchObject({ adminId, action: 'fleet.suspend', subjectType: 'fleet' });
  });

  it('an offer issued before suspension is refused at accept', async () => {
    const zoneId = await seedZone(db, { dispatchConfig: { radiusLadderKm: [5], offersPerWave: 2 } });
    const userId = await seedCustomer(db);
    const bookingId = await seedSearchingBooking(db, { userId, zoneId });
    const fleet = await seedFleet(db, 'Slow Fleet');
    const driverId = await seedOnlineDriver(db, { zoneId, fleetId: fleet.fleetId, metersAway: 400 });
    await app.get(DispatchService).runWave(bookingId);
    expect((await attemptsFor(bookingId))[0]!.outcome).toBe('offered');

    // Flip behind the service's back: the offer is still live, so only the
    // accept-time re-check can refuse it.
    await db.update(fleets).set({ status: 'suspended' }).where(eq(fleets.id, fleet.fleetId));

    await expect(app.get(OfferService).accept(bookingId, driverId)).rejects.toMatchObject({
      status: 403,
    });
    // Refused, not consumed: the attempt is still offered, not accepted.
    expect((await attemptsFor(bookingId))[0]!.outcome).toBe('offered');
  });

  it('a suspended fleet\'s drivers get no new offers but others do', async () => {
    const zoneId = await seedZone(db, { dispatchConfig: { radiusLadderKm: [5], offersPerWave: 2 } });
    const userId = await seedCustomer(db);
    const bookingId = await seedSearchingBooking(db, { userId, zoneId });
    const fleet = await seedFleet(db, 'Grounded Fleet');
    const grounded = await seedOnlineDriver(db, { zoneId, fleetId: fleet.fleetId, metersAway: 400 });
    const free = await seedOnlineDriver(db, { zoneId, metersAway: 600 });

    await suspension.suspend(adminId, fleet.fleetId);
    await app.get(DispatchService).runWave(bookingId);

    const attempts = await attemptsFor(bookingId);
    expect(attempts.map((a) => a.driverId)).toEqual([free]);
    expect(grounded).toBeTruthy();
  });

  it('a suspended fleet\'s driver cannot go online', async () => {
    await seedZone(db);
    const fleet = await seedFleet(db, 'Grounded Fleet 2');
    const driverId = await seedDriver(db, { fleetId: fleet.fleetId, kycStatus: 'approved' });
    await suspension.suspend(adminId, fleet.fleetId);

    await request(app.getHttpServer())
      .post('/v1/driver/online')
      .set('Authorization', await driverAuthHeaderFor(app, { driverId }))
      .send({ at: PICKUP })
      .expect(403)
      .expect(({ body }) => {
        expect(body.error.code).toBe('account_not_active');
      });
  });

  it('a mid-job driver of a suspended fleet still has pings accepted', async () => {
    const zoneId = await seedZone(db);
    const userId = await seedCustomer(db);
    const fleet = await seedFleet(db, 'Working Fleet');
    const driverId = await seedOnlineDriver(db, { zoneId, fleetId: fleet.fleetId, metersAway: 400 });
    await seedBooking(db, { userId, driverId, status: 'assigned' });

    await suspension.suspend(adminId, fleet.fleetId);

    const at = new Date().toISOString();
    await request(app.getHttpServer())
      .post('/v1/driver/location')
      .set('Authorization', await driverAuthHeaderFor(app, { driverId }))
      .send({ pings: [{ seq: 2, lat: PICKUP.lat, lng: PICKUP.lng, at }] })
      .expect(200);
  });

  it('reactivate restores eligibility without re-admitting anyone', async () => {
    const zoneId = await seedZone(db, { dispatchConfig: { radiusLadderKm: [5], offersPerWave: 2 } });
    const userId = await seedCustomer(db);
    const fleet = await seedFleet(db, 'Back Fleet');
    const driverId = await seedOnlineDriver(db, { zoneId, fleetId: fleet.fleetId, metersAway: 400 });
    await suspension.suspend(adminId, fleet.fleetId);

    const result = await suspension.reactivate(adminId, fleet.fleetId);

    expect(result).toMatchObject({ status: 'active', driverCount: 0 });
    expect(await fleetStatus(fleet.fleetId)).toBe('active');

    // Eligible again once the driver comes back themselves — reactivation
    // re-admits nobody on its own.
    await db.update(drivers).set({ isOnline: true }).where(eq(drivers.id, driverId));
    await putInCandidateStore(driverId, zoneId, PICKUP.lng);
    const bookingId = await seedSearchingBooking(db, { userId, zoneId });
    await app.get(DispatchService).runWave(bookingId);
    const attempts = await attemptsFor(bookingId);
    expect(attempts.map((a) => a.driverId)).toEqual([driverId]);
  });

  it('re-suspending changes nothing and audits nothing twice', async () => {
    const fleet = await seedFleet(db, 'Already Fleet');
    await suspension.suspend(adminId, fleet.fleetId);

    const again = await suspension.suspend(adminId, fleet.fleetId);

    expect(again.status).toBe('suspended');
    const rows = await db
      .select()
      .from(adminActions)
      .where(eq(adminActions.subjectId, fleet.fleetId));
    expect(rows).toHaveLength(1);
  });
});
