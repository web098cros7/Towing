import type { INestApplication } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ratingStateSchema } from '@towing/api-contracts';
import { createTestApp, customerAuthHeaderFor, driverAuthHeaderFor } from '../../test/app';
import {
  seedCustomer,
  seedDriver,
  setupTestDatabase,
  truncateAll,
  type TestDatabase,
} from '../../test/db';
import { expectMatchesContract } from '../../test/contracts';
import { seedBooking } from '../../test/fixtures';

/**
 * §9.1.10 / §9.2.5's two-way rating.
 *
 * THE POINT OF THIS FILE IS `drivers.rating`. It has been read by §6.2's
 * dispatch scorer since Phase 17 and weighted at 15 % of every matching
 * decision while nothing ever wrote it — the scorer ran on whatever the seed
 * happened to set. These tests are what turn that column from a fixture into a
 * measurement.
 */
describe('ratings e2e', () => {
  let app: INestApplication;
  let db: TestDatabase;
  let customerAuth: string;
  let driverAuth: string;
  let userId: string;
  let driverId: string;
  let bookingId: string;

  beforeAll(async () => {
    db = await setupTestDatabase();
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await truncateAll();
    userId = await seedCustomer(db, 'Rating Customer');
    driverId = await seedDriver(db, { name: 'Rated Driver' });
    customerAuth = await customerAuthHeaderFor(app, { userId });
    driverAuth = await driverAuthHeaderFor(app, { driverId });
    bookingId = await seedBooking(db, { userId, driverId, status: 'completed', total: '500.00' });
  });

  const driverRating = async (): Promise<string | null> => {
    const [row] = (await db.execute(sql`
      select rating::text as rating from drivers where id = ${driverId}::uuid
    `)) as unknown as [{ rating: string | null }];
    return row.rating;
  };

  const rate = (rating: number, review?: string) =>
    request(app.getHttpServer())
      .post(`/v1/bookings/${bookingId}/rate`)
      .set('Authorization', customerAuth)
      .send({ rating, ...(review ? { review } : {}) });

  it('records a rating and rolls it into drivers.rating', async () => {
    const res = await rate(5, 'Quick and careful').expect(200);

    expect(res.body).toMatchObject({ rating: 5, review: 'Quick and careful' });
    expect(await driverRating()).toBe('5.0');
  });

  it('a second rating AMENDS rather than duplicating', async () => {
    // `uq_ratings_booking_direction` makes this an UPSERT — which is also why
    // the route takes no `Idempotency-Key`: a unique index is a stronger
    // mechanism than a replayed cached response, and it lets a customer
    // genuinely change their mind rather than silently no-op.
    await rate(5).expect(200);
    await rate(2).expect(200);

    const [row] = (await db.execute(sql`
      select count(*)::int as count from ratings where booking_id = ${bookingId}::uuid
    `)) as unknown as [{ count: number }];
    expect(row.count).toBe(1);
    expect(await driverRating()).toBe('2.0');
  });

  it('averages across bookings, and RECOMPUTES rather than incrementing', async () => {
    await rate(5).expect(200);

    const second = await seedBooking(db, { userId, driverId, status: 'paid', total: '500.00' });
    await request(app.getHttpServer())
      .post(`/v1/bookings/${second}/rate`)
      .set('Authorization', customerAuth)
      .send({ rating: 4 })
      .expect(200);

    expect(await driverRating()).toBe('4.5');

    // Amending the first re-derives the whole average, which is the property
    // that makes this self-healing under retries and crashes.
    await rate(3).expect(200);
    expect(await driverRating()).toBe('3.5');
  });

  it('leaves rating NULL for a driver nobody has rated', async () => {
    // NOT 5.0. `candidate-selection.score()` maps null to its NEUTRAL midpoint;
    // a hard-coded 5.0 would rank every brand-new driver above the people who
    // earned theirs.
    expect(await driverRating()).toBeNull();
  });

  it('refuses a trip that has not finished', async () => {
    const active = await seedBooking(db, { userId, driverId, status: 'in_progress', total: '500.00' });
    await request(app.getHttpServer())
      .post(`/v1/bookings/${active}/rate`)
      .set('Authorization', customerAuth)
      .send({ rating: 5 })
      .expect(409);
  });

  it("404s on somebody else's booking rather than 403", async () => {
    const stranger = await seedCustomer(db, 'Stranger');
    const strangerAuth = await customerAuthHeaderFor(app, { userId: stranger });

    await request(app.getHttpServer())
      .post(`/v1/bookings/${bookingId}/rate`)
      .set('Authorization', strangerAuth)
      .send({ rating: 1 })
      .expect(404);
  });

  it('rejects a rating outside 1..5', async () => {
    await rate(0).expect(422);
    await rate(6).expect(422);
  });

  describe('the driver half', () => {
    it('records a driver_to_customer rating WITHOUT touching drivers.rating', async () => {
      // Stored for Phase 20's support surface. There is no `users.rating`
      // column on purpose — nothing scores customers, and a field with no
      // reader is worse than no field.
      await request(app.getHttpServer())
        .post(`/v1/driver/jobs/${bookingId}/rate`)
        .set('Authorization', driverAuth)
        .send({ rating: 4 })
        .expect(200);

      expect(await driverRating()).toBeNull();

      const [row] = (await db.execute(sql`
        select direction from ratings where booking_id = ${bookingId}::uuid
      `)) as unknown as [{ direction: string }];
      expect(row.direction).toBe('driver_to_customer');
    });

    it('both directions coexist on one booking', async () => {
      await rate(5).expect(200);
      await request(app.getHttpServer())
        .post(`/v1/driver/jobs/${bookingId}/rate`)
        .set('Authorization', driverAuth)
        .send({ rating: 3 })
        .expect(200);

      const [row] = (await db.execute(sql`
        select count(*)::int as count from ratings where booking_id = ${bookingId}::uuid
      `)) as unknown as [{ count: number }];
      expect(row.count).toBe(2);
    });

    it('404s when the driver is not the one on the booking', async () => {
      const other = await seedDriver(db, { name: 'Other Driver' });
      const otherAuth = await driverAuthHeaderFor(app, { driverId: other });

      await request(app.getHttpServer())
        .post(`/v1/driver/jobs/${bookingId}/rate`)
        .set('Authorization', otherAuth)
        .send({ rating: 5 })
        .expect(404);
    });
  });

  describe('GET :id/rating', () => {
    it('matches its contract, unrated and rated', async () => {
      // The contracts ratchet excludes this path because its table holds only
      // static paths; this is the assertion the exclusion points at.
      const before = await request(app.getHttpServer())
        .get(`/v1/bookings/${bookingId}/rating`)
        .set('Authorization', customerAuth)
        .expect(200);

      expectMatchesContract(ratingStateSchema, before.body);
      expect(before.body).toMatchObject({ mine: null, canRate: true });

      await rate(5).expect(200);

      const after = await request(app.getHttpServer())
        .get(`/v1/bookings/${bookingId}/rating`)
        .set('Authorization', customerAuth)
        .expect(200);

      expectMatchesContract(ratingStateSchema, after.body);
      expect(after.body.mine).toMatchObject({ rating: 5 });
    });
  });
});
