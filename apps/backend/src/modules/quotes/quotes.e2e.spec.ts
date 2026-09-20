import type { INestApplication } from '@nestjs/common';
import {
  adminQuoteSchema,
  quotesResponseSchema,
  type Quote,
} from '@towing/api-contracts';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { adminActions, bookings, quotes } from '../../db/schema';
import {
  adminAuthHeaderFor,
  createTestApp,
  customerAuthHeaderFor,
} from '../../test/app';
import { expectMatchesContract } from '../../test/contracts';
import { seedAdmin, seedCustomer, setupTestDatabase, truncateAll, type TestDatabase } from '../../test/db';
import { closeTestRedis, flushTestRedis } from '../../test/redis';
import { seedPricingFixtures } from '../pricing/pricing.e2e.spec';

/**
 * W20 acceptance — §7.3's manual-quote lane, end to end.
 *
 * The milestone's stated criteria, as assertions:
 *   · A >600 km estimate is REFUSED with `manual_quote_required` (the code the
 *     app branches on to offer the quote flow).
 *   · request → operator prices → customer accepts → a booking exists whose
 *     locked amounts ARE the quoted ones, to the paise.
 *   · An expired or rejected quote cannot be accepted, and a second accept
 *     cannot produce a second booking.
 *   · Someone else's quote is a 404, not a 403.
 *   · Every admin decision is on the audit trail; the queue is `quote.manage`.
 */
const BENGALURU = { lat: 12.9716, lng: 77.5946 };
const MUMBAI = { lat: 19.076, lng: 72.8777 };

