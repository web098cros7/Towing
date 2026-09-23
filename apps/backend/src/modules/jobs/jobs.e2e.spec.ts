import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { authHeaderFor, createTestApp } from '../../test/app';
import {
  seedCustomer,
  seedDriver,
  seedFleet,
  setupTestDatabase,
  testSql,
  truncateAll,
  type TestDatabase,
} from '../../test/db';
import { jobDetailSchema } from '@towing/api-contracts';
import { sql } from 'drizzle-orm';
import { expectMatchesContract } from '../../test/contracts';
import { seedBooking, seedWalletWithLedger } from '../../test/fixtures';

describe('jobs e2e (/v1/fleet/jobs)', () => {
  let app: INestApplication;
  let db: TestDatabase;
  let authA: string;
  let authB: string;
  let fleetA: string;
  let fleetB: string;
  let customerId: string;

  beforeAll(async () => {
    db = await setupTestDatabase();
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await truncateAll();
    const a = await seedFleet(db, 'Fleet A');
    const b = await seedFleet(db, 'Fleet B');
    fleetA = a.fleetId;
    fleetB = b.fleetId;
    authA = await authHeaderFor(app, { userId: a.ownerId, fleetId: a.fleetId });
    authB = await authHeaderFor(app, { userId: b.ownerId, fleetId: b.fleetId });
    customerId = await seedCustomer(db);
  });

  async function seedFeed(): Promise<void> {
    for (let i = 0; i < 25; i += 1) {
      await seedBooking(db, {
        userId: customerId,
        fleetId: fleetA,
        status: i % 5 === 0 ? 'cancelled' : 'paid',
        createdAt: new Date(Date.now() - i * 60_000),
        total: '1000.00',
        commissionAmount: '100.00',
        driverPayout: '900.00',
      });
    }
    for (let i = 0; i < 5; i += 1) {
      await seedBooking(db, {
        userId: customerId,
        fleetId: fleetB,
        createdAt: new Date(Date.now() - i * 60_000),
      });
    }
  }

  it('pages the feed with a stable cursor, newest first, no overlap or gaps', async () => {
    await seedFeed();
    const server = app.getHttpServer();
    const seen = new Set<string>();
    let cursor: string | null = null;
    const pages: number[] = [];

    for (;;) {
      const url: string = `/v1/fleet/jobs?limit=10${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
      const res = await request(server).get(url).set('Authorization', authA).expect(200);
      const items = res.body.items as Array<{ id: string; createdAt: string }>;
      pages.push(items.length);

      // Strictly descending createdAt, no duplicates across pages.
      for (let i = 1; i < items.length; i += 1) {
        expect(items[i]!.createdAt <= items[i - 1]!.createdAt).toBe(true);
      }
      for (const item of items) {
        expect(seen.has(item.id)).toBe(false);
        seen.add(item.id);
      }

      cursor = res.body.nextCursor as string | null;
      if (!cursor) break;
    }

    expect(pages).toEqual([10, 10, 5]);
    expect(seen.size).toBe(25);
  });

  it('filters by status and by date window', async () => {
    await seedFeed();
    await seedBooking(db, {
      userId: customerId,
      fleetId: fleetA,
      status: 'paid',
      createdAt: new Date(Date.now() - 10 * 86_400_000),
    });

    const cancelled = await request(app.getHttpServer())
      .get('/v1/fleet/jobs?status=cancelled&limit=50')
      .set('Authorization', authA)
      .expect(200);
    expect(cancelled.body.items).toHaveLength(5);
    expect(
      cancelled.body.items.every((j: { status: string }) => j.status === 'cancelled'),
    ).toBe(true);

    const today = new Date().toISOString().slice(0, 10);
    const todayOnly = await request(app.getHttpServer())
      .get(`/v1/fleet/jobs?from=${today}&limit=50`)
      .set('Authorization', authA)
      .expect(200);
    // The 10-day-old booking is excluded; the 25 recent ones remain.
    expect(todayOnly.body.items).toHaveLength(25);
  });

  it('rejects a malformed cursor with a validation envelope', async () => {
    const res = await request(app.getHttpServer())
      .get('/v1/fleet/jobs?cursor=not-a-cursor')
      .set('Authorization', authA)
      .expect(422);
    expect(res.body.error.code).toBe('validation_failed');
  });

  it('never mixes tenants across any page', async () => {
    await seedFeed();
    const resB = await request(app.getHttpServer())
      .get('/v1/fleet/jobs?limit=50')
      .set('Authorization', authB)
      .expect(200);
    expect(resB.body.items).toHaveLength(5);
  });

  it('streams CSV honoring filters, with quoting and formula-injection defused', async () => {
    await seedBooking(db, {
      userId: customerId,
      fleetId: fleetA,
      status: 'paid',
      pickupAddress: 'Indiranagar, 12th Main',
      total: '1500.00',
    });
    await seedBooking(db, {
      userId: customerId,
      fleetId: fleetA,
      status: 'paid',
      pickupAddress: '=HYPERLINK("http://evil")',
    });
    await seedBooking(db, { userId: customerId, fleetId: fleetA, status: 'cancelled' });

    const res = await request(app.getHttpServer())
      .get('/v1/fleet/jobs/export.csv?status=paid')
      .set('Authorization', authA)
      .expect(200);

    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toContain('attachment');

    const lines = (res.text as string).trim().split('\n');
    // Header + the two paid rows; the cancelled one is filtered out.
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain('code,created_at');
    const body = lines.slice(1).join('\n');
    expect(body).toContain('"Indiranagar, 12th Main"');
    expect(body).toContain(`'=HYPERLINK`);
  });

  it('the feed query is served by idx_bookings_fleet_feed without a sort', async () => {
    await seedFeed();
    const sql = testSql();

    // Tiny tables tempt the planner into seq scans; SET LOCAL (scoped to the
    // transaction, pinned to one connection) asks the question that matters at
    // scale: CAN the index serve this shape without a sort?
    const rows = await sql.begin(async (tx) => {
      // At 25 rows the planner happily sorts off the narrower fleet_id index;
      // pricing sorts out of contention reveals whether a sortless plan exists.
      await tx.unsafe('set local enable_seqscan = off');
      await tx.unsafe('set local enable_sort = off');
      return tx.unsafe(
        `explain (format json)
         select * from bookings
         where fleet_id = '${fleetA}'
           and (created_at, id) < (now(), gen_random_uuid())
         order by created_at desc nulls last, id desc nulls last
         limit 10`,
      );
    });

    const planText = JSON.stringify(rows);
    expect(planText).toContain('idx_bookings_fleet_feed');
    expect(planText).not.toContain('"Sort Key"');
  });

  describe('GET /v1/fleet/jobs/:id (ADM-23)', () => {
    /** A settled job: 1000 paid, 100 commission, 900 pool split 270 fleet / 630 driver. */
    async function settledJob(
      options: { refundedRupees?: string } = {},
    ): Promise<{ bookingId: string; driverId: string }> {
      const driverId = await seedDriver(db, { fleetId: fleetA, name: 'Arjun' });
      const bookingId = await seedBooking(db, {
        userId: customerId,
        fleetId: fleetA,
        driverId,
        status: 'paid',
        total: '1000.00',
        commissionAmount: '100.00',
        driverPayout: '900.00',
      });
      await seedWalletWithLedger(db, { ownerType: 'fleet', ownerId: fleetA }, [
        { type: 'fleet_share_credit', amount: '270.00', refId: bookingId },
      ]);
      await seedWalletWithLedger(db, { ownerType: 'driver', ownerId: driverId }, [
        { type: 'driver_share_credit', amount: '630.00', refId: bookingId },
        ...(options.refundedRupees
          ? [{ type: 'refund_debit' as const, amount: `-${options.refundedRupees}`, refId: bookingId }]
          : []),
      ]);
      await db.execute(sql`
        insert into booking_status_history (booking_id, status, actor, created_at)
        values (${bookingId}::uuid, 'assigned', 'system', now() - interval '40 minutes'),
               (${bookingId}::uuid, 'in_progress', 'driver', now() - interval '20 minutes'),
               (${bookingId}::uuid, 'paid', 'admin', now())
      `);
      return { bookingId, driverId };
    }

    it('answers "why did I earn this on that job" from the ledger', async () => {
      const { bookingId } = await settledJob();

      const res = await request(app.getHttpServer())
        .get(`/v1/fleet/jobs/${bookingId}`)
        .set('Authorization', authA)
        .expect(200);

      const job = expectMatchesContract(jobDetailSchema, res.body);
      expect(job.fare.totalPaise).toBe(100_000);
      expect(job.split).toEqual({
        settled: true,
        commissionPaise: 10_000,
        fleetSharePaise: 27_000,
        driverSharePaise: 63_000,
        refundedPaise: 0,
      });
      expect(job.driverName).toBe('Arjun');
      // The timeline in order, and an admin's step shows as MiTow, not a person.
      expect(job.timeline.map((entry) => `${entry.status}:${entry.actor}`)).toEqual([
        'assigned:system',
        'in_progress:driver',
        'paid:mitow',
      ]);
    });

    it('shows what a refund took back from the fleet side', async () => {
      const { bookingId } = await settledJob({ refundedRupees: '126.00' });

      const res = await request(app.getHttpServer())
        .get(`/v1/fleet/jobs/${bookingId}`)
        .set('Authorization', authA)
        .expect(200);
      expect(res.body.split.refundedPaise).toBe(12_600);
    });

    it("404s another fleet's job, exactly like a job that does not exist", async () => {
      const { bookingId } = await settledJob();

      const theirs = await request(app.getHttpServer())
        .get(`/v1/fleet/jobs/${bookingId}`)
        .set('Authorization', authB)
        .expect(404);
      const nobody = await request(app.getHttpServer())
        .get('/v1/fleet/jobs/00000000-0000-4000-8000-000000000000')
        .set('Authorization', authB)
        .expect(404);
      // Same body: the answer must not confirm the id exists elsewhere.
      expect(theirs.body.error.message).toBe(nobody.body.error.message);
    });

    it('still serves the CSV export at its literal path', async () => {
      await request(app.getHttpServer())
        .get('/v1/fleet/jobs/export.csv')
        .set('Authorization', authA)
        .expect(200);
    });
  });
});
