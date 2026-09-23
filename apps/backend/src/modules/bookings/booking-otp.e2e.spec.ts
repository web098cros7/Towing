import type { INestApplication } from '@nestjs/common';
import { bookingOtpResponseSchema } from '@towing/api-contracts';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { bookings } from '../../db/schema';
import { createTestApp, customerAuthHeaderFor } from '../../test/app';
import { expectMatchesContract } from '../../test/contracts';
import { seedCustomer, setupTestDatabase, truncateAll, type TestDatabase } from '../../test/db';
import { seedBooking } from '../../test/fixtures';
import { closeTestRedis, flushTestRedis } from '../../test/redis';
import { digest } from '../auth/otp.util';
import { BookingOtpService } from './booking-otp.service';

/**
 * `GET /v1/bookings/:id/otp` (§9.1.7).
 *
 * NOTHING CAN REACH `assigned` IN PHASE 15 — dispatch is Phase 17 — so every
 * booking here is put into that state directly. That is the honest way to test
 * a route whose precondition does not exist yet, and it is also why the route
 * always 409s in real use for now.
 */
describe('GET /v1/bookings/:id/otp', () => {
  let app: INestApplication;
  let db: TestDatabase;
  let userId: string;
  let auth: string;

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
    userId = await seedCustomer(db);
    auth = await customerAuthHeaderFor(app, { userId });
  });

  async function seedAssigned(owner = userId): Promise<string> {
    const id = await seedBooking(db, { userId: owner, status: 'paid' });
    await db
      .update(bookings)
      .set({ status: 'assigned', bookingOtpHash: digest('000000'), otpExpiresAt: new Date(0) })
      .where(eq(bookings.id, id));
    return id;
  }

  const fetchOtp = (id: string) =>
    request(app.getHttpServer()).get(`/v1/bookings/${id}/otp`).set('Authorization', auth);

  describe('§9.1.7 — never before assignment', () => {
    it.each(['searching', 'no_drivers_found', 'cancelled'] as const)('409s while %s', async (status) => {
      const id = await seedBooking(db, { userId, status: 'paid' });
      await db.update(bookings).set({ status }).where(eq(bookings.id, id));

      const response = await fetchOtp(id).expect(409);
      expect(response.body.error.code).toBe('otp_not_available');
    });

    it.each(['assigned', 'en_route', 'arrived', 'in_progress'] as const)(
      'serves a code once %s',
      async (status) => {
        const id = await seedAssigned();
        await db.update(bookings).set({ status }).where(eq(bookings.id, id));

        const response = await fetchOtp(id).expect(200);
        expectMatchesContract(bookingOtpResponseSchema, response.body);
        expect(response.body.code).toMatch(/^\d{6}$/);
      },
    );
  });

  describe('the code and its window', () => {
    it('stores only a digest — the row never holds the code', async () => {
      const id = await seedAssigned();
      const { body } = await fetchOtp(id).expect(200);

      const [row] = await db.select().from(bookings).where(eq(bookings.id, id));
      expect(row!.bookingOtpHash).not.toBe(body.code);
      expect(row!.bookingOtpHash).toBe(digest(body.code));
      expect(row!.bookingOtpHash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('sets a 30-minute window on first retrieval', async () => {
      const id = await seedAssigned();
      const before = Date.now();
      const { body } = await fetchOtp(id).expect(200);

      const expiry = new Date(body.expiresAt).getTime();
      expect(expiry).toBeGreaterThanOrEqual(before + BookingOtpService.WINDOW_MS - 5_000);
      expect(expiry).toBeLessThanOrEqual(Date.now() + BookingOtpService.WINDOW_MS + 5_000);
    });

    it('returns the SAME code when read again inside the window', async () => {
      // The case that forced the Redis-backed read path: the customer is
      // holding the code out to a driver while their screen refetches in the
      // background. Rotating there would invalidate the code being read aloud.
      const id = await seedAssigned();
      const first = await fetchOtp(id).expect(200);
      const second = await fetchOtp(id).expect(200);

      expect(second.body.code).toBe(first.body.code);
      expect(second.body.expiresAt).toBe(first.body.expiresAt);
    });

    it('ROTATES once the window has lapsed, and restarts the clock', async () => {
      const id = await seedAssigned();
      const first = await fetchOtp(id).expect(200);

      // §9.1.7's expiry, reached without waiting half an hour.
      await db
        .update(bookings)
        .set({ otpExpiresAt: new Date(Date.now() - 1_000) })
        .where(eq(bookings.id, id));

      const second = await fetchOtp(id).expect(200);
      expect(second.body.code).not.toBe(first.body.code);
      expect(new Date(second.body.expiresAt).getTime()).toBeGreaterThan(
        new Date(first.body.expiresAt).getTime(),
      );

      // …and the digest tracks the NEW code, so the old one can no longer start
      // the job.
      const [row] = await db.select().from(bookings).where(eq(bookings.id, id));
      expect(row!.bookingOtpHash).toBe(digest(second.body.code));
      expect(row!.bookingOtpHash).not.toBe(digest(first.body.code));
    });

    it('resets the attempt cap when it rotates', async () => {
      const id = await seedAssigned();
      await db
        .update(bookings)
        .set({ otpAttempts: 4, otpExpiresAt: new Date(Date.now() - 1_000) })
        .where(eq(bookings.id, id));

      await fetchOtp(id).expect(200);

      const [row] = await db.select().from(bookings).where(eq(bookings.id, id));
      // A customer must not be locked out of a code they were just handed.
      expect(row!.otpAttempts).toBe(0);
    });

    it('recovers if the readable copy is lost mid-window', async () => {
      const id = await seedAssigned();
      const first = await fetchOtp(id).expect(200);

      // Redis flushed / evicted while the row still says the window is live.
      await flushTestRedis();

      const second = await fetchOtp(id).expect(200);
      expect(second.body.code).toMatch(/^\d{6}$/);
      // Whatever it returns must be the code the row will verify against —
      // stranding a customer whose driver is standing in front of them is the
      // one outcome that is not acceptable here.
      const [row] = await db.select().from(bookings).where(eq(bookings.id, id));
      expect(row!.bookingOtpHash).toBe(digest(second.body.code));
      expect(second.body.code).not.toBe(first.body.code);
    });
  });

  describe('ownership', () => {
    it('404s another customer\'s OTP', async () => {
      const stranger = await seedCustomer(db);
      const theirs = await seedAssigned(stranger);

      await request(app.getHttpServer())
        .get(`/v1/bookings/${theirs}/otp`)
        .set('Authorization', auth)
        .expect(404);
    });

    it('rejects an anonymous caller', async () => {
      const id = await seedAssigned();
      await request(app.getHttpServer()).get(`/v1/bookings/${id}/otp`).expect(401);
    });
  });

  describe('L17 — a locked code, and the customer asking for a new one', () => {
    const renew = (id: string, as = auth) =>
      request(app.getHttpServer()).post(`/v1/bookings/${id}/otp/renew`).set('Authorization', as);

    /** Five wrong guesses from the driver side, the way `start()` makes them. */
    async function lockOut(id: string): Promise<void> {
      const otp = app.get(BookingOtpService);
      for (let i = 0; i < 5; i += 1) await otp.verify(db, id, '999999');
    }

    it('reports the code as locked once the driver has used up the attempts', async () => {
      const id = await seedAssigned();
      const first = await fetchOtp(id).expect(200);
      expect(first.body.locked).toBe(false);

      await lockOut(id);

      const after = await fetchOtp(id).expect(200);
      // Same code, same window, and now honest that it no longer works.
      expect(after.body.code).toBe(first.body.code);
      expect(after.body.locked).toBe(true);
    });

    it('gives the customer a new, working code at once, and kills the old one', async () => {
      const id = await seedAssigned();
      const old = (await fetchOtp(id).expect(200)).body.code as string;
      await lockOut(id);

      const renewed = await renew(id).expect(200);
      expectMatchesContract(bookingOtpResponseSchema, renewed.body);
      expect(renewed.body.locked).toBe(false);
      expect(renewed.body.code).not.toBe(old);

      const otp = app.get(BookingOtpService);
      expect(await otp.verify(db, id, old)).toBe(false);
      expect(await otp.verify(db, id, renewed.body.code)).toBe(true);
      // And reading it again returns the new code, not a fresh rotation.
      expect((await fetchOtp(id).expect(200)).body.code).toBe(renewed.body.code);
    });

    it('allows three renewals a trip, then points to support', async () => {
      // The cap is what stops "reset" becoming unlimited guesses at the code.
      const id = await seedAssigned();
      for (let i = 0; i < 3; i += 1) await renew(id).expect(200);

      const refused = await renew(id).expect(429);
      expect(refused.body.error.code).toBe('otp_renewals_exhausted');
    });

    it("404s another customer's booking and 409s before assignment", async () => {
      const theirs = await seedAssigned(await seedCustomer(db));
      await renew(theirs).expect(404);

      const searching = await seedBooking(db, { userId, status: 'paid' });
      await db.update(bookings).set({ status: 'searching' }).where(eq(bookings.id, searching));
      await renew(searching).expect(409);
    });
  });
});
