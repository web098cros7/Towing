import type { INestApplication } from '@nestjs/common';
import {
  analyticsBandDaySchema,
  analyticsDaySchema,
  analyticsGeoResponseSchema,
  analyticsRevenueResponseSchema,
  analyticsSummaryResponseSchema,
} from '@towing/api-contracts';
import { desc, sql } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { adminActions } from '../../db/schema';
import { adminAuthHeaderFor, createTestApp } from '../../test/app';
import { expectMatchesContract } from '../../test/contracts';
import {
  seedAdmin,
  seedCustomer,
  seedDriver,
  setupTestDatabase,
  truncateAll,
  type TestDatabase,
} from '../../test/db';
import { seedBooking } from '../../test/fixtures';
import { closeTestRedis, flushTestRedis } from '../../test/redis';
import { BookingStateMachineService } from '../bookings/booking-state-machine.service';
import { PaymentsService } from '../money/payments.service';
import { purgeWaveLogs, writeDay } from './analytics-rollup';

/**
 * W17 — analytics (§9.4.13, §22.2) and the §22.1 tracker (19vi), backend.
 *
 * The phase's verification, quoted: "the rollup is idempotent (run twice,
 * identical rows); rollup figures match a live query for a seeded day; the CSV
 * export has no PII columns." Each has a test below, with the day built by
 * hand rather than by driving the whole booking lifecycle: the rollup reads
 * domain tables, so the honest fixture is rows in those tables.
 *
 * `DAY` is a FIXED PAST DATE. "Today" would make the live-merge change the
 * expectations as the clock ticks; a fixed IST day is the same computation
 * with none of the motion. 2026-09-10 is arbitrary and safely in the past.
 */

const DAY = '2026-09-10';
const IST = '+05:30';
/** ISO instant of an IST wall-clock time on `DAY` — raw SQL takes strings, not Dates. */
const iso = (time: string): string => new Date(`${DAY}T${time}:00${IST}`).toISOString();

