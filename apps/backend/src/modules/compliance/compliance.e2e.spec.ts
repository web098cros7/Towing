import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { alerts, complianceDocuments, fleetTrucks } from '../../db/schema';
import { authHeaderFor, createTestApp } from '../../test/app';
import {
  seedFleet,
  setupTestDatabase,
  testDb,
  truncateAll,
  type TestDatabase,
} from '../../test/db';
import { seedTruck } from '../../test/fixtures';
import { ComplianceService } from './compliance.service';

/**
 * The compliance engine (§9.3.4).
 *
 * The assertions that matter are the idempotence ones: this runs hourly
 * forever, so "a second run changes nothing" is the property that keeps the
 * alert feed usable instead of accumulating a duplicate every hour.
 */

const DAY = 86_400_000;

let app: INestApplication;
let db: TestDatabase;
let compliance: ComplianceService;

async function openAlertsFor(fleetId: string) {
  return db
    .select()
    .from(alerts)
    .where(and(eq(alerts.fleetId, fleetId), isNull(alerts.resolvedAt)));
}

async function truckStatus(truckId: string) {
  const [row] = await db
    .select({ status: fleetTrucks.status })
    .from(fleetTrucks)
    .where(eq(fleetTrucks.id, truckId));
  return row?.status;
}

