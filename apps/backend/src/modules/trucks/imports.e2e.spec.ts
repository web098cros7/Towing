import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { fleetTrucks, truckImports } from '../../db/schema';
import { authHeaderFor, createTestApp } from '../../test/app';
import { seedFleet, setupTestDatabase, testDb, truncateAll, type TestDatabase } from '../../test/db';
import { seedTruck } from '../../test/fixtures';
import { TruckImportsService } from './imports.service';

/**
 * Bulk truck CSV import (§9.3.4), end to end.
 *
 * The load-bearing assertion is partial success: a bad row must not take the
 * good ones with it, because an operator uploading 400 trucks with 3 typos
 * needs 397 trucks and a list of 3 fixes — not a rejected file.
 */

const HEADER = 'plate,type,capacityTons';

let app: INestApplication;
let db: TestDatabase;
let fleetId: string;
let auth: string;

function upload(csv: string, filename = 'trucks.csv') {
  return request(app.getHttpServer())
    .post('/v1/fleet/trucks/bulk')
    .set('Authorization', auth)
    .attach('file', Buffer.from(csv, 'utf8'), { filename, contentType: 'text/csv' });
}

async function trucksInFleet(): Promise<string[]> {
  const rows = await db
    .select({ plate: fleetTrucks.plate })
    .from(fleetTrucks)
    .where(eq(fleetTrucks.fleetId, fleetId));
  return rows.map((r) => r.plate).sort();
}

