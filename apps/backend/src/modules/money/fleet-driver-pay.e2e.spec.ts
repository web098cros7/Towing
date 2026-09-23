import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { authHeaderFor, createTestApp, customerAuthHeaderFor } from '../../test/app';
import { ENV, type Env } from '../../config/env';
import {
  seedCustomer,
  seedDriver,
  seedFleet,
  setupTestDatabase,
  truncateAll,
  type TestDatabase,
} from '../../test/db';
import { seedBooking } from '../../test/fixtures';
import { ledgerInvariants } from '../../db/ledger/invariants';
import { devCheckoutSignature, devPaymentRef } from './dev-payment.adapter';

/**
 * A fleet owner decides how their drivers are paid (0042, Ehsan 24 Sep): a
 * share of each job, or a salary with the fleet keeping the payout.
 *
 * Every case pays for a real trip through the customer's API (intent, then the
 * dev gateway's capture) and reads the ledger legs settlement actually wrote:
 * ₹1,000 trip, 10 % commission, a ₹900 payout to split.
 */
describe('fleet driver pay (0042)', () => {
  let app: INestApplication;
  let db: TestDatabase;
  let secret: string;
  let fleetId: string;
  let fleetAuth: string;
  let driverId: string;

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
    const fleet = await seedFleet(db, 'Pay Fleet');
    fleetId = fleet.fleetId;
    fleetAuth = await authHeaderFor(app, { userId: fleet.ownerId, fleetId });
    // Invited the ordinary way: no `fleet_driver_shares` row, as every real
    // invite produced before 0042.
    driverId = await seedDriver(db, { fleetId, name: 'Fleet Driver' });
  });

  /** A completed trip paid by its customer; returns the settlement legs by owner. */
  async function payFor(bookingPatch?: { payModel: string; sharePct: string | null }) {
    const userId = await seedCustomer(db);
    const bookingId = await seedBooking(db, {
      userId,
      fleetId,
      driverId,
      status: 'completed',
      total: '1000.00',
    });
    await db.execute(sql`
      update bookings set commission_band = 'A', commission_pct = 10,
             driver_pay_model = ${bookingPatch?.payModel ?? null},
             driver_share_pct = ${bookingPatch?.sharePct ?? null}::numeric
       where id = ${bookingId}::uuid
    `);
    const auth = await customerAuthHeaderFor(app, { userId });
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

    const legs = (await db.execute(sql`
      select w.owner_type, t.type, t.amount::text as amount
        from wallet_transactions t join wallets w on w.id = t.wallet_id
       where t.ref_id = ${bookingId}::uuid
         and t.type in ('driver_share_credit', 'fleet_share_credit', 'fare_credit')
       order by w.owner_type
    `)) as unknown as Array<{ owner_type: string; type: string; amount: string }>;
    return legs.map((leg) => `${leg.owner_type}:${leg.type}:${leg.amount}`);
  }

  const setPay = (model: 'share' | 'salary', driverSharePct: number) =>
    request(app.getHttpServer())
      .put('/v1/fleet/settings/driver-pay')
      .set('Authorization', fleetAuth)
      .send({ model, driverSharePct });

  it("pays an invited driver the fleet's default share, not 0 %", async () => {
    // THE BUG THIS CLOSES: with no per-driver row, settlement paid the driver
    // 0 % and the fleet everything, while the offer had shown the driver the
    // whole payout. The fleet's default (80, spec §14.3) now applies.
    expect(await payFor()).toEqual([
      'driver:driver_share_credit:720.00',
      'fleet:fleet_share_credit:180.00',
    ]);
    await expect(ledgerInvariants(db)).resolves.toMatchObject({ ledgerDrift: 0, walletDrift: 0 });
  });

  it('pays a salaried fleet the whole payout and the driver nothing per job', async () => {
    const res = await setPay('salary', 80).expect(200);
    expect(res.body.driverPay).toEqual({ model: 'salary', driverSharePct: 80 });

    expect(await payFor()).toEqual(['fleet:fleet_share_credit:900.00']);
  });

  it("honours the owner's override for one driver, and clearing it restores the default", async () => {
    await request(app.getHttpServer())
      .put(`/v1/fleet/drivers/${driverId}/share`)
      .set('Authorization', fleetAuth)
      .send({ driverSharePct: 60 })
      .expect(200);
    const panel = await request(app.getHttpServer())
      .get(`/v1/fleet/drivers/${driverId}/performance`)
      .set('Authorization', fleetAuth)
      .expect(200);
    expect(panel.body.pay).toEqual({ model: 'share', fleetDefaultPct: 80, overridePct: 60 });
    expect(await payFor()).toEqual([
      'driver:driver_share_credit:540.00',
      'fleet:fleet_share_credit:360.00',
    ]);

    await request(app.getHttpServer())
      .put(`/v1/fleet/drivers/${driverId}/share`)
      .set('Authorization', fleetAuth)
      .send({ driverSharePct: null })
      .expect(200);
    expect(await payFor()).toEqual([
      'driver:driver_share_credit:720.00',
      'fleet:fleet_share_credit:180.00',
    ]);
  });

  it('pays what was locked when the driver accepted, even if the owner changes it after', async () => {
    // The booking carries the terms acceptance locked (50 %). The owner then
    // switches the fleet to salary; this job still pays the driver half.
    await setPay('salary', 80).expect(200);
    expect(await payFor({ payModel: 'share', sharePct: '50' })).toEqual([
      'driver:driver_share_credit:450.00',
      'fleet:fleet_share_credit:450.00',
    ]);
  });

  it("refuses to set another fleet's driver's share, and bad values", async () => {
    const other = await seedFleet(db, 'Other Fleet');
    const theirDriver = await seedDriver(db, { fleetId: other.fleetId });
    await request(app.getHttpServer())
      .put(`/v1/fleet/drivers/${theirDriver}/share`)
      .set('Authorization', fleetAuth)
      .send({ driverSharePct: 50 })
      .expect(404);
    await setPay('share', 120).expect(422);
  });
});
