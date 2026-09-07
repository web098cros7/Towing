import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp } from '../../test/app';
import {
  seedCustomer,
  seedDriver,
  setupTestDatabase,
  truncateAll,
  type TestDatabase,
} from '../../test/db';
import { seedBooking } from '../../test/fixtures';
import { ledgerInvariants } from '../../db/ledger/invariants';
import { closeTestRedis, testRedis } from '../../test/redis';
import { devPaymentRef } from './dev-payment.adapter';
import { PaymentReconcileService } from './payment-reconcile.service';
import { paymentCaptureLockKey } from '../../redis/redis.constants';

/**
 * TWO WORKERS, ONE UNCAPTURED PAYMENT.
 *
 * This is the assertion the whole §19.3 design exists for, and it is the reason
 * the sweep is a BullMQ repeatable rather than a `setInterval` or an
 * `@nestjs/schedule` cron: implemented either of those ways it runs N times
 * concurrently across N Fargate tasks against the same payment, which is the
 * double-credit failure mode Phase 17 already refuses to accept for offers.
 *
 * TWO REAL NEST APPS against one Postgres and one Redis — the arrangement that
 * makes the count mean something. One app racing itself proves only that
 * JavaScript is single-threaded.
 *
 * The second half is the part worth having. The first test proves the Redis
 * lock works; the second DELETES THE LOCK MID-FLIGHT and asserts the same
 * outcome, which is what makes the lock an OPTIMISATION rather than a
 * correctness dependency — and therefore what justifies the capture route
 * proceeding without it when Redis is down (§19.2 never says a degraded cache
 * stops payments).
 */
describe('two workers racing one payment', () => {
  let a: INestApplication;
  let b: INestApplication;
  let db: TestDatabase;
  let bookingId: string;

  beforeAll(async () => {
    db = await setupTestDatabase();
    a = await createTestApp();
    b = await createTestApp();
  });

  afterAll(async () => {
    await a.close();
    await b.close();
    await closeTestRedis();
  });

  beforeEach(async () => {
    await truncateAll();
    const userId = await seedCustomer(db, 'Race Customer');
    const driverId = await seedDriver(db, { name: 'Race Driver' });
    bookingId = await seedBooking(db, {
      userId,
      driverId,
      status: 'completed',
      total: '3000.00',
    });
    await db.execute(sql`
      update bookings set commission_band = 'A', commission_pct = 10
       where id = ${bookingId}::uuid
    `);
  });

  const seedStaleIntent = async (): Promise<string> => {
    const orderRef = `order_dev_${Date.now().toString(36)}_${randomUUID().slice(0, 8)}`;
    await db.execute(sql`
      insert into payments (booking_id, amount, tax_amount, purpose, method, status,
                            idempotency_key, provider, gateway_order_ref, updated_at)
      values (${bookingId}::uuid, 3000.00, 0, 'booking', 'upi', 'pending',
              ${`pay:v1:${bookingId}:booking:${randomUUID()}`}, 'dev', ${orderRef},
              now() - interval '10 minutes')
    `);
    return devPaymentRef(orderRef);
  };

  const counts = async (): Promise<{ legs: number; paidRows: number; status: string }> => {
    const [legs] = (await db.execute(sql`
      select count(*)::int as count from wallet_transactions where ref_id = ${bookingId}::uuid
    `)) as unknown as [{ count: number }];
    const [history] = (await db.execute(sql`
      select count(*)::int as count from booking_status_history
       where booking_id = ${bookingId}::uuid and status = 'paid'
    `)) as unknown as [{ count: number }];
    const [booking] = (await db.execute(sql`
      select status from bookings where id = ${bookingId}::uuid
    `)) as unknown as [{ status: string }];

    return { legs: legs.count, paidRows: history.count, status: booking.status };
  };

  const expectSettledExactlyOnce = async (): Promise<void> => {
    const result = await counts();
    expect(result.status).toBe('paid');
    // ONE leg, ONE history row. Everything else in this file is scaffolding for
    // these two numbers.
    expect(result.legs).toBe(1);
    expect(result.paidRows).toBe(1);

    await expect(ledgerInvariants(db)).resolves.toEqual({
      walletDrift: 0,
      bookingDrift: 0,
      ledgerDrift: 0,
      reversalDrift: 0,
      couponDrift: 0,
    });
  };

  it('both sweeps run concurrently and settle it exactly once', async () => {
    await seedStaleIntent();

    await Promise.all([
      a.get(PaymentReconcileService).reconcile('manual'),
      b.get(PaymentReconcileService).reconcile('manual'),
    ]);

    await expectSettledExactlyOnce();
  });

  it('still settles exactly once with the Redis lock DELETED mid-flight', async () => {
    await seedStaleIntent();

    const redis = testRedis();
    const key = paymentCaptureLockKey(bookingId);

    // Hammer the key away while both sweeps run, so whichever worker holds it
    // loses it and the other can take it — simulating an expiry, an eviction,
    // or a Redis that is simply not there. What must hold is what holds without
    // Redis at all: `uq_payments_one_captured_per_booking`, the state machine's
    // FOR UPDATE legality check, and the `bk:v1:*` ledger keys.
    const chaos = setInterval(() => {
      void redis.del(key).catch(() => undefined);
    }, 1);

    try {
      await Promise.all([
        a.get(PaymentReconcileService).reconcile('manual'),
        b.get(PaymentReconcileService).reconcile('manual'),
      ]);
    } finally {
      clearInterval(chaos);
    }

    await expectSettledExactlyOnce();
  });

  it('a third sweep after settlement is a no-op', async () => {
    await seedStaleIntent();
    await a.get(PaymentReconcileService).reconcile('manual');
    await b.get(PaymentReconcileService).reconcile('manual');
    await a.get(PaymentReconcileService).reconcile('manual');

    await expectSettledExactlyOnce();
  });
});
