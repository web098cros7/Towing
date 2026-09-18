import type { INestApplication } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { adminActions, dispatchAttempts, drivers, fleets, refreshTokens } from '../../db/schema';
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
import { closeTestRedis, flushTestRedis } from '../../test/redis';
import { TokenService } from '../auth/token.service';
import { DispatchService } from '../dispatch/dispatch.service';
import {
  PICKUP,
  seedOnlineDriver,
  seedSearchingBooking,
  seedZone,
} from '../dispatch/dispatch-fixtures';
import { FleetSuspensionService } from './fleet-suspension.service';

/**
 * A15 — suspending a fleet stops its drivers earning.
 *
 * No HTTP yet (W6 wires the directory routes): the e2e drives the service
 * directly. Read-side blocks (eligibility, go-online) are asserted through
 * the real paths a suspended fleet's drivers would take.
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

  it('suspend flips the status and revokes every driver of the fleet', async () => {
    const fleet = await seedFleet(db, 'Doomed Fleet');
    const driverId = await seedDriver(db, { fleetId: fleet.fleetId, name: 'Fleet Driver' });
    await db.update(drivers).set({ isOnline: true }).where(eq(drivers.id, driverId));
    await app.get(TokenService).issueSession({ subjectId: driverId, realm: 'driver' });
    expect(await liveSessions(driverId)).toBeGreaterThan(0);

    // An independent driver must not be touched.
    const outsider = await seedDriver(db, { name: 'Outsider' });
    await app.get(TokenService).issueSession({ subjectId: outsider, realm: 'driver' });

    const result = await suspension.suspend(adminId, fleet.fleetId);

    expect(result).toMatchObject({ fleetId: fleet.fleetId, status: 'suspended', driversRevoked: 1 });
    expect(await fleetStatus(fleet.fleetId)).toBe('suspended');
    const [row] = await db.select().from(drivers).where(eq(drivers.id, driverId));
    expect(row!.isOnline).toBe(false);
    expect(await liveSessions(driverId)).toBe(0);
    expect(await liveSessions(outsider)).toBeGreaterThan(0);

    const [action] = await db
      .select()
      .from(adminActions)
      .where(eq(adminActions.subjectId, fleet.fleetId));
    expect(action!).toMatchObject({ adminId, action: 'fleet.suspend', subjectType: 'fleet' });
  });

  it('a suspended fleet\'s drivers get no offers but others do', async () => {
    const zoneId = await seedZone(db, { dispatchConfig: { radiusLadderKm: [5], offersPerWave: 2 } });
    const userId = await seedCustomer(db);
    const bookingId = await seedSearchingBooking(db, { userId, zoneId });
    const fleet = await seedFleet(db, 'Grounded Fleet');
    const grounded = await seedOnlineDriver(db, { zoneId, fleetId: fleet.fleetId, metersAway: 400 });
    const free = await seedOnlineDriver(db, { zoneId, metersAway: 600 });

    await suspension.suspend(adminId, fleet.fleetId);
    await app.get(DispatchService).runWave(bookingId);

    const attempts = await db
      .select()
      .from(dispatchAttempts)
      .where(eq(dispatchAttempts.bookingId, bookingId));
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

  it('reactivate restores the fleet without re-admitting anyone', async () => {
    const fleet = await seedFleet(db, 'Back Fleet');
    const driverId = await seedDriver(db, { fleetId: fleet.fleetId });
    await app.get(TokenService).issueSession({ subjectId: driverId, realm: 'driver' });
    await suspension.suspend(adminId, fleet.fleetId);

    const result = await suspension.reactivate(adminId, fleet.fleetId);

    expect(result).toMatchObject({ status: 'active', driversRevoked: 0 });
    expect(await fleetStatus(fleet.fleetId)).toBe('active');
    // Sessions stay revoked — drivers come back explicitly, like driver
    // reactivate returning to `pending` rather than `approved`.
    expect(await liveSessions(driverId)).toBe(0);
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