describe('compliance engine', () => {
  beforeAll(async () => {
    await setupTestDatabase();
    db = testDb();
    app = await createTestApp();
    compliance = app.get(ComplianceService);
  });

  beforeEach(async () => {
    await truncateAll();
  });

  afterAll(async () => {
    await app.close();
  });

  it('expires a lapsed document and removes the truck from dispatch', async () => {
    const { fleetId } = await seedFleet(db, `F ${randomUUID().slice(0, 8)}`);
    const truckId = await seedTruck(db, fleetId, { plate: 'KA-CE-0001' });
    await db.insert(complianceDocuments).values({
      truckId,
      docType: 'insurance',
      // Still marked valid — the sweep is what notices, which is the point.
      status: 'valid',
      expiresAt: new Date(Date.now() - DAY),
    });

    const result = await compliance.sweep('manual', fleetId);

    expect(result.expired).toBe(1);
    expect(result.trucksBlocked).toBe(1);
    expect(await truckStatus(truckId)).toBe('non_compliant');

    const open = await openAlertsFor(fleetId);
    expect(open).toHaveLength(1);
    expect(open[0]?.type).toBe('doc_expired');
    expect(open[0]?.severity).toBe('error');
    expect(open[0]?.message).toContain('KA-CE-0001');
    expect(open[0]?.href).toBe(`/trucks?truck=${truckId}`);
  });

  it('points an alert opened before deep links existed at its truck on the next sweep', async () => {
    const { fleetId } = await seedFleet(db, `F ${randomUUID().slice(0, 8)}`);
    const truckId = await seedTruck(db, fleetId, { plate: 'KA-CE-0003' });
    await db.insert(complianceDocuments).values({
      truckId,
      docType: 'insurance',
      status: 'valid',
      expiresAt: new Date(Date.now() - DAY),
    });

    await compliance.sweep('manual', fleetId);

    // What the previous sweep wrote: the bare list link.
    await db.update(alerts).set({ href: '/trucks' }).where(eq(alerts.fleetId, fleetId));

    await compliance.sweep('manual', fleetId);

    const open = await openAlertsFor(fleetId);
    expect(open).toHaveLength(1);
    expect(open[0]?.href).toBe(`/trucks?truck=${truckId}`);
  });
  it('opens a warning inside the 30-day window and counts the days down', async () => {
    const { fleetId } = await seedFleet(db, `F ${randomUUID().slice(0, 8)}`);
    const truckId = await seedTruck(db, fleetId, { plate: 'KA-CE-0002' });
    await db.insert(complianceDocuments).values({
      truckId,
      docType: 'puc',
      status: 'valid',
      expiresAt: new Date(Date.now() + 10 * DAY),
    });

    const result = await compliance.sweep('manual', fleetId);

    expect(result.expiringSoon).toBe(1);
    // Expiring is not expired: the truck stays dispatchable.
    expect(result.trucksBlocked).toBe(0);
    expect(await truckStatus(truckId)).toBe('active');

    const open = await openAlertsFor(fleetId);
    expect(open[0]?.type).toBe('doc_expiring');
    expect(open[0]?.severity).toBe('warning');
    expect(open[0]?.message).toMatch(/expires in 10 days/);
  });

  it('is idempotent — a second run adds nothing', async () => {
    const { fleetId } = await seedFleet(db, `F ${randomUUID().slice(0, 8)}`);
    const truckId = await seedTruck(db, fleetId);
    await db.insert(complianceDocuments).values({
      truckId,
      docType: 'rc',
      status: 'valid',
      expiresAt: new Date(Date.now() - DAY),
    });

    const first = await compliance.sweep('manual', fleetId);
    const second = await compliance.sweep('manual', fleetId);
    const third = await compliance.sweep('manual', fleetId);

    expect(first.alertsOpened).toBe(1);
    // The partial unique index on unresolved rows is what enforces this. Without
    // it the feed would gain a duplicate every hour, forever.
    expect(second.alertsOpened).toBe(0);
    expect(third.alertsOpened).toBe(0);
    expect(second.expired).toBe(0);
    expect(second.trucksBlocked).toBe(0);
    expect(await openAlertsFor(fleetId)).toHaveLength(1);
  });

  it('notifies once per document per window, not once per run', async () => {
    const { fleetId } = await seedFleet(db, `F ${randomUUID().slice(0, 8)}`);
    const truckId = await seedTruck(db, fleetId);
    await db.insert(complianceDocuments).values({
      truckId,
      docType: 'permit',
      status: 'valid',
      expiresAt: new Date(Date.now() + 5 * DAY),
    });

    const first = await compliance.sweep('manual', fleetId);
    const second = await compliance.sweep('manual', fleetId);

    expect(first.notify).toHaveLength(1);
    // An hourly job that emailed every hour would be worse than no alerting.
    expect(second.notify).toHaveLength(0);
  });

  it('upgrades an expiring alert to expired rather than showing both', async () => {
    const { fleetId } = await seedFleet(db, `F ${randomUUID().slice(0, 8)}`);
    const truckId = await seedTruck(db, fleetId);
    const [doc] = await db
      .insert(complianceDocuments)
      .values({
        truckId,
        docType: 'insurance',
        status: 'valid',
        expiresAt: new Date(Date.now() + 2 * DAY),
      })
      .returning({ id: complianceDocuments.id });

    await compliance.sweep('manual', fleetId);
    expect((await openAlertsFor(fleetId)).map((a) => a.type)).toEqual(['doc_expiring']);

    // The document lapses.
    await db
      .update(complianceDocuments)
      .set({ expiresAt: new Date(Date.now() - DAY) })
      .where(eq(complianceDocuments.id, doc!.id));
    await compliance.sweep('manual', fleetId);

    const open = await openAlertsFor(fleetId);
    expect(open.map((a) => a.type)).toEqual(['doc_expired']);
  });

  it('clears the truck and resolves the alert when papers are renewed', async () => {
    const { fleetId } = await seedFleet(db, `F ${randomUUID().slice(0, 8)}`);
    const truckId = await seedTruck(db, fleetId);
    const [doc] = await db
      .insert(complianceDocuments)
      .values({
        truckId,
        docType: 'insurance',
        status: 'valid',
        expiresAt: new Date(Date.now() - DAY),
      })
      .returning({ id: complianceDocuments.id });

    await compliance.sweep('manual', fleetId);
    expect(await truckStatus(truckId)).toBe('non_compliant');

    // Renewed for a year.
    await db
      .update(complianceDocuments)
      .set({ expiresAt: new Date(Date.now() + 365 * DAY) })
      .where(eq(complianceDocuments.id, doc!.id));
    const result = await compliance.sweep('manual', fleetId);

    expect(result.trucksCleared).toBe(1);
    expect(result.alertsResolved).toBe(1);
    // A truck that stayed blocked after its papers were fixed is the failure
    // mode that makes an operator stop trusting the compliance board.
    expect(await truckStatus(truckId)).toBe('active');
    expect(await openAlertsFor(fleetId)).toHaveLength(0);
  });

  it('re-notifies on the next cycle after a renewal', async () => {
    const { fleetId } = await seedFleet(db, `F ${randomUUID().slice(0, 8)}`);
    const truckId = await seedTruck(db, fleetId);
    const [doc] = await db
      .insert(complianceDocuments)
      .values({
        truckId,
        docType: 'puc',
        status: 'valid',
        expiresAt: new Date(Date.now() + 5 * DAY),
      })
      .returning({ id: complianceDocuments.id });

    expect((await compliance.sweep('manual', fleetId)).notify).toHaveLength(1);

    await db
      .update(complianceDocuments)
      .set({ expiresAt: new Date(Date.now() + 365 * DAY) })
      .where(eq(complianceDocuments.id, doc!.id));
    await compliance.sweep('manual', fleetId);

    // Next year's expiry must alert again — the flag resets once valid.
    await db
      .update(complianceDocuments)
      .set({ expiresAt: new Date(Date.now() + 3 * DAY) })
      .where(eq(complianceDocuments.id, doc!.id));
    expect((await compliance.sweep('manual', fleetId)).notify).toHaveLength(1);
  });

  it('leaves a manually inactive truck inactive', async () => {
    const { fleetId } = await seedFleet(db, `F ${randomUUID().slice(0, 8)}`);
    const truckId = await seedTruck(db, fleetId, { status: 'inactive' });
    await db.insert(complianceDocuments).values({
      truckId,
      docType: 'insurance',
      status: 'valid',
      expiresAt: new Date(Date.now() - DAY),
    });

    await compliance.sweep('manual', fleetId);

    // Recompute only ever moves active ↔ non_compliant; a truck an operator
    // parked stays parked (same rule as the Phase 4 upsert path).
    expect(await truckStatus(truckId)).toBe('inactive');
  });

  it('never touches another tenant', async () => {
    const a = await seedFleet(db, `A ${randomUUID().slice(0, 8)}`);
    const b = await seedFleet(db, `B ${randomUUID().slice(0, 8)}`);
    const truckB = await seedTruck(db, b.fleetId);
    await db.insert(complianceDocuments).values({
      truckId: truckB,
      docType: 'insurance',
      status: 'valid',
      expiresAt: new Date(Date.now() - DAY),
    });

    const result = await compliance.sweep('manual', a.fleetId);

    expect(result.expired).toBe(0);
    expect(await truckStatus(truckB)).toBe('active');
    expect(await openAlertsFor(b.fleetId)).toHaveLength(0);
  });

  describe('GET /v1/fleet/alerts', () => {
    it('lists open alerts and hides another tenant’s', async () => {
      const a = await seedFleet(db, `A ${randomUUID().slice(0, 8)}`);
      const b = await seedFleet(db, `B ${randomUUID().slice(0, 8)}`);
      for (const [fleetId, plate] of [
        [a.fleetId, 'KA-AA-0001'],
        [b.fleetId, 'KA-BB-0001'],
      ] as const) {
        const truckId = await seedTruck(db, fleetId, { plate });
        await db.insert(complianceDocuments).values({
          truckId,
          docType: 'insurance',
          status: 'valid',
          expiresAt: new Date(Date.now() - DAY),
        });
      }
      await compliance.sweep('manual');

      const auth = await authHeaderFor(app, { userId: a.ownerId, fleetId: a.fleetId });
      const res = await request(app.getHttpServer())
        .get('/v1/fleet/alerts')
        .set('Authorization', auth)
        .expect(200);

      expect(res.body.items).toHaveLength(1);
      expect(res.body.items[0].message).toContain('KA-AA-0001');
      expect(res.body.nextCursor).toBeNull();
    });

    it('excludes resolved alerts unless asked', async () => {
      const { fleetId, ownerId } = await seedFleet(db, `F ${randomUUID().slice(0, 8)}`);
      const truckId = await seedTruck(db, fleetId);
      const [doc] = await db
        .insert(complianceDocuments)
        .values({
          truckId,
          docType: 'rc',
          status: 'valid',
          expiresAt: new Date(Date.now() - DAY),
        })
        .returning({ id: complianceDocuments.id });
      await compliance.sweep('manual', fleetId);

      await db
        .update(complianceDocuments)
        .set({ expiresAt: new Date(Date.now() + 365 * DAY) })
        .where(eq(complianceDocuments.id, doc!.id));
      await compliance.sweep('manual', fleetId);

      const auth = await authHeaderFor(app, { userId: ownerId, fleetId });
      const open = await request(app.getHttpServer())
        .get('/v1/fleet/alerts')
        .set('Authorization', auth)
        .expect(200);
      expect(open.body.items).toHaveLength(0);

      const all = await request(app.getHttpServer())
        .get('/v1/fleet/alerts?includeResolved=true')
        .set('Authorization', auth)
        .expect(200);
      expect(all.body.items).toHaveLength(1);
      expect(all.body.items[0].resolvedAt).not.toBeNull();
    });

    it('paginates by keyset', async () => {
      const { fleetId, ownerId } = await seedFleet(db, `F ${randomUUID().slice(0, 8)}`);
      for (let i = 0; i < 5; i += 1) {
        const truckId = await seedTruck(db, fleetId, { plate: `KA-PG-000${i}` });
        await db.insert(complianceDocuments).values({
          truckId,
          docType: 'insurance',
          status: 'valid',
          expiresAt: new Date(Date.now() - DAY),
        });
      }
      await compliance.sweep('manual', fleetId);

      const auth = await authHeaderFor(app, { userId: ownerId, fleetId });
      const page1 = await request(app.getHttpServer())
        .get('/v1/fleet/alerts?limit=2')
        .set('Authorization', auth)
        .expect(200);
      expect(page1.body.items).toHaveLength(2);
      expect(page1.body.nextCursor).not.toBeNull();

      const page2 = await request(app.getHttpServer())
        .get(`/v1/fleet/alerts?limit=2&cursor=${encodeURIComponent(page1.body.nextCursor)}`)
        .set('Authorization', auth)
        .expect(200);
      expect(page2.body.items).toHaveLength(2);
      // No overlap — the cursor is (created_at, id), so ties cannot repeat a row.
      const ids = new Set([...page1.body.items, ...page2.body.items].map((a: { id: string }) => a.id));
      expect(ids.size).toBe(4);
    });

    it('rechecks on demand so a renewal does not wait an hour', async () => {
      const { fleetId, ownerId } = await seedFleet(db, `F ${randomUUID().slice(0, 8)}`);
      const truckId = await seedTruck(db, fleetId);
      await db.insert(complianceDocuments).values({
        truckId,
        docType: 'insurance',
        status: 'valid',
        expiresAt: new Date(Date.now() - DAY),
      });

      const auth = await authHeaderFor(app, { userId: ownerId, fleetId });
      const res = await request(app.getHttpServer())
        .post('/v1/fleet/alerts/recheck')
        .set('Authorization', auth)
        .expect(200);

      expect(res.body).toMatchObject({ expired: 1, trucksBlocked: 1, alertsOpened: 1 });
      expect(await truckStatus(truckId)).toBe('non_compliant');
    });
  });
});
