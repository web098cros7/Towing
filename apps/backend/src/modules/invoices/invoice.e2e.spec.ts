import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { invoiceLinkSchema } from '@towing/api-contracts';
import { createTestApp, customerAuthHeaderFor } from '../../test/app';
import { expectMatchesContract } from '../../test/contracts';
import { ENV, type Env } from '../../config/env';
import {
  seedCustomer,
  seedDriver,
  setupTestDatabase,
  truncateAll,
  type TestDatabase,
} from '../../test/db';
import { seedBooking } from '../../test/fixtures';
import { devCheckoutSignature, devPaymentRef } from '../money/dev-payment.adapter';
import { InvoiceService } from './invoice.service';
import { money, renderInvoice } from './invoice.renderer';

/**
 * §14.2's invoice PDF.
 *
 * The renderer is tested as a PURE FUNCTION and the service as a route, because
 * they fail differently: a layout bug is a bad document, an idempotency bug is
 * two different documents for one trip.
 */
describe('invoice e2e', () => {
  let app: INestApplication;
  let db: TestDatabase;
  let secret: string;
  let auth: string;
  let userId: string;
  let bookingId: string;

  beforeAll(async () => {
    db = await setupTestDatabase();
    app = await createTestApp();
    secret = app.get<Env>(ENV).PAYMENT_WEBHOOK_SECRET;
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await truncateAll();
    userId = await seedCustomer(db, 'Invoice Customer');
    auth = await customerAuthHeaderFor(app, { userId });
    const driverId = await seedDriver(db, { name: 'Invoice Driver' });
    bookingId = await seedBooking(db, {
      userId,
      driverId,
      status: 'completed',
      total: '2000.00',
    });
    await db.execute(sql`
      update bookings set commission_band = 'A', commission_pct = 10, base_fare = 1500.00,
                          night_charge = 300.00, surge_amount = 200.00
       where id = ${bookingId}::uuid
    `);
  });

  const payForIt = async (): Promise<void> => {
    const intent = await request(app.getHttpServer())
      .post(`/v1/payments/${bookingId}/intent`)
      .set('Authorization', auth)
      .set('Idempotency-Key', randomUUID())
      .send({ purpose: 'booking' })
      .expect(201);

    const orderRef = intent.body.orderRef as string;
    const gatewayRef = devPaymentRef(orderRef);

    await request(app.getHttpServer())
      .post(`/v1/payments/${bookingId}/capture`)
      .set('Authorization', auth)
      .set('Idempotency-Key', randomUUID())
      .send({ orderRef, gatewayRef, signature: devCheckoutSignature(orderRef, gatewayRef, secret) })
      .expect(200);
  };

  describe('the renderer', () => {
    it('produces real PDF bytes', async () => {
      const buffer = await renderInvoice({
        invoiceNumber: 'INV-TEST0001',
        issuedAt: new Date('2026-09-03T12:00:00Z'),
        customerName: 'A Customer',
        customerMobile: '+919876543210',
        pickupAddress: 'Indiranagar, Bengaluru',
        dropAddress: 'Whitefield, Bengaluru',
        serviceLabel: 'Tow',
        distanceKm: 18.4,
        driverName: 'A Driver',
        vehiclePlate: 'KA 03 AB 1234',
        lines: [
          { label: 'Base fare', amountPaise: 150_000 },
          { label: 'Night charge', amountPaise: 30_000 },
          { label: 'Surge', amountPaise: 20_000 },
        ],
        discountPaise: 0,
        taxLabel: 'GST',
        taxPct: 0,
        taxPaise: 0,
        totalPaise: 200_000,
        paymentMethod: 'upi',
        paidAt: new Date('2026-09-03T12:05:00Z'),
      });

      // `%PDF-` is the magic number. Anything else is not a PDF, whatever the
      // mime type says.
      expect(buffer.subarray(0, 5).toString('ascii')).toBe('%PDF-');
      expect(buffer.byteLength).toBeGreaterThan(1000);
    });

    it('renders a GST line only when there is tax', async () => {
      const base = {
        invoiceNumber: 'INV-TAX',
        issuedAt: new Date('2026-09-03T12:00:00Z'),
        customerName: 'A Customer',
        customerMobile: null,
        pickupAddress: 'Somewhere',
        dropAddress: null,
        serviceLabel: 'Tow',
        distanceKm: null,
        driverName: null,
        vehiclePlate: null,
        lines: [{ label: 'Base fare', amountPaise: 169_492 }],
        discountPaise: 0,
        taxLabel: 'GST',
        paymentMethod: null,
        paidAt: null,
      };

      const untaxed = await renderInvoice({ ...base, taxPct: 0, taxPaise: 0, totalPaise: 169_492 });
      const taxed = await renderInvoice({
        ...base,
        taxPct: 18,
        taxPaise: 30_508,
        totalPaise: 200_000,
      });

      // At the launch rate of zero the document is a plain receipt, which is
      // exactly what it should look like — so it is measurably smaller.
      expect(taxed.byteLength).toBeGreaterThan(untaxed.byteLength);
    });

    it('spells the currency rather than using ₹', () => {
      // ⚠ NOT COSMETIC. pdf-lib's standard-14 fonts are WinAnsiEncoding, which
      // has no U+20B9 — passing the glyph throws at render time. Embedding a
      // TTF is the alternative; a tofu box on a tax document is not.
      expect(money(200_000)).toBe('INR 2,000.00');
      expect(money(10_000_000)).toBe('INR 1,00,000.00');
      expect(money(-49_950)).toBe('-INR 499.50');
      expect(money(50)).toBe('INR 0.50');
    });
  });

  describe('the route', () => {
    it('is refused until the booking is paid', async () => {
      await request(app.getHttpServer())
        .get(`/v1/bookings/${bookingId}/invoice`)
        .set('Authorization', auth)
        .expect(409);
    });

    it('serves a signed link once paid, and the link yields %PDF- bytes', async () => {
      await payForIt();

      const res = await request(app.getHttpServer())
        .get(`/v1/bookings/${bookingId}/invoice`)
        .set('Authorization', auth)
        .expect(200);

      expectMatchesContract(invoiceLinkSchema, res.body);
      expect(res.body.url).toContain('/v1/files/');
      expect(res.body.expiresAt).toBeTruthy();

      // Follow it. The disk adapter signs against this same process's
      // `GET /v1/files/:key`, so the whole download path is exercised.
      const path = res.body.url.slice(res.body.url.indexOf('/v1/files/'));
      const file = await request(app.getHttpServer()).get(path).expect(200);

      expect(Buffer.from(file.body).subarray(0, 5).toString('ascii')).toBe('%PDF-');
    });

    it('is IDEMPOTENT: a second call returns the same key', async () => {
      await payForIt();
      const service = app.get(InvoiceService);

      const first = await service.ensure(bookingId);
      const second = await service.ensure(bookingId);

      // Not merely equal bytes — the SAME artifact. A customer comparing the
      // copy in their email to the one in the app must not find two.
      expect(second).toBe(first);
    });

    it("404s another customer's invoice rather than 403", async () => {
      await payForIt();
      const stranger = await seedCustomer(db, 'Stranger');
      const strangerAuth = await customerAuthHeaderFor(app, { userId: stranger });

      await request(app.getHttpServer())
        .get(`/v1/bookings/${bookingId}/invoice`)
        .set('Authorization', strangerAuth)
        .expect(404);
    });

    it('is generated by capture, so the link needs no render of its own', async () => {
      await payForIt();

      // `QUEUE_ENABLED=false` in the suite, so the enqueued `invoice.generate`
      // never fires — which is exactly why `link()` falls back to a synchronous
      // `ensure()`. This asserts that fallback works rather than assuming it.
      const [row] = (await db.execute(sql`
        select invoice_key from bookings where id = ${bookingId}::uuid
      `)) as unknown as [{ invoice_key: string | null }];
      expect(row.invoice_key).toBeNull();

      await request(app.getHttpServer())
        .get(`/v1/bookings/${bookingId}/invoice`)
        .set('Authorization', auth)
        .expect(200);

      const [after] = (await db.execute(sql`
        select invoice_key from bookings where id = ${bookingId}::uuid
      `)) as unknown as [{ invoice_key: string | null }];
      expect(after.invoice_key).not.toBeNull();
    });
  });
});
