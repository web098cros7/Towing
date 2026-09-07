import type { INestApplication } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  bookingTrackingSchema,
  callContactSchema,
  cancellationQuoteSchema,
  publicTrackSchema,
} from '@towing/api-contracts';
import { bookings, drivers, users } from '../../db/schema';
import { expectMatchesContract } from '../../test/contracts';
import { createTestApp, customerAuthHeaderFor } from '../../test/app';
import {
  seedCustomer,
  setupTestDatabase,
  testDb,
  truncateAll,
  type TestDatabase,
} from '../../test/db';
import { closeTestRedis, flushTestRedis } from '../../test/redis';
import {
  PICKUP,
  seedOnlineDriver,
  seedSearchingBooking,
  seedZone,
} from '../dispatch/dispatch-fixtures';
import { DispatchRepo } from '../dispatch/dispatch.repo';
import { OfferService } from '../dispatch/offer.service';

/**
 * §11.7's share-trip link, over real HTTP — including the unauthenticated half.
 *
 * THE ROUTE UNDER TEST IS THE ONLY ONE IN THE SYSTEM THAT ANSWERS WITHOUT A
 * SESSION. `track-projection.spec.ts` proves the projection carries nothing it
 * should not; this proves the surface around it — who can mint a link, who can
 * read one, and when it stops working.
 */

let app: INestApplication;
let db: TestDatabase;
let offers: OfferService;
let repo: DispatchRepo;

async function assign(bookingId: string, driverId: string): Promise<void> {
  const booking = await repo.booking(bookingId);
  await offers.offer(
    booking!,
    { driverId, distanceMeters: 500, score: 50, fleetId: null, truckId: null },
    1,
    2,
    20,
  );
  await offers.accept(bookingId, driverId);
}

