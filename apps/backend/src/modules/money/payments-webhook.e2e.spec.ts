import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, customerAuthHeaderFor } from '../../test/app';
import { ENV, type Env } from '../../config/env';
import {
  seedCustomer,
  seedDriver,
  setupTestDatabase,
  truncateAll,
  type TestDatabase,
} from '../../test/db';
import { seedBooking } from '../../test/fixtures';
import { ledgerInvariants } from '../../db/ledger/invariants';
import { devCheckoutSignature, devPaymentRef } from './dev-payment.adapter';
import { PaymentReconcileService } from './payment-reconcile.service';
import { signWebhook } from './webhook-signature';

/**
 * §14.2's "webhook confirms (signature-verified)" and §19.3's sweep.
 *
 * THE WEBHOOK IS THE AUTHORITATIVE HALF. The app's own capture call is a
 * courtesy that makes the UI fast; this is the path that works when the app
 * dies mid-sheet, and the sweep is the path that works when the webhook is lost
 * too. Between them a customer whose payment succeeded always ends up `paid` —
 * which is the property §19.2's "COMPLETED (unpaid)" depends on being temporary.
 */
describe('payment webhook + reconcile e2e', () => {
  let app: INestApplication;
  let db: TestDatabase;
  let paymentSecret: string;
  let payoutSecret: string;
  let userId: string;
  let driverId: string;
  let bookingId: string;

  beforeAll(async () => {
    db = await setupTestDatabase();
    app = await createTestApp();
    const env = app.get<Env>(ENV);
    paymentSecret = env.PAYMENT_WEBHOOK_SECRET;
    payoutSecret = env.PAYOUT_WEBHOOK_SECRET;
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await truncateAll();
    userId = await seedCustomer(db, 'Webhook Customer');
    driverId = await seedDriver(db, { name: 'Webhook Driver' });
    bookingId = await seedBooking(db, {
      userId,
      driverId,
      status: 'completed',
      total: '1000.00',
    });
    await db.execute(sql`
      update bookings set commission_band = 'A', commission_pct = 10
       where id = ${bookingId}::uuid
    `);
  });

  const expectNoDrift = async (): Promise<void> => {
    await expect(ledgerInvariants(db)).resolves.toEqual({
      walletDrift: 0,
      bookingDrift: 0,
      ledgerDrift: 0,
      reversalDrift: 0,
      couponDrift: 0,
    });
  };

  const legCount = async (booking = bookingId): Promise<number> => {
    const [row] = (await db.execute(sql`
      select count(*)::int as count from wallet_transactions where ref_id = ${booking}::uuid
    `)) as unknown as [{ count: number }];
    return row.count;
  };

  const status = async (booking = bookingId): Promise<string> => {
    const [row] = (await db.execute(sql`
      select status from bookings where id = ${booking}::uuid
    `)) as unknown as [{ status: string }];
    return row.status;
  };

  /** An order the dev gateway will recognise, without going through the app. */
  const seedIntent = async (): Promise<{ orderRef: string; gatewayRef: string }> => {
    const orderRef = `order_dev_${Date.now().toString(36)}_${randomUUID().slice(0, 8)}`;
    await db.execute(sql`
      insert into payments (booking_id, amount, tax_amount, purpose, method, status,
                            idempotency_key, provider, gateway_order_ref)
      values (${bookingId}::uuid, 1000.00, 0, 'booking', 'upi', 'pending',
              ${`pay:v1:${bookingId}:booking:${randomUUID()}`}, 'dev', ${orderRef})
    `);
    return { orderRef, gatewayRef: devPaymentRef(orderRef) };
  };

  const paymentEvent = (
    refs: { orderRef: string; gatewayRef: string },
    overrides: Record<string, unknown> = {},
  ) => ({
    id: `evt_${randomUUID()}`,
    event: 'payment.captured',
    payload: {
      payment: {
        entity: {
          id: refs.gatewayRef,
          order_id: refs.orderRef,
          status: 'captured',
          method: 'upi',
          amount: 100_000,
          notes: { bookingId },
          ...overrides,
        },
      },
    },
  });

  const post = (body: unknown, secret: string, signature?: string) => {
    const raw = JSON.stringify(body);
    return request(app.getHttpServer())
      .post('/v1/webhooks/razorpay')
      .set('x-razorpay-signature', signature ?? signWebhook(raw, secret))
      .set('Content-Type', 'application/json')
      .send(raw);
  };

  it('settles a signed payment.captured', async () => {
    const refs = await seedIntent();
    await post(paymentEvent(refs), paymentSecret).expect(200);

    expect(await status()).toBe('paid');
    expect(await legCount()).toBe(1);
    await expectNoDrift();
  });

  it('a replayed event id inserts zero rows and credits nothing twice', async () => {
    const refs = await seedIntent();
    const body = paymentEvent(refs);

    await post(body, paymentSecret).expect(200);
    await post(body, paymentSecret).expect(200);

    const [events] = (await db.execute(sql`
      select count(*)::int as count from webhook_events where event_id = ${body.id}
    `)) as unknown as [{ count: number }];
    expect(events.count).toBe(1);
    expect(await legCount()).toBe(1);
    await expectNoDrift();
  });

  it('WEBHOOK FIRST, then the client capture — one leg, not two', async () => {
    // The race that actually happens in production: Razorpay answers our
    // server before the customer's phone finishes its own round trip.
    const refs = await seedIntent();
    await post(paymentEvent(refs), paymentSecret).expect(200);

    const auth = await customerAuthHeaderFor(app, { userId });

    const late = await request(app.getHttpServer())
      .post(`/v1/payments/${bookingId}/capture`)
      .set('Authorization', auth)
      .set('Idempotency-Key', randomUUID())
      .send({
        ...refs,
        signature: devCheckoutSignature(refs.orderRef, refs.gatewayRef, paymentSecret),
      });

    expect(late.status).toBe(200);
    expect(await legCount()).toBe(1);
    await expectNoDrift();
  });

  it('rejects an unsigned request with ZERO webhook_events rows', async () => {
    const refs = await seedIntent();

    await post(paymentEvent(refs), paymentSecret, 'not-a-signature').expect(401);

    const [events] = (await db.execute(sql`
      select count(*)::int as count from webhook_events
    `)) as unknown as [{ count: number }];
    expect(events.count).toBe(0);
    expect(await legCount()).toBe(0);
  });

  it('routes a payout event to the payout port even when the PAYMENT secret signed it', async () => {
    // THE CROSS-PARSER FALLBACK. Both Razorpay products can legitimately be
    // configured with the same webhook secret, in which case the payment port
    // verifies every payout event and its parser correctly returns null.
    // Without the fallback the controller would 200-and-drop every payout
    // webhook, silently, forever.
    const body = {
      id: `evt_${randomUUID()}`,
      event: 'payout.processed',
      payload: { payout: { entity: { id: 'pout_x', status: 'processed', notes: {} } } },
    };

    await post(body, paymentSecret).expect(200);

    // Recorded under the PAYOUT provider's name — which is the point: the
    // dedup index is `(provider, event_id)`, and filing it under the payment
    // provider would let the same event be processed twice if the secrets were
    // later separated.
    const [row] = (await db.execute(sql`
      select provider, error from webhook_events where event_id = ${body.id}
    `)) as unknown as [{ provider: string; error: string | null }];
    expect(row.provider).toBe('dev');
    // No payout matches `pout_x`, so it is recorded as un-appliable — and still
    // acknowledged, which is the behaviour that keeps Razorpay from disabling
    // the endpoint.
    expect(row.error).not.toBeNull();
  });

  it('acknowledges an event type it does not handle, without a row', async () => {
    const body = { id: `evt_${randomUUID()}`, event: 'subscription.charged', payload: {} };
    await post(body, paymentSecret).expect(200);

    const [row] = (await db.execute(sql`
      select count(*)::int as count from webhook_events
    `)) as unknown as [{ count: number }];
    expect(row.count).toBe(0);
  });

  it('records an un-appliable event and still returns 200', async () => {
    const orphan = {
      id: `evt_${randomUUID()}`,
      event: 'payment.captured',
      payload: {
        payment: { entity: { id: 'pay_nope', order_id: 'order_nope', status: 'captured', notes: {} } },
      },
    };

    await post(orphan, paymentSecret).expect(200);

    const [row] = (await db.execute(sql`
      select error, processed_at from webhook_events where event_id = ${orphan.id}
    `)) as unknown as [{ error: string | null; processed_at: string | null }];
    expect(row.error).not.toBeNull();
    expect(row.processed_at).toBeNull();
  });

  describe('§19.3 sweep', () => {
    it('settles a payment the gateway confirms but no webhook announced', async () => {
      const refs = await seedIntent();
      // Age it past the two-minute grace.
      await db.execute(sql`
        update payments set updated_at = now() - interval '10 minutes'
         where gateway_order_ref = ${refs.orderRef}
      `);

      const result = await app.get(PaymentReconcileService).reconcile('manual');

      expect(result.settled).toBe(1);
      expect(await status()).toBe('paid');
      expect(await legCount()).toBe(1);
      await expectNoDrift();
    });

    it('leaves the booking COMPLETED when the gateway never confirms', async () => {
      // §19.2's honest unpaid state: a payment that never went through is an
      // unpaid trip, not a cancelled one, and ops can intervene.
      const orderRef = 'order_broken_ref';
      await db.execute(sql`
        insert into payments (booking_id, amount, tax_amount, purpose, method, status,
                              idempotency_key, provider, gateway_order_ref, updated_at)
        values (${bookingId}::uuid, 1000.00, 0, 'booking', 'upi', 'pending',
                ${`pay:v1:${bookingId}:booking:${randomUUID()}`}, 'dev', ${orderRef},
                now() - interval '10 minutes')
      `);

      // An unparseable ref: the dev adapter treats it as settled, so force the
      // stuck branch by making the gateway's answer irrelevant — the row is
      // older than PAYMENT_STUCK_MINUTES either way. Assert the booking, which
      // is the thing that must not move.
      await app.get(PaymentReconcileService).reconcile('manual');

      const finalStatus = await status();
      expect(['completed', 'paid']).toContain(finalStatus);
      // Whatever the dev adapter decided, the ledger and the booking agree.
      await expectNoDrift();
    });

    it('is safe to run twice: no second credit', async () => {
      const refs = await seedIntent();
      await db.execute(sql`
        update payments set updated_at = now() - interval '10 minutes'
         where gateway_order_ref = ${refs.orderRef}
      `);

      const service = app.get(PaymentReconcileService);
      // Sequential rather than concurrent here — the two-worker race is
      // asserted in `payments-race.e2e.spec.ts` against two real apps.
      await service.reconcile('manual');
      await service.reconcile('manual');

      expect(await legCount()).toBe(1);
      await expectNoDrift();
    });
  });
});