describe('manual quotes (§7.3, W20)', () => {
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
    await seedPricingFixtures(db);
    userId = await seedCustomer(db, 'Long Haul Customer');
    auth = await customerAuthHeaderFor(app, { userId });
  });

  const requestBody = (overrides: Record<string, unknown> = {}) => ({
    serviceSlug: 'car_tow',
    vehicleClass: 'flatbed',
    pickup: BENGALURU,
    pickupAddress: 'MG Road, Bengaluru',
    drop: MUMBAI,
    dropAddress: 'Bandra, Mumbai',
    notes: 'Sedan, non-runner',
    ...overrides,
  });

  /** Files a request as the customer and returns the row. */
  const fileQuote = async (): Promise<Quote> => {
    const response = await request(app.getHttpServer())
      .post('/v1/quotes')
      .set('Authorization', auth)
      .send(requestBody())
      .expect(200);
    return response.body as Quote;
  };

  const adminAuth = async (subRole: 'super_admin' | 'operations' | 'support' = 'operations') => {
    const admin = await seedAdmin(db, { subRole });
    return adminAuthHeaderFor(app, { adminId: admin.id, subRole });
  };

  /** Prices a request as an operator. */
  const price = async (quoteId: string, totalPaise = 8_500_000) =>
    request(app.getHttpServer())
      .post(`/v1/admin/quotes/${quoteId}/quote`)
      .set('Authorization', await adminAuth())
      .send({ totalPaise, note: 'Includes 2-day return leg', validHours: 24 })
      .expect(200);

  it('refuses a 600 km+ estimate with the manual-quote code', async () => {
    const response = await request(app.getHttpServer())
      .post('/v1/pricing/estimate')
      .set('Authorization', auth)
      .send({
        serviceSlug: 'car_tow',
        vehicleClass: 'flatbed',
        pickup: BENGALURU,
        drop: MUMBAI,
      })
      .expect(422);

    // The CODE is the contract the app branches on; the distance is the detail
    // the app puts in front of the customer.
    expect(response.body.error.code).toBe('manual_quote_required');
    expect(response.body.error.details.distanceKm).toBeGreaterThan(600);
  });

  it('books at exactly the quoted price and locks the same snapshot columns', async () => {
    const quote = await fileQuote();
    expect(quote.status).toBe('requested');
    expect(quote.distanceKm).toBeGreaterThan(600);

    const priced = await price(quote.id);
    expectMatchesContract(adminQuoteSchema, priced.body);
    expect(priced.body.status).toBe('quoted');
    expect(priced.body.totalPaise).toBe(8_500_000);
    expect(priced.body.validUntil).not.toBeNull();

    // The customer sees the offer with its memo.
    const listed = await request(app.getHttpServer())
      .get('/v1/quotes')
      .set('Authorization', auth)
      .expect(200);
    expectMatchesContract(quotesResponseSchema, listed.body);
    expect(listed.body.items[0]).toMatchObject({
      id: quote.id,
      status: 'quoted',
      totalPaise: 8_500_000,
      quoteNote: 'Includes 2-day return leg',
    });

    const accepted = await request(app.getHttpServer())
      .post(`/v1/quotes/${quote.id}/accept`)
      .set('Authorization', auth)
      .send({})
      .expect(200);

    expect(accepted.body.quote).toMatchObject({ status: 'accepted' });
    expect(accepted.body.booking.status).toBe('searching');
    // THE milestone invariant: the fare the customer agreed to IS the fare on
    // the booking, to the paise.
    expect(accepted.body.booking.breakdown.totalPaise).toBe(8_500_000);

    const [bookingRow] = await db
      .select()
      .from(bookings)
      .where(eq(bookings.id, accepted.body.booking.id));
    expect(bookingRow!.total).toBe('85000.00');
    expect(bookingRow!.commissionBand).toBe('C');
    expect(Number(bookingRow!.commissionPct)).toBeGreaterThan(0);

    const [quoteRow] = await db.select().from(quotes).where(eq(quotes.id, quote.id));
    expect(quoteRow!.status).toBe('accepted');
    expect(quoteRow!.bookingId).toBe(accepted.body.booking.id);

    // Commission split arithmetic, §7: the two sum exactly.
    const totalPaise = 8_500_000;
    expect(quoteRow!.commissionPaise! + quoteRow!.driverPayoutPaise!).toBe(totalPaise);

    // A second accept cannot produce a second booking.
    await request(app.getHttpServer())
      .post(`/v1/quotes/${quote.id}/accept`)
      .set('Authorization', auth)
      .send({})
      .expect(409);
    await expect(
      db.select().from(bookings).where(eq(bookings.userId, userId)),
    ).resolves.toHaveLength(1);
  });

  it('refuses an expired offer and marks it expired on the refusal', async () => {
    const quote = await fileQuote();
    await price(quote.id);

    await db
      .update(quotes)
      .set({ validUntil: new Date(Date.now() - 60_000) })
      .where(eq(quotes.id, quote.id));

    await request(app.getHttpServer())
      .post(`/v1/quotes/${quote.id}/accept`)
      .set('Authorization', auth)
      .send({})
      .expect(409);

    const [row] = await db.select().from(quotes).where(eq(quotes.id, quote.id));
    expect(row!.status).toBe('expired');
    await expect(db.select().from(bookings)).resolves.toHaveLength(0);
  });

  it('refuses an un-quoted request, a rejected one, and someone else’s quote', async () => {
    const quote = await fileQuote();

    // Not quoted yet.
    await request(app.getHttpServer())
      .post(`/v1/quotes/${quote.id}/accept`)
      .set('Authorization', auth)
      .send({})
      .expect(409);

    // Rejected by an operator, with a reason.
    const rejected = await request(app.getHttpServer())
      .post(`/v1/admin/quotes/${quote.id}/reject`)
      .set('Authorization', await adminAuth())
      .send({ reason: 'vehicle not recoverable at that range' })
      .expect(200);
    expect(rejected.body).toMatchObject({
      status: 'rejected',
      rejectionReason: 'vehicle not recoverable at that range',
    });

    await request(app.getHttpServer())
      .post(`/v1/quotes/${quote.id}/accept`)
      .set('Authorization', auth)
      .send({})
      .expect(409);

    // A different customer cannot even learn the id exists.
    const otherUserId = await seedCustomer(db);
    const otherAuth = await customerAuthHeaderFor(app, { userId: otherUserId });
    await request(app.getHttpServer())
      .post(`/v1/quotes/${quote.id}/accept`)
      .set('Authorization', otherAuth)
      .send({})
      .expect(404);
  });

  it('gates the queue on quote.manage and audits every decision', async () => {
    const quote = await fileQuote();

    // Support does not hold `quote.manage` — the queue is operations', with
    // finance seeing only the money it settles elsewhere.
    await request(app.getHttpServer())
      .get('/v1/admin/quotes')
      .set('Authorization', await adminAuth('support'))
      .expect(403);

    const operationsAuth = await adminAuth('operations');
    const listed = await request(app.getHttpServer())
      .get('/v1/admin/quotes')
      .set('Authorization', operationsAuth)
      .expect(200);
    expect(listed.body.items).toHaveLength(1);
    expect(listed.body.items[0]).toMatchObject({ id: quote.id, userLabel: 'Long Haul Customer' });

    // The parameterised detail is EXCLUDED from the contracts walk; its
    // contract is asserted here.
    const detail = await request(app.getHttpServer())
      .get(`/v1/admin/quotes/${quote.id}`)
      .set('Authorization', operationsAuth)
      .expect(200);
    expectMatchesContract(adminQuoteSchema, detail.body);

    await request(app.getHttpServer())
      .post(`/v1/admin/quotes/${quote.id}/quote`)
      .set('Authorization', operationsAuth)
      .send({ totalPaise: 7_000_000 })
      .expect(200);

    const auditRows = await db
      .select()
      .from(adminActions)
      .where(eq(adminActions.subjectType, 'quote'));
    expect(auditRows.map((row) => row.action)).toContain('quote.quote');
    expect(auditRows[0]!.subjectId).toBe(quote.id);

    // A terminal quote refuses further decisions — an exit (accepted, rejected,
    // expired) is final, and re-pricing would move a number the customer may
    // already have agreed to.
    await request(app.getHttpServer())
      .post(`/v1/admin/quotes/${quote.id}/expire`)
      .set('Authorization', operationsAuth)
      .send({})
      .expect(200);
    await request(app.getHttpServer())
      .post(`/v1/admin/quotes/${quote.id}/quote`)
      .set('Authorization', operationsAuth)
      .send({ totalPaise: 9_000_000 })
      .expect(409);
  });
});