describe('§11.7 share trip', () => {
  let zoneId: string;
  let userId: string;
  let driverId: string;
  let bookingId: string;
  let auth: string;

  beforeAll(async () => {
    await setupTestDatabase();
    db = testDb();
    app = await createTestApp();
    offers = app.get(OfferService);
    repo = app.get(DispatchRepo);
  });

  afterAll(async () => {
    await app.close();
    await closeTestRedis();
  });

  beforeEach(async () => {
    await truncateAll();
    await flushTestRedis();

    zoneId = await seedZone(db);
    userId = await seedCustomer(db);
    driverId = await seedOnlineDriver(db, { zoneId });
    bookingId = await seedSearchingBooking(db, { userId, zoneId });
    auth = await customerAuthHeaderFor(app, { userId });
  });

  async function share(): Promise<{ token: string; url: string }> {
    const response = await request(app.getHttpServer())
      .post(`/v1/bookings/${bookingId}/share`)
      .set('authorization', auth)
      .send({})
      .expect(200);
    return response.body;
  }

  describe('minting', () => {
    it('refuses to share a booking that has no driver yet', async () => {
      // A link to an empty map is worse than a button that says "not yet".
      const response = await request(app.getHttpServer())
        .post(`/v1/bookings/${bookingId}/share`)
        .set('authorization', auth)
        .send({})
        .expect(409);

      expect(response.body.error.code).toBe('invalid_booking_state');
    });

    it('mints a 128-bit token and composes the URL server-side', async () => {
      await assign(bookingId, driverId);
      const body = await share();

      // 16 random bytes as base64url is 22 characters.
      expect(body.token).toHaveLength(22);
      expect(body.token).toMatch(/^[A-Za-z0-9_-]+$/);
      // The origin rides the response so relocating the page needs no mobile
      // release — the same argument `wsUrl` won on the realtime ticket.
      expect(body.url.endsWith(`/t/${body.token}`)).toBe(true);
    });

    it('returns the LIVE token on a second tap rather than rotating it', async () => {
      // Rotating would silently kill the page somebody is already watching —
      // and that is true for an accidental double-tap and a genuine retry alike,
      // which is more than an idempotency key would give.
      await assign(bookingId, driverId);
      const first = await share();
      const second = await share();
      expect(second.token).toBe(first.token);
    });

    it('refuses to share somebody else’s booking, as a 404', async () => {
      await assign(bookingId, driverId);
      const stranger = await seedCustomer(db, 'Stranger');
      const strangerAuth = await customerAuthHeaderFor(app, { userId: stranger });

      // 404, not 403: confirming that an id exists is itself information, and no
      // legitimate caller needs to tell "not yours" from "not there".
      await request(app.getHttpServer())
        .post(`/v1/bookings/${bookingId}/share`)
        .set('authorization', strangerAuth)
        .send({})
        .expect(404);
    });
  });

  describe('the public page', () => {
    it('serves the trip with no session at all', async () => {
      await assign(bookingId, driverId);
      const { token } = await share();

      const response = await request(app.getHttpServer())
        .get(`/v1/track/${token}`)
        .expect(200);

      // The published schema, exactly. `expectMatchesContract` also fails if
      // the server returned a key the contract does not declare — the
      // direction that matters most on the one unauthenticated route here.
      expectMatchesContract(publicTrackSchema, response.body);
      expect(response.body.status).toBe('assigned');
      expect(response.body.vehiclePlate).toBeDefined();
    });

    it('404s an unknown token', async () => {
      await request(app.getHttpServer())
        .get('/v1/track/aaaaaaaaaaaaaaaaaaaaaa')
        .expect(404);
    });

    it('refuses a malformed token at the edge, before any query', async () => {
      // The value reaches a WHERE clause on an unauthenticated route. Drizzle
      // parameterises it, but an unbounded body of text does not belong there.
      await request(app.getHttpServer()).get('/v1/track/short').expect(422);
      await request(app.getHttpServer()).get(`/v1/track/${'a'.repeat(200)}`).expect(422);
    });

    it('reports an expired link as GONE, not as missing', async () => {
      // Somebody was sent this link because a person they care about was in
      // trouble. "No such trip" invites them to think they mistyped; "this trip
      // has ended" is both true and the answer they need.
      await assign(bookingId, driverId);
      const { token } = await share();

      await db
        .update(bookings)
        .set({ shareExpiresAt: new Date(Date.now() - 1_000) })
        .where(eq(bookings.id, bookingId));

      const response = await request(app.getHttpServer())
        .get(`/v1/track/${token}`)
        .expect(410);

      expect(response.body.error.code).toBe('share_link_expired');
    });

    it('stops working the moment the customer revokes it', async () => {
      await assign(bookingId, driverId);
      const { token } = await share();
      await request(app.getHttpServer()).get(`/v1/track/${token}`).expect(200);

      await request(app.getHttpServer())
        .delete(`/v1/bookings/${bookingId}/share`)
        .set('authorization', auth)
        .expect(204);

      // A revoked link reads as gone rather than as a tombstone: nulling the
      // token also frees the unique index slot.
      await request(app.getHttpServer()).get(`/v1/track/${token}`).expect(404);
    });

    it('mints a genuinely new token after a revoke', async () => {
      await assign(bookingId, driverId);
      const first = await share();
      await request(app.getHttpServer())
        .delete(`/v1/bookings/${bookingId}/share`)
        .set('authorization', auth)
        .expect(204);

      const second = await share();
      expect(second.token).not.toBe(first.token);
      await request(app.getHttpServer()).get(`/v1/track/${first.token}`).expect(404);
      await request(app.getHttpServer()).get(`/v1/track/${second.token}`).expect(200);
    });
  });

  describe('the customer tracking poll (§19.2)', () => {
    it('serves the same facts the socket pushes', async () => {
      await assign(bookingId, driverId);

      const response = await request(app.getHttpServer())
        .get(`/v1/bookings/${bookingId}/tracking`)
        .set('authorization', auth)
        .expect(200);

      expectMatchesContract(bookingTrackingSchema, response.body);
      expect(response.body.bookingId).toBe(bookingId);
      expect(response.body.status).toBe('assigned');
      expect(response.body.driver.name).toBeDefined();
      expect(response.body.pickup).toEqual({ lat: PICKUP.lat, lng: PICKUP.lng });
    });

    it('answers before assignment rather than 404ing', async () => {
      // The app switches to this screen the moment the search hands over, so
      // "not matched yet" must be distinguishable from "no such booking".
      const response = await request(app.getHttpServer())
        .get(`/v1/bookings/${bookingId}/tracking`)
        .set('authorization', auth)
        .expect(200);

      expect(response.body.status).toBe('searching');
      expect(response.body.driver).toBeNull();
      expect(response.body.position).toBeNull();
    });

    it('never carries a phone number', async () => {
      // §9.1.7's call button goes through `/contact` and `TelephonyPort`, so the
      // number is not a field on a payload polled every ten seconds into a query
      // cache and every HAR file.
      await assign(bookingId, driverId);

      const [driver] = await db
        .select({ mobile: drivers.mobile })
        .from(drivers)
        .where(eq(drivers.id, driverId));
      const [customer] = await db
        .select({ mobile: users.mobile })
        .from(users)
        .where(eq(users.id, userId));

      const response = await request(app.getHttpServer())
        .get(`/v1/bookings/${bookingId}/tracking`)
        .set('authorization', auth)
        .expect(200);

      // The ACTUAL seeded numbers, not a digit-run regex. `\d{10,}` also matches
      // uuid segments, epoch-ish timestamps and full-precision coordinates —
      // it failed on `77.59920917535898` while the payload was perfectly clean,
      // which is a test that cries wolf rather than one that guards anything.
      const body = JSON.stringify(response.body);
      expect(body).not.toContain(driver!.mobile);
      expect(body).not.toContain(customer!.mobile);
    });

    it('404s somebody else’s booking', async () => {
      const stranger = await seedCustomer(db, 'Stranger');
      const strangerAuth = await customerAuthHeaderFor(app, { userId: stranger });
      await request(app.getHttpServer())
        .get(`/v1/bookings/${bookingId}/tracking`)
        .set('authorization', strangerAuth)
        .expect(404);
    });
  });

  describe('§9.1.7 cancellation quote', () => {
    it('quotes free while the search is still running', async () => {
      const response = await request(app.getHttpServer())
        .get(`/v1/bookings/${bookingId}/cancellation-quote`)
        .set('authorization', auth)
        .expect(200);

      expectMatchesContract(cancellationQuoteSchema, response.body);
      expect(response.body.tier).toBe('free');
      expect(response.body.feePaise).toBe(0);
      expect(response.body.reason).toContain('Free');
    });

    it('quotes the full BASE fare once a driver is en route, and says it CAN now be taken', async () => {
      await assign(bookingId, driverId);
      await db
        .update(bookings)
        // §3.5's full tier is the BASE fare, not the total — so the fixture's
        // `base_fare` has to be set for this to assert anything. It defaults to
        // '0', which made the first version of this test pass a zero fee under a
        // "full" label and prove nothing.
        .set({ status: 'en_route', baseFare: '999.00' })
        .where(eq(bookings.id, bookingId));

      const response = await request(app.getHttpServer())
        .get(`/v1/bookings/${bookingId}/cancellation-quote`)
        .set('authorization', auth)
        .expect(200);

      expect(response.body.tier).toBe('full');
      expect(response.body.feePaise).toBe(99_900);
      // Phase 19 shipped collection, so this flipped to true. It stays in the
      // contract because the distinction is real: a `false` means "we cannot
      // take this fee, so cancelling here is not possible", which is the
      // honest thing to render if collection is ever unavailable.
      expect(response.body.chargeable).toBe(true);
      // §3.5 compensates the driver out of the fee — half of it, by default.
      expect(response.body.driverCompensationPaise).toBe(49_950);
    });

    it('agrees with what the cancel route actually does', async () => {
      // The point of the quote is that there is ONE implementation of §3.5. A
      // separate quoting calculation is the arrangement where a customer is
      // shown ₹0 and billed ₹150.
      const quote = await request(app.getHttpServer())
        .get(`/v1/bookings/${bookingId}/cancellation-quote`)
        .set('authorization', auth)
        .expect(200);

      const cancelled = await request(app.getHttpServer())
        .post(`/v1/bookings/${bookingId}/cancel`)
        .set('authorization', auth)
        .send({})
        .expect(200);

      expect(cancelled.body.tier).toBe(quote.body.tier);
      expect(cancelled.body.feePaise).toBe(quote.body.feePaise);
    });
  });
});