describe('bulk truck import (/v1/fleet/trucks/bulk)', () => {
  beforeAll(async () => {
    await setupTestDatabase();
    db = testDb();
    app = await createTestApp();
  });

  beforeEach(async () => {
    await truncateAll();
    const fleet = await seedFleet(db, `Import ${randomUUID().slice(0, 8)}`);
    fleetId = fleet.fleetId;
    auth = await authHeaderFor(app, { userId: fleet.ownerId, fleetId });
  });

  afterAll(async () => {
    await app.close();
  });

  it('imports a clean file synchronously', async () => {
    const res = await upload(`${HEADER}\nKA-01-AB-1234,flatbed,5\nKA-05-MJ-7788,wheel_lift,3.5`);

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      status: 'completed',
      totalRows: 2,
      importedRows: 2,
      failedRows: 0,
      errors: [],
    });
    expect(await trucksInFleet()).toEqual(['KA-01-AB-1234', 'KA-05-MJ-7788']);
  });

  it('stores the optional make and model columns', async () => {
    const res = await upload(
      `${HEADER},make,model\nKA-01-AB-1234,flatbed,5,Tata,407\nKA-05-MJ-7788,wheel_lift,3.5,,`,
    );
    expect(res.body).toMatchObject({ status: 'completed', importedRows: 2 });

    const rows = await db
      .select({ plate: fleetTrucks.plate, make: fleetTrucks.make, model: fleetTrucks.model })
      .from(fleetTrucks)
      .where(eq(fleetTrucks.fleetId, fleetId))
      .orderBy(fleetTrucks.plate);
    expect(rows).toEqual([
      { plate: 'KA-01-AB-1234', make: 'Tata', model: '407' },
      { plate: 'KA-05-MJ-7788', make: null, model: null },
    ]);
  });

  it('commits the good rows and reports the bad ones', async () => {
    const res = await upload(
      `${HEADER}\nKA-01-AB-1234,flatbed,5\nBAD,flatbed,5\nKA-02-CD-5678,tricycle,4\nKA-03-EF-9012,wheel_lift,2`,
    );

    expect(res.body).toMatchObject({ totalRows: 4, importedRows: 2, failedRows: 2 });
    // Partial success is the point: 2 typos must not cost the other 2 trucks.
    expect(await trucksInFleet()).toEqual(['KA-01-AB-1234', 'KA-03-EF-9012']);
    expect(res.body.errors.map((e: { row: number }) => e.row).sort()).toEqual([2, 3]);
  });

  it('reports a plate that already exists rather than failing the batch', async () => {
    await seedTruck(db, fleetId, { plate: 'KA-01-AB-1234' });

    const res = await upload(`${HEADER}\nKA-01-AB-1234,flatbed,5\nKA-99-XX-0001,flatbed,5`);

    expect(res.body).toMatchObject({ importedRows: 1, failedRows: 1 });
    expect(res.body.errors[0]).toMatchObject({ row: 1, field: 'plate', code: 'duplicate_plate' });
    expect(await trucksInFleet()).toEqual(['KA-01-AB-1234', 'KA-99-XX-0001']);
  });

  it('rejects a file with the wrong header before touching the database', async () => {
    const res = await upload('plate,type\nKA-01-AB-1234,flatbed');

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('validation_failed');
    expect(res.body.error.message).toContain('capacityTons');
    expect(await trucksInFleet()).toEqual([]);
    // A rejected file must not leave an import record implying work happened.
    expect(await db.select().from(truckImports)).toHaveLength(0);
  });

  it('rejects a non-CSV upload', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/fleet/trucks/bulk')
      .set('Authorization', auth)
      .attach('file', Buffer.from('%PDF-1.4'), {
        filename: 'trucks.pdf',
        contentType: 'application/pdf',
      });

    expect(res.status).toBe(422);
  });

  it('queues an import above the sync threshold instead of blocking the request', async () => {
    // BULK_IMPORT_SYNC_MAX_ROWS defaults to 500.
    const rows = Array.from(
      { length: 501 },
      (_, i) => `KA-Q${String(i).padStart(4, '0')},flatbed,5`,
    ).join('\n');

    const res = await upload(`${HEADER}\n${rows}`, 'big.csv');

    expect(res.body).toMatchObject({ status: 'pending', totalRows: 501, importedRows: 0 });
    // Nothing is imported yet — the worker owns it now.
    expect(await trucksInFleet()).toEqual([]);

    // Run what the worker runs.
    await app.get(TruckImportsService)['runQueued'](fleetId as never, res.body.id);

    const after = await request(app.getHttpServer())
      .get(`/v1/fleet/trucks/bulk/${res.body.id}`)
      .set('Authorization', auth)
      .expect(200);

    expect(after.body).toMatchObject({ status: 'completed', importedRows: 501, failedRows: 0 });
    // Payload is cleared once the job is done — a fleet's whole upload history
    // must not sit in the row store.
    const [row] = await db.select().from(truckImports).where(eq(truckImports.id, res.body.id));
    expect(row?.payload).toBeNull();
  });

  it('is idempotent if the queued job is redelivered', async () => {
    const rows = Array.from(
      { length: 501 },
      (_, i) => `KA-R${String(i).padStart(4, '0')},flatbed,5`,
    ).join('\n');
    const res = await upload(`${HEADER}\n${rows}`);

    const service = app.get(TruckImportsService);
    await service['runQueued'](fleetId as never, res.body.id);
    await service['runQueued'](fleetId as never, res.body.id);

    // A redelivered job must not import all 501 rows a second time.
    expect((await trucksInFleet()).length).toBe(501);
  });

  it('serves the error report as CSV', async () => {
    const res = await upload(`${HEADER}\nBAD,flatbed,5`);

    const csv = await request(app.getHttpServer())
      .get(`/v1/fleet/trucks/bulk/${res.body.id}/errors.csv`)
      .set('Authorization', auth)
      .expect(200);

    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.headers['content-disposition']).toContain('attachment');
    expect(csv.text.split('\r\n')[0]).toBe('row,field,code,message');
    expect(csv.text).toContain('validation_failed');
  });

  it('serves a template that its own parser accepts', async () => {
    const res = await request(app.getHttpServer())
      .get('/v1/fleet/trucks/bulk/template.csv')
      .set('Authorization', auth)
      .expect(200);

    // The required columns first, then the optional make and model.
    expect(res.text.split('\r\n')[0]).toBe(`${HEADER},make,model`);
  });

  it('hides another tenant’s import', async () => {
    const res = await upload(`${HEADER}\nKA-01-AB-1234,flatbed,5`);

    const other = await seedFleet(db, `Other ${randomUUID().slice(0, 8)}`);
    const otherAuth = await authHeaderFor(app, {
      userId: other.ownerId,
      fleetId: other.fleetId,
    });

    // Cross-tenant ids are indistinguishable from unknown ones.
    await request(app.getHttpServer())
      .get(`/v1/fleet/trucks/bulk/${res.body.id}`)
      .set('Authorization', otherAuth)
      .expect(404);
  });

  it('lists this fleet’s imports newest first', async () => {
    await upload(`${HEADER}\nKA-01-AB-1234,flatbed,5`, 'first.csv');
    await upload(`${HEADER}\nKA-02-CD-5678,flatbed,5`, 'second.csv');

    const res = await request(app.getHttpServer())
      .get('/v1/fleet/trucks/bulk')
      .set('Authorization', auth)
      .expect(200);

    expect(res.body).toHaveLength(2);
    expect(res.body[0].filename).toBe('second.csv');
  });
});
