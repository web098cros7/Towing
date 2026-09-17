import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { KillSwitchService } from '../common/killswitch/killswitch.service';
import {
  authHeaderFor,
  createTestApp,
  customerAuthHeaderFor,
  driverAuthHeaderFor,
} from '../test/app';
import {
  seedCustomer,
  seedDriver,
  seedFleet,
  setupTestDatabase,
  truncateAll,
  type TestDatabase,
} from '../test/db';
import { seedBooking } from '../test/fixtures';
import { closeTestRedis, flushTestRedis } from '../test/redis';

/**
 * A10 — the force-polling kill switch is honoured on all three ticket routes.
 *
 * §19.2's emergency switch must refuse new sockets everywhere, or "force
 * polling" leaves two thirds of the clients hammering a gateway that is the
 * thing under strain. Each route keeps its own 503 message; the code is the
 * shared `realtime_unavailable` every client already handles.
 */
describe('ticket routes under force-polling (A10)', () => {
  let app: INestApplication;
  let db: TestDatabase;
  let killSwitch: KillSwitchService;

  let fleetAuth: string;
  let driverAuth: string;
  let customerAuth: string;
  let bookingId: string;

  beforeAll(async () => {
    db = await setupTestDatabase();
    app = await createTestApp();
    killSwitch = app.get(KillSwitchService);
  });

  afterAll(async () => {
    await app.close();
    await closeTestRedis();
  });

  beforeEach(async () => {
    await truncateAll();
    await flushTestRedis();
    await killSwitch.setPollingForced(false);

    const fleet = await seedFleet(db, 'Ticket Fleet');
    fleetAuth = await authHeaderFor(app, { userId: fleet.ownerId, fleetId: fleet.fleetId });

    const driverId = await seedDriver(db, { name: 'Ticket Driver' });
    driverAuth = await driverAuthHeaderFor(app, { driverId });

    const customerId = await seedCustomer(db, 'Ticket Customer');
    customerAuth = await customerAuthHeaderFor(app, { userId: customerId });
    bookingId = await seedBooking(db, { userId: customerId, status: 'searching' });
  });

  const tickets = async () => {
    const [fleet, driver, customer] = await Promise.all([
      request(app.getHttpServer()).post('/v1/fleet/realtime/ticket').set('Authorization', fleetAuth),
      request(app.getHttpServer())
        .post('/v1/driver/realtime/ticket')
        .set('Authorization', driverAuth),
      request(app.getHttpServer())
        .post(`/v1/bookings/${bookingId}/realtime/ticket`)
        .set('Authorization', customerAuth),
    ]);
    return { fleet, driver, customer };
  };

  it('mints all three tickets when polling is not forced', async () => {
    const { fleet, driver, customer } = await tickets();
    expect(fleet.status).toBe(200);
    expect(driver.status).toBe(200);
    expect(customer.status).toBe(200);
  });

  it('refuses all three tickets with realtime_unavailable while forced', async () => {
    await killSwitch.setPollingForced(true);

    const { fleet, driver, customer } = await tickets();
    for (const res of [fleet, driver, customer]) {
      expect(res.status).toBe(503);
      expect(res.body).toMatchObject({ error: { code: 'realtime_unavailable' } });
    }
  });

  it('mints again once the switch is released', async () => {
    await killSwitch.setPollingForced(true);
    await killSwitch.setPollingForced(false);

    const { fleet, driver, customer } = await tickets();
    expect(fleet.status).toBe(200);
    expect(driver.status).toBe(200);
    expect(customer.status).toBe(200);
  });
});
