import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { rupeeStringToPaise } from '@towing/api-contracts';
import { createTestApp, customerAuthHeaderFor, driverAuthHeaderFor } from '../../test/app';
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
import { devCheckoutSignature, devPaymentRef } from './dev-payment.adapter';

/**
 * §9.2.4's ACCEPTANCE CRITERION, asserted rather than described.
 *
 * The plan's B2 verification line is: "the driver's displayed earnings
 * reconcile to the paisa against a direct ledger query — that assertion IS the
 * §9.2.4 acceptance criterion". So this file settles real bookings through the
 * real capture path and then compares what the API says against
 * `sum(wallet_transactions.amount)`, exactly.
 *
 * THE INDEPENDENT DRIVER IS THE POINT of running it twice. `earnings_daily` is
 * keyed `(fleet_id, day, driver_id)` with `fleet_id` NOT NULL, so an
 * independent driver has no cell in it at all — a projection-based design would
 * have returned zero here and passed every other test in the phase.
 */
describe('driver earnings e2e (§9.2.4 paisa reconciliation)', () => {
  let app: INestApplication;
  let db: TestDatabase;
  let secret: string;
  let customerId: string;
  let customerAuth: string;

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
    customerId = await seedCustomer(db, 'Earnings Customer');
    customerAuth = await customerAuthHeaderFor(app, { userId: customerId });
  });

  /** Books, completes and pays for a trip through the real routes. */
  const settleTrip = async (params: {
    driverId: string;
    fleetId?: string;
    total: string;
  }): Promise<string> => {
    const bookingId = await seedBooking(db, {
      userId: customerId,
      driverId: params.driverId,
      fleetId: params.fleetId ?? null,
      status: 'completed',
      total: params.total,
    });
    await db.execute(sql`
      update bookings set commission_band = 'A', commission_pct = 10
       where id = ${bookingId}::uuid
    `);

    const intent = await request(app.getHttpServer())
      .post(`/v1/payments/${bookingId}/intent`)
      .set('Authorization', customerAuth)
      .set('Idempotency-Key', randomUUID())
      .send({ purpose: 'booking' })
      .expect(201);

    const orderRef = intent.body.orderRef as string;
    const gatewayRef = devPaymentRef(orderRef);

    await request(app.getHttpServer())
      .post(`/v1/payments/${bookingId}/capture`)
      .set('Authorization', customerAuth)
      .set('Idempotency-Key', randomUUID())
      .send({ orderRef, gatewayRef, signature: devCheckoutSignature(orderRef, gatewayRef, secret) })
      .expect(200);

    return bookingId;
  };

  /** The direct ledger query the AC names. */
  const ledgerNetPaise = async (driverId: string): Promise<number> => {
    const [row] = (await db.execute(sql`
      select coalesce(sum(t.amount), 0)::text as net
        from wallet_transactions t
        join bookings b on b.id = t.ref_id
       where b.driver_id = ${driverId}::uuid
         and t.type in ('driver_share_credit', 'fare_credit')
    `)) as unknown as [{ net: string }];
    return rupeeStringToPaise(row.net);
  };

  const reconciles = async (driverId: string, label: string): Promise<void> => {
    const auth = await driverAuthHeaderFor(app, { driverId });

    const trips = await request(app.getHttpServer())
      .get('/v1/driver/earnings/trips?limit=50')
      .set('Authorization', auth)
      .expect(200);

    const summary = await request(app.getHttpServer())
      .get('/v1/driver/earnings')
      .set('Authorization', auth)
      .expect(200);

    const truth = await ledgerNetPaise(driverId);
    expect(truth, `${label}: the fixture credited nothing`).toBeGreaterThan(0);

    // EXACT, not approximate. Money is integer paise end to end.
    const displayed = trips.body.items.reduce(
      (sum: number, item: { driverSharePaise: number }) => sum + item.driverSharePaise,
      0,
    );
    expect(displayed, `${label}: per-trip feed`).toBe(truth);
    expect(summary.body.totals.netPaise, `${label}: summary`).toBe(truth);
    expect(summary.body.wallet.balancePaise, `${label}: wallet`).toBe(truth);

    // And PER ROW, so a compensating pair of errors cannot pass a total.
    for (const item of trips.body.items as Array<Record<string, number>>) {
      expect(item.grossPaise! - item.commissionPaise!).toBe(item.poolPaise);
      expect(item.driverSharePaise! + item.fleetSharePaise!).toBe(item.poolPaise);
    }
  };

  it('reconciles to the paisa for an INDEPENDENT driver', async () => {
    const driverId = await seedDriver(db, { name: 'Independent Driver' });

    await settleTrip({ driverId, total: '2000.00' });
    await settleTrip({ driverId, total: '1350.00' });
    // A deliberately awkward number: 10 % of ₹999.99 does not land on a rupee.
    await settleTrip({ driverId, total: '999.99' });

    await reconciles(driverId, 'independent');
  });

  it('reconciles to the paisa for a FLEET driver, showing only their half', async () => {
    const fleet = await seedFleet(db, 'Earnings Fleet');
    const driverId = await seedDriver(db, { fleetId: fleet.fleetId, name: 'Fleet Driver' });
    await db.execute(sql`
      insert into fleet_driver_shares (fleet_id, driver_id, driver_share, fleet_share)
      values (${fleet.fleetId}::uuid, ${driverId}::uuid, 70, 30)
    `);

    await settleTrip({ driverId, fleetId: fleet.fleetId, total: '2000.00' });
    await settleTrip({ driverId, fleetId: fleet.fleetId, total: '777.77' });

    await reconciles(driverId, 'fleet');

    // The driver must never be shown the fleet's half as their own.
    const auth = await driverAuthHeaderFor(app, { driverId });
    const trips = await request(app.getHttpServer())
      .get('/v1/driver/earnings/trips?limit=50')
      .set('Authorization', auth)
      .expect(200);

    for (const item of trips.body.items as Array<Record<string, number>>) {
      expect(item.fleetSharePaise).toBeGreaterThan(0);
      expect(item.driverSharePaise).toBeLessThan(item.poolPaise!);
    }
  });

  it('carries the §3.3 band and percentage on every trip', async () => {
    // §3.3's "driver transparency" clause: every completed trip shows gross,
    // commission % and net. A number with no band beside it is not a breakdown.
    const driverId = await seedDriver(db, { name: 'Transparent Driver' });
    await settleTrip({ driverId, total: '2000.00' });

    const auth = await driverAuthHeaderFor(app, { driverId });
    const trips = await request(app.getHttpServer())
      .get('/v1/driver/earnings/trips')
      .set('Authorization', auth)
      .expect(200);

    expect(trips.body.items[0]).toMatchObject({
      commissionBand: 'A',
      commissionPct: 10,
      grossPaise: 200_000,
      commissionPaise: 20_000,
      driverSharePaise: 180_000,
    });
  });

  it('shows an empty, honest zero for a driver who has earned nothing', async () => {
    const driverId = await seedDriver(db, { name: 'New Driver' });
    const auth = await driverAuthHeaderFor(app, { driverId });

    const summary = await request(app.getHttpServer())
      .get('/v1/driver/earnings')
      .set('Authorization', auth)
      .expect(200);

    // A driver with no wallet row at all — `LedgerService` creates them lazily
    // on first credit — must read as zero, not as an error.
    expect(summary.body.totals).toMatchObject({ jobs: 0, grossPaise: 0, netPaise: 0 });
    expect(summary.body.wallet.balancePaise).toBe(0);
    expect(summary.body.wallet.payoutAccountLinked).toBe(false);
  });

  it('serves a driver whose KYC is not approved', async () => {
    // DELIBERATE. §3.1's gate governs who may RECEIVE WORK; withholding money
    // already earned is a payout hold, and it belongs in Finance's queue where
    // a human takes it and `admin_actions` records it.
    const driverId = await seedDriver(db, { name: 'Suspended Driver', kycStatus: 'suspended' });
    await settleTrip({ driverId, total: '500.00' });

    const auth = await driverAuthHeaderFor(app, { driverId, kycStatus: 'suspended' });
    const summary = await request(app.getHttpServer())
      .get('/v1/driver/earnings')
      .set('Authorization', auth)
      .expect(200);

    expect(summary.body.totals.jobs).toBe(1);
  });

  it('the ledger feed carries every leg type, signed', async () => {
    const driverId = await seedDriver(db, { name: 'Feed Driver' });
    await settleTrip({ driverId, total: '1000.00' });

    const auth = await driverAuthHeaderFor(app, { driverId });
    const feed = await request(app.getHttpServer())
      .get('/v1/driver/wallet/transactions')
      .set('Authorization', auth)
      .expect(200);

    expect(feed.body.items).toHaveLength(1);
    expect(feed.body.items[0]).toMatchObject({ type: 'fare_credit', amountPaise: 90_000 });
  });
});
