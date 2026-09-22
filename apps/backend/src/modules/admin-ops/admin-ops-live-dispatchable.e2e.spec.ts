import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { adminOpsLiveResponseSchema, type AdminLiveDriver } from '@towing/api-contracts';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../../app.module';
import { drivers, driverZoneRestrictions, fleets, serviceZones } from '../../db/schema';
import { AdminOpsBroadcasterService } from '../../realtime/admin-ops-broadcaster.service';
import { adminAuthHeaderFor } from '../../test/app';
import { expectMatchesContract } from '../../test/contracts';
import {
  seedAdmin,
  seedDriver,
  seedFleet,
  setupTestDatabase,
  truncateAll,
  type TestDatabase,
} from '../../test/db';
import { closeTestRedis, flushTestRedis } from '../../test/redis';

/**
 * W6 (C8) — the live map's `dispatchable` flag (W4's carry-forward).
 *
 * The map draws online + approved drivers; this flag says whether an offer
 * would actually REACH them. The distinction is the whole point of the
 * feature: without it a suspended fleet's drivers sit on the map looking like
 * supply while a customer's search widens — the operator sees markers, the
 * customer sees nothing, and nobody can connect the two.
 */
describe('admin live map dispatchable (W6)', () => {
  let app: INestApplication;
  let db: TestDatabase;
  let opsToken: string;

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
  });

  afterAll(async () => {
    await app.close();
    await closeTestRedis();
  });

  beforeEach(async () => {
    await truncateAll();
    await flushTestRedis();
    const ops = await seedAdmin(db, { subRole: 'operations' });
    opsToken = await adminAuthHeaderFor(app, { adminId: ops.id, subRole: 'operations' });
  });

  async function seedZone(name: string): Promise<string> {
    const [zone] = await db
      .insert(serviceZones)
      .values({
        name,
        area: 'SRID=4326;POLYGON((77.45 12.80,77.80 12.80,77.80 13.15,77.45 13.15,77.45 12.80))',
        surgeBand: 'standard',
      })
      .returning({ id: serviceZones.id });
    return zone!.id;
  }

  async function onlineIn(
    name: string,
    zoneId: string,
    options: { fleetId?: string; shelved?: boolean } = {},
  ): Promise<string> {
    const driverId = await seedDriver(db, {
      name,
      fleetId: options.fleetId,
      kycStatus: 'approved',
    });
    await db
      .update(drivers)
      .set({
        isOnline: true,
        currentZoneId: zoneId,
        lastPingAt: new Date(),
        ...(options.shelved ? { pendingSuspensionAt: new Date() } : {}),
      })
      .where(eq(drivers.id, driverId));
    return driverId;
  }

  async function liveDrivers(): Promise<AdminLiveDriver[]> {
    const res = await request(app.getHttpServer())
      .get('/v1/admin/ops/live')
      .set('Authorization', opsToken)
      .expect(200);
    expectMatchesContract(adminOpsLiveResponseSchema, res.body);
    return res.body.drivers as AdminLiveDriver[];
  }

  it('marks a plain online driver dispatchable', async () => {
    const zoneId = await seedZone('Plain Zone');
    const driverId = await onlineIn('Plain Driver', zoneId);

    const rows = await liveDrivers();
    const row = rows.find((candidate) => candidate.driverId === driverId);
    expect(row).toBeDefined();
    expect(row!.dispatchable).toBe(true);
  });

  it('marks a suspended fleet’s driver as drawn-but-not-dispatchable', async () => {
    const zoneId = await seedZone('Fleet Zone');
    const fleet = await seedFleet(db, 'Suspended Fleet');
    const driverId = await onlineIn('Fleet Driver', zoneId, { fleetId: fleet.fleetId });
    await db.update(fleets).set({ status: 'suspended' }).where(eq(fleets.id, fleet.fleetId));

    const rows = await liveDrivers();
    // STILL DRAWN — that is the W4 rule; only the flag changed.
    const row = rows.find((candidate) => candidate.driverId === driverId);
    expect(row).toBeDefined();
    expect(row!.dispatchable).toBe(false);
  });

  it('marks a shelved suspension as not dispatchable', async () => {
    const zoneId = await seedZone('Shelf Zone');
    const driverId = await onlineIn('Shelved Driver', zoneId, { shelved: true });

    const rows = await liveDrivers();
    expect(rows.find((candidate) => candidate.driverId === driverId)!.dispatchable).toBe(false);
  });

  it('marks a driver restricted from their current zone, but not from others', async () => {
    const zoneId = await seedZone('Restricted Zone');
    const otherZone = await seedZone('Allowed Zone');
    const restrictedHere = await onlineIn('Restricted Here', zoneId);
    const restrictedElsewhere = await onlineIn('Restricted Elsewhere', zoneId);

    await db.insert(driverZoneRestrictions).values({ driverId: restrictedHere, zoneId });
    await db
      .insert(driverZoneRestrictions)
      .values({ driverId: restrictedElsewhere, zoneId: otherZone });

    const rows = await liveDrivers();
    expect(rows.find((candidate) => candidate.driverId === restrictedHere)!.dispatchable).toBe(
      false,
    );
    expect(rows.find((candidate) => candidate.driverId === restrictedElsewhere)!.dispatchable).toBe(
      true,
    );
  });
});