describe('analytics rollups (/v1/admin/analytics, W17)', () => {
  let app: INestApplication;
  let db: TestDatabase;
  let opsAuth: string;
  let opsId: string;
  let supportAuth: string;
  let financeAuth: string;
  let customerId: string;
  let driverId: string;

  beforeAll(async () => {
    db = await setupTestDatabase();
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
    await closeTestRedis();
  });

  beforeEach(async () => {
    await truncateAll();
    await flushTestRedis();

    customerId = await seedCustomer(db, 'Analytics Customer');
    driverId = await seedDriver(db, { name: 'Analytics Driver' });

    opsId = (await seedAdmin(db, { subRole: 'operations' })).id;
    opsAuth = await adminAuthHeaderFor(app, { adminId: opsId, subRole: 'operations' });
    supportAuth = await adminAuthHeaderFor(app, {
      adminId: (await seedAdmin(db, { subRole: 'support' })).id,
      subRole: 'support',
    });
    financeAuth = await adminAuthHeaderFor(app, {
      adminId: (await seedAdmin(db, { subRole: 'finance' })).id,
      subRole: 'finance',
    });
  });

  /** One settled booking, one accepted offer, one processed refund, one acked SOS — the whole day. */
  const seedDay = async (): Promise<string> => {
    const bookingId = await seedBooking(db, {
      userId: customerId,
      driverId,
      status: 'paid',
      total: '2400.00',
      commissionBand: 'A',
      commissionPct: '10.00',
      commissionAmount: '240.00',
      driverPayout: '1500.00',
      createdAt: new Date(iso('10:00')),
    });

    await db.execute(sql`
      update bookings
         set completed_at = ${iso('11:00')}::timestamptz, paid_at = ${iso('12:00')}::timestamptz
       where id = ${bookingId}::uuid
    `);

    await db.execute(sql`
      insert into dispatch_attempts (booking_id, wave, radius_km, driver_id, outcome, offered_at, responded_at)
      values (${bookingId}::uuid, 1, 5, ${driverId}::uuid, 'accepted',
              ${iso('10:00')}::timestamptz, ${iso('10:05')}::timestamptz)
    `);

    await db.execute(sql`
      insert into refunds (booking_id, amount, status, idempotency_key, initiated_by, processed_at)
      values (${bookingId}::uuid, '500.00', 'processed', 'analytics:refund:1', 'system',
              ${iso('13:00')}::timestamptz)
    `);

    await db.execute(sql`
      insert into sos_alerts (subject_type, subject_id, lat, lng, accuracy_m, source, status, acknowledged_at, acknowledged_by, created_at)
      values ('user', ${customerId}::uuid, 12.97, 77.59, 9, 'app', 'acknowledged',
              ${iso('14:30')}::timestamptz, ${opsId}::uuid, ${iso('14:00')}::timestamptz)
    `);

    return bookingId;
  };

  it('computes a day from the domain tables and matches an independent live query', async () => {
    await seedDay();
    await writeDay(db, DAY);

    const [row] = (await db.execute(sql`
      select day::text as day, *, gmv_paise::float8 as gmv, commission_paise::float8 as commission
        from analytics_daily where day = ${DAY}::date
    `)) as unknown as Array<Record<string, unknown>>;

    expect(row).toMatchObject({
      bookings_created: 1,
      bookings_matched: 1,
      bookings_completed: 1,
      bookings_paid: 1,
      bookings_cancelled: 0,
      no_drivers_found: 0,
      gmv_paise: '240000',
      commission_paise: '24000',
      refunds_paise: '50000',
      aov_paise: '240000',
      take_rate_bps: 1000,
      fill_rate_bps: 10_000,
      ttm_p50_s: 300,
      ttm_p90_s: 300,
      on_time_bps: null,
      active_drivers: 1,
      sos_alerts: 1,
      // Created 14:00, acknowledged 14:30 — thirty MINUTES, in seconds (the column's unit) — and the assumption-worthiness is the point.
      sos_ack_p95_s: 1800,
    });
    // The aliases below cast the STORED paise columns; `gmv`/`commission` are
    // the rupee-unit domain sums only in the cross-check further down.
    expect(Math.round(Number(row!.gmv))).toBe(240_000);
    expect(Math.round(Number(row!.commission))).toBe(24_000);
    expect(row!.tax_paise).toBe('0');
    expect(row!.refunds_paise).toBe('50000');

    // Cross-check the headline numbers against a direct query — the point is
    // that the rollup is not trusted, it is CHECKED.
    const [live] = (await db.execute(sql`
      select count(*)::int as created from bookings
       where created_at >= (${DAY}::date::timestamp at time zone 'Asia/Kolkata')
         and created_at < ((${DAY}::date + 1)::timestamp at time zone 'Asia/Kolkata')
    `)) as unknown as [{ created: number }];
    expect(live.created).toBe(Number(row!.bookings_created));

    const [livePaid] = (await db.execute(sql`
      select coalesce(sum(total), 0)::float8 as gmv from bookings
       where paid_at >= (${DAY}::date::timestamp at time zone 'Asia/Kolkata')
         and paid_at < ((${DAY}::date + 1)::timestamp at time zone 'Asia/Kolkata')
    `)) as unknown as [{ gmv: number }];
    // Domain tables are RUPEES; the rollup converts to paise.
    expect(Math.round(livePaid.gmv * 100)).toBe(240_000);
  });

  it('is idempotent — running twice leaves identical rows in all four tables', async () => {
    await seedDay();
    await writeDay(db, DAY);

    const snapshot = async (): Promise<unknown> => ({
      daily: (await db.execute(
        sql`select * from analytics_daily where day = ${DAY}::date`,
      )) as unknown,
      zones: (await db.execute(
        sql`select * from analytics_zone_daily where day = ${DAY}::date order by zone_id`,
      )) as unknown,
      bands: (await db.execute(
        sql`select * from analytics_band_daily where day = ${DAY}::date order by band`,
      )) as unknown,
      grid: (await db.execute(
        sql`select * from analytics_demand_grid where day = ${DAY}::date order by hour, cell_lat, cell_lng`,
      )) as unknown,
    });

    const first = await snapshot();
    await writeDay(db, DAY);
    const second = await snapshot();

    // `updated_at` is the one column that legitimately differs; strip it.
    expect(stripUpdatedAt(second)).toEqual(stripUpdatedAt(first));
  });

  it('purges only wave logs older than 30 days', async () => {
    const bookingId = await seedBooking(db, { userId: customerId, status: 'paid' });

    const insertLog = (ranAt: Date) =>
      db.execute(sql`
        insert into dispatch_wave_logs
          (booking_id, wave, radius_km, considered, eligible, offered, weights, config, excluded, candidates, ran_at, duration_ms)
        values (${bookingId}::uuid, 1, 5.00, 0, 0, 0, '{}'::jsonb, '{}'::jsonb, '[]'::jsonb, '[]'::jsonb, ${ranAt.toISOString()}::timestamptz, 12)
      `);

    await insertLog(new Date(Date.now() - 31 * 86_400_000));
    await insertLog(new Date(Date.now() - 86_400_000));

    const purged = await purgeWaveLogs(db);
    expect(purged).toBe(1);

    const [remaining] = (await db.execute(sql`
      select count(*)::int as count from dispatch_wave_logs
    `)) as unknown as [{ count: number }];
    expect(remaining.count).toBe(1);
  });

  describe('the §22.1 tracker', () => {
    const events = async (): Promise<Array<{ name: string; props: Record<string, unknown> }>> =>
      (await db.execute(sql`
        select name, props from analytics_events order by created_at asc
      `)) as unknown as Array<{ name: string; props: Record<string, unknown> }>;

    it('records completion and cancellation at the state-machine choke point', async () => {
      const machine = app.get(BookingStateMachineService);

      const running = await seedBooking(db, { userId: customerId, status: 'in_progress' });
      await db.transaction((tx) =>
        machine.transition(tx, { bookingId: running, to: 'completed', actor: 'driver' }),
      );

      const searching = await seedBooking(db, { userId: customerId, status: 'searching' });
      await db.transaction((tx) =>
        machine.transition(tx, { bookingId: searching, to: 'cancelled', actor: 'customer' }),
      );

      const rows = await events();
      expect(rows.map((row) => row.name)).toEqual(['booking_completed', 'booking_cancelled']);
      expect(rows[0]!.props).toMatchObject({ from: 'in_progress' });
      expect(rows[1]!.props).toMatchObject({ from: 'searching' });
    });

    it('records payment_success only when the payment completes the booking', async () => {
      const machine = app.get(BookingStateMachineService);

      const bookingId = await seedBooking(db, { userId: customerId, status: 'completed' });
      await db.transaction((tx) =>
        machine.transition(tx, { bookingId, to: 'paid', actor: 'system' }),
      );

      const rows = await events();
      expect(rows.map((row) => row.name)).toEqual(['payment_success']);
      expect(rows[0]!.props).toMatchObject({ from: 'completed' });
    });

    it('records payment_failure from the single failed-payment writer', async () => {
      const bookingId = await seedBooking(db, { userId: customerId, status: 'completed' });

      const [payment] = (await db.execute(sql`
        insert into payments (booking_id, amount, method, status, purpose, idempotency_key, provider)
        values (${bookingId}::uuid, '2400.00', 'upi', 'pending', 'booking', 'analytics:payment:1', 'test')
        returning id
      `)) as unknown as [{ id: string }];

      await app.get(PaymentsService).markFailed(payment!.id, 'gateway_declined');

      const rows = await events();
      expect(rows.map((row) => row.name)).toEqual(['payment_failure']);
      expect(rows[0]!.props).toMatchObject({ reason: 'gateway_declined' });
    });

    it('a rolled-back transition leaves no event behind', async () => {
      const machine = app.get(BookingStateMachineService);
      const bookingId = await seedBooking(db, { userId: customerId, status: 'searching' });

      await expect(
        db.transaction(async (tx) => {
          await machine.transition(tx, { bookingId, to: 'cancelled', actor: 'customer' });
          throw new Error('rollback on purpose');
        }),
      ).rejects.toThrow('rollback on purpose');

      const [count] = (await db.execute(sql`
        select count(*)::int as count from analytics_events
      `)) as unknown as [{ count: number }];
      expect(count.count).toBe(0);

      const [status] = (await db.execute(sql`
        select status from bookings where id = ${bookingId}::uuid
      `)) as unknown as [{ status: string }];
      expect(status.status).toBe('searching');
    });
  });

  describe('the API', () => {
    it('serves the overview envelopes and is a role matrix', async () => {
      await seedDay();
      await writeDay(db, DAY);

      for (const auth of [opsAuth, supportAuth, financeAuth]) {
        const res = await request(app.getHttpServer())
          .get('/v1/admin/analytics/summary')
          .set('Authorization', auth)
          .expect(200);
        expectMatchesContract(analyticsSummaryResponseSchema, res.body);
        expect(res.body.days.length).toBeGreaterThan(0);
        // Today is merged live; the day is always present in the default range.
        for (const day of res.body.days) expectMatchesContract(analyticsDaySchema, day);
      }

      const revenue = await request(app.getHttpServer())
        .get(`/v1/admin/analytics/revenue?from=${DAY}&to=${DAY}`)
        .set('Authorization', opsAuth)
        .expect(200);
      expectMatchesContract(analyticsRevenueResponseSchema, revenue.body);
      expect(revenue.body.bands).toHaveLength(1);
      expectMatchesContract(analyticsBandDaySchema, revenue.body.bands[0]);

      const geo = await request(app.getHttpServer())
        .get(`/v1/admin/analytics/geo?from=${DAY}&to=${DAY}`)
        .set('Authorization', opsAuth)
        .expect(200);
      expectMatchesContract(analyticsGeoResponseSchema, geo.body);
      // Non-vacuous: the seeded booking has pickup coordinates and created that day.
      expect(geo.body.grid.length).toBeGreaterThan(0);

      await request(app.getHttpServer()).get('/v1/admin/analytics/summary').expect(401);
    });

    it('rejects a backwards range', async () => {
      await request(app.getHttpServer())
        .get(`/v1/admin/analytics/summary?from=${DAY}&to=2026-09-01`)
        .set('Authorization', opsAuth)
        .expect(422);
    });

    it('queues a manual rollup and audits it', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/admin/analytics/rollup')
        .set('Authorization', opsAuth)
        .send({ day: DAY })
        .expect(200);

      expect(res.body).toEqual({ queued: true, day: DAY });

      const audit = await db.select().from(adminActions).orderBy(desc(adminActions.createdAt));
      const row = audit.find((entry) => entry.action === 'analytics.rollup');
      expect(row?.subjectType).toBe('analytics');
      expect(row?.after).toMatchObject({ day: DAY, reason: 'manual' });
    });

    it('exports aggregates with NO PII columns', async () => {
      await seedDay();
      await writeDay(db, DAY);

      const res = await request(app.getHttpServer())
        .get(`/v1/admin/analytics/export.csv?dataset=summary&from=${DAY}&to=${DAY}`)
        .set('Authorization', opsAuth)
        .expect(200);

      expect(res.headers['content-type']).toContain('text/csv');
      const header = res.text.split('\n')[0]!;
      const columns = header.split(',');
      expect(columns).toContain('gmv_paise');
      expect(columns).toContain('fill_rate_bps');
      expect(res.text).toContain(DAY);

      // §22.3: "no PII in aggregate exports" — asserted EXACTLY per column,
      // the same discipline the fleet statement export keeps. (Exact, not
      // substring: `new_customers` is a legitimate aggregate and contains
      // the word "customer" — the rule is about identity columns, not
      // vocabulary.)
      for (const forbidden of [
        'customer',
        'customer_name',
        'name',
        'mobile',
        'phone',
        'email',
        'address',
        'pickup_address',
        'drop_address',
      ]) {
        expect(columns).not.toContain(forbidden);
      }

      const bands = await request(app.getHttpServer())
        .get(`/v1/admin/analytics/export.csv?dataset=revenue&from=${DAY}&to=${DAY}`)
        .set('Authorization', opsAuth)
        .expect(200);
      const bandColumns = bands.text.split('\n')[0]!.split(',');
      for (const forbidden of ['customer', 'name', 'mobile', 'address']) {
        expect(bandColumns).not.toContain(forbidden);
      }
    });
  });
});

/** `updated_at` is a legitimate difference between two runs; everything else must not move. */
function stripUpdatedAt<T>(value: T): T {
  return JSON.parse(
    JSON.stringify(value, (key, item) => (key === 'updated_at' ? 'stripped' : item)),
  ) as T;
}
