import type { INestApplication } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { payouts } from '../../db/schema';
import { ledgerInvariants } from '../../db/ledger/invariants';
import { PAYMENT_GATEWAY, type PaymentGatewayPort } from '../money/payment-gateway.port';
import { adminAuthHeaderFor, createTestApp } from '../../test/app';
import { expectMatchesContract } from '../../test/contracts';
import {
  adminTransactionsResponseSchema,
  adminRefundsResponseSchema,
  adminLedgerResponseSchema,
  adminInvariantsResponseSchema,
  adminPayoutSlaResponseSchema,
  INVARIANT_KEYS,
} from '@towing/api-contracts';
import { seedAdmin, seedCustomer, seedDriver, setupTestDatabase, truncateAll } from '../../test/db';
import type { TestDatabase } from '../../test/db';
import { seedBooking, seedWalletWithLedger } from '../../test/fixtures';
import { closeTestRedis, flushTestRedis } from '../../test/redis';

/**
 * W9 — the finance console (§9.4.10): transactions, the ledger viewer,
 * refunds, reconciliation, the invariants panel and the payout SLA.
 *
 * What each block pins:
 * - **refunds**: the paisa-exact partial, the full refund's landing, and the
 *   ONE behaviour the console's required `Idempotency-Key` exists for — a
 *   double submit makes ONE gateway call and reports `replayed`.
 * - **ledger**: backwards-in-time cursor paging over signed legs, and the
 *   owner/type filters an investigator actually uses.
 * - **reconciliation**: one IST day as a signed, time-ordered file.
 * - **invariants**: the panel's five rows are the SAME query the nightly job
 *   asserts, and this spec proves the endpoint agrees while money moves.
 * - **role matrix**: `finance`/`super_admin` in, `operations` out — and the
 *   §14.2 unpaid-intervention route stays reachable to Ops on `finance.summary`
 *   (the "200 on summary" half of the work order's line).
 */
describe('W9 — admin finance console (/v1/admin/finance)', () => {
  let app: INestApplication;
  let db: TestDatabase;
  let adminAuth: string;
  let opsAuth: string;
  let adminId: string;
  let userId: string;
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
    const admin = await seedAdmin(db, { subRole: 'super_admin' });
    adminId = admin.id;
    adminAuth = await adminAuthHeaderFor(app, { adminId, subRole: 'super_admin' });

    const ops = await seedAdmin(db, { subRole: 'operations' });
    opsAuth = await adminAuthHeaderFor(app, { adminId: ops.id, subRole: 'operations' });

    userId = await seedCustomer(db, 'W9 Customer');
    driverId = await seedDriver(db, { name: 'W9 Driver' });
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

  const statusOf = async (bookingId: string): Promise<string> => {
    const [row] = (await db.execute(sql`
      select status from bookings where id = ${bookingId}::uuid
    `)) as unknown as [{ status: string }];
    return row.status;
  };

  /** The exact shape Phase 19's capture leaves behind (see refunds.e2e.spec). */
  async function seedPaidBooking(): Promise<string> {
    const bookingId = await seedBooking(db, {
      userId,
      driverId,
      status: 'paid',
      total: '1000.00',
      commissionAmount: '100.00',
      driverPayout: '900.00',
      pickupAddress: 'W9 pickup road',
    });
    await db.execute(sql`
      insert into payments (booking_id, amount, tax_amount, purpose, method, status,
                            idempotency_key, provider, gateway_ref)
      values (${bookingId}::uuid, 1000.00, 0, 'booking', 'upi', 'captured',
              ${`pay:v1:w9:${bookingId}`}, 'dev', ${`pay_dev_${bookingId.slice(0, 8)}`})
    `);
    await seedWalletWithLedger(db, { ownerType: 'driver', ownerId: driverId }, [
      { type: 'driver_share_credit', amount: '900.00', refId: bookingId },
    ]);
    return bookingId;
  }

  // ── transactions ───────────────────────────────────────────────────────────

  it('lists transactions with their booking code, refunded total and filters', async () => {
    const paid = await seedPaidBooking();
    const searching = await seedBooking(db, { userId, status: 'searching' });

    const response = await request(app.getHttpServer())
      .get('/v1/admin/finance/transactions?limit=50')
      .set('Authorization', adminAuth)
      .expect(200);
    expectMatchesContract(adminTransactionsResponseSchema, response.body);

    expect(response.body.total).toBe(1);
    const [row] = response.body.items;
    expect(row.bookingId).toBe(paid);
    expect(row.bookingCode).toBe(`TW-${paid.slice(0, 8).toUpperCase()}`);
    expect(row.status).toBe('captured');
    expect(row.amountPaise).toBe(100_000);
    expect(row.refundedAmountPaise).toBe(0);

    // The bookingless-search filter: a payment that never happened is absent,
    // and narrowing by capture day keeps it that way.
    const refundedOnly = await request(app.getHttpServer())
      .get('/v1/admin/finance/transactions?status=refunded')
      .set('Authorization', adminAuth)
      .expect(200);
    expect(refundedOnly.body.total).toBe(0);

    const q = await request(app.getHttpServer())
      .get('/v1/admin/finance/transactions?q=W9 pickup')
      .set('Authorization', adminAuth)
      .expect(200);
    expect(q.body.total).toBe(1);

    expect(searching).toBeTruthy();
  });

  // ── the ledger viewer ──────────────────────────────────────────────────────

  it('pages the ledger backwards in time with a cursor, over SIGNED legs', async () => {
    const HOUR = 3_600_000;
    await seedWalletWithLedger(db, { ownerType: 'driver', ownerId: driverId }, [
      { type: 'adjustment', amount: '100.00', createdAt: new Date(Date.now() - 3 * HOUR) },
      { type: 'driver_share_credit', amount: '200.00', createdAt: new Date(Date.now() - 2 * HOUR) },
      { type: 'refund_debit', amount: '-50.00', createdAt: new Date(Date.now() - 1 * HOUR) },
    ]);

    const first = await request(app.getHttpServer())
      .get('/v1/admin/finance/ledger?limit=2')
      .set('Authorization', adminAuth)
      .expect(200);
    expectMatchesContract(adminLedgerResponseSchema, first.body);
    expect(first.body.items).toHaveLength(2);
    // Newest first — the reading order for "what just happened".
    expect(first.body.items[0].amountPaise).toBe(-5_000);
    expect(first.body.items[0].type).toBe('refund_debit');
    expect(first.body.items[0].ownerName).toBe('W9 Driver');
    expect(first.body.nextCursor).toBeTruthy();

    const second = await request(app.getHttpServer())
      .get(`/v1/admin/finance/ledger?limit=2&cursor=${encodeURIComponent(first.body.nextCursor)}`)
      .set('Authorization', adminAuth)
      .expect(200);
    expect(second.body.items).toHaveLength(1);
    expect(second.body.items[0].amountPaise).toBe(10_000);
    expect(second.body.nextCursor).toBeNull();

    // The type filter is how an investigator reads one leg class at a time.
    const credits = await request(app.getHttpServer())
      .get('/v1/admin/finance/ledger?type=driver_share_credit')
      .set('Authorization', adminAuth)
      .expect(200);
    expect(credits.body.items).toHaveLength(1);
  });

  // ── refunds: issue, replay, partial ────────────────────────────────────────

  it('a full refund lands the booking and reverses the money — invariants zero', async () => {
    const bookingId = await seedPaidBooking();

    const response = await request(app.getHttpServer())
      .post('/v1/admin/finance/refunds')
      .set('Authorization', adminAuth)
      .set('Idempotency-Key', 'w9-full-1')
      .send({ bookingId, reason: 'Customer cancelled before the tow started' })
      .expect(200);

    expect(response.body.kind).toBe('full');
    expect(response.body.replayed).toBe(false);
    expect(response.body.amountPaise).toBe(100_000);
    expect(response.body.status).toBe('processed');

    // A8's landing: a refunded paid booking leaves `paid` for `disputed`
    // (`paid → cancelled` is not a legal edge, deliberately).
    expect(await statusOf(bookingId)).toBe('disputed');

    const [payment] = (await db.execute(sql`
      select status, refunded_amount::text as refunded from payments where booking_id = ${bookingId}::uuid
    `)) as unknown as [{ status: string; refunded: string }];
    expect(payment.status).toBe('refunded');
    expect(payment.refunded).toBe('1000.00');

    // The refunds list shows it, with the operator's words and the money.
    const list = await request(app.getHttpServer())
      .get('/v1/admin/finance/refunds')
      .set('Authorization', adminAuth)
      .expect(200);
    expectMatchesContract(adminRefundsResponseSchema, list.body);
    expect(list.body.total).toBe(1);
    expect(list.body.items[0].reason).toBe('Customer cancelled before the tow started');
    expect(list.body.items[0].initiatedBy).toBe(adminId);

    await expectNoDrift();
  });

  it('a double-submitted refund makes ONE gateway call and replays the response', async () => {
    const bookingId = await seedPaidBooking();
    const gateway = app.get<PaymentGatewayPort>(PAYMENT_GATEWAY);
    const refundSpy = vi.spyOn(gateway, 'refund');

    const body = { bookingId, reason: 'Duplicate submit from a flaky network' };
    const first = await request(app.getHttpServer())
      .post('/v1/admin/finance/refunds')
      .set('Authorization', adminAuth)
      .set('Idempotency-Key', 'w9-replay-1')
      .send(body)
      .expect(200);
    const second = await request(app.getHttpServer())
      .post('/v1/admin/finance/refunds')
      .set('Authorization', adminAuth)
      .set('Idempotency-Key', 'w9-replay-1')
      .send(body)
      .expect(200);

    expect(first.body.replayed).toBe(false);
    // The SECOND answer is the first response verbatim, flagged as a replay by
    // the global interceptor — the strongest form of "nothing moved twice":
    // the service was not even entered a second time.
    expect(second.headers['idempotency-replayed']).toBe('true');
    expect(second.body).toEqual(first.body);

    // The same key with DIFFERENT content is a client bug, refused rather
    // than replayed.
    await request(app.getHttpServer())
      .post('/v1/admin/finance/refunds')
      .set('Authorization', adminAuth)
      .set('Idempotency-Key', 'w9-replay-1')
      .send({ bookingId, reason: 'A different payload under the same key' })
      .expect(409);

    // A FRESH key on a fully refunded payment is a genuine second request, and
    // it is refused by the engine (nothing left to refund), not silently
    // honoured.
    await request(app.getHttpServer())
      .post('/v1/admin/finance/refunds')
      .set('Authorization', adminAuth)
      .set('Idempotency-Key', 'w9-replay-2')
      .send(body)
      .expect(409);

    expect(refundSpy).toHaveBeenCalledTimes(1);

    const [count] = (await db.execute(sql`
      select count(*)::int as n from refunds where booking_id = ${bookingId}::uuid
    `)) as unknown as [{ n: number }];
    expect(count.n).toBe(1);

    await expectNoDrift();
  });

  it('a partial refund keeps the booking paid and debits the liable party — invariants zero', async () => {
    const bookingId = await seedPaidBooking();

    const response = await request(app.getHttpServer())
      .post('/v1/admin/finance/refunds')
      .set('Authorization', adminAuth)
      .set('Idempotency-Key', 'w9-partial-1')
      .send({
        bookingId,
        amountPaise: 30_000,
        liability: 'driver',
        reason: 'Overcharge on distance',
      })
      .expect(200);

    expect(response.body.kind).toBe('partial');
    expect(response.body.amountPaise).toBe(30_000);

    // The whole point of a partial: the booking does not move.
    expect(await statusOf(bookingId)).toBe('paid');

    const [payment] = (await db.execute(sql`
      select status, refunded_amount::text as refunded from payments where booking_id = ${bookingId}::uuid
    `)) as unknown as [{ status: string; refunded: string }];
    expect(payment.status).toBe('captured');
    expect(payment.refunded).toBe('300.00');

    // Beyond what is left on the payment: refused BEFORE the gateway.
    await request(app.getHttpServer())
      .post('/v1/admin/finance/refunds')
      .set('Authorization', adminAuth)
      .set('Idempotency-Key', 'w9-partial-over')
      .send({ bookingId, amountPaise: 999_000, liability: 'driver', reason: 'Too much' })
      .expect(422);

    await expectNoDrift();
  });

  it('refuses a refund without an Idempotency-Key', async () => {
    const bookingId = await seedPaidBooking();
    // 422, the house's validation status (the request parsed; its shape is
    // wrong) — `@IdempotencyKey()` refuses before the service is reached.
    const response = await request(app.getHttpServer())
      .post('/v1/admin/finance/refunds')
      .set('Authorization', adminAuth)
      .send({ bookingId, reason: 'No key supplied at all' })
      .expect(422);
    expect(response.body.error.message).toMatch(/Idempotency-Key/);
  });

  // ── invariants panel ───────────────────────────────────────────────────────

  it('serves the five invariants, all zero, after money has moved', async () => {
    const bookingId = await seedPaidBooking();
    await request(app.getHttpServer())
      .post('/v1/admin/finance/refunds')
      .set('Authorization', adminAuth)
      .set('Idempotency-Key', 'w9-invariants-1')
      .send({ bookingId, amountPaise: 20_000, liability: 'driver', reason: 'Goodwill adjustment' })
      .expect(200);

    const response = await request(app.getHttpServer())
      .get('/v1/admin/finance/invariants')
      .set('Authorization', adminAuth)
      .expect(200);
    expectMatchesContract(adminInvariantsResponseSchema, response.body);

    expect(response.body.ok).toBe(true);
    expect(response.body.invariants.map((entry: { key: string }) => entry.key)).toEqual([
      ...INVARIANT_KEYS,
    ]);
    for (const entry of response.body.invariants) expect(entry.drift).toBe(0);
    expect(response.body.driftedWallets).toEqual([]);
  });

  // ── payout SLA ─────────────────────────────────────────────────────────────

  it('reports the payout SLA over the window, including the past-24h queue', async () => {
    const HOUR = 3_600_000;
    // Two payees: `uq_payouts_one_open_per_owner` allows one OPEN payout per
    // owner, and both rows below are non-terminal by design (one pending, one
    // approved-but-not-yet-paid).
    const secondDriverId = await seedDriver(db, { name: 'W9 Driver Two' });
    await db.insert(payouts).values({
      ownerId: driverId,
      ownerType: 'driver',
      amount: '500.00',
      status: 'requested',
      approvalState: 'pending_approval',
      requestedAt: new Date(Date.now() - 30 * HOUR),
    });
    await db.insert(payouts).values({
      ownerId: secondDriverId,
      ownerType: 'driver',
      amount: '250.00',
      status: 'requested',
      approvalState: 'approved',
      approvedBy: adminId,
      requestedAt: new Date(Date.now() - 2 * HOUR),
      approvedAt: new Date(Date.now() - 1 * HOUR),
    });

    const response = await request(app.getHttpServer())
      .get('/v1/admin/finance/payouts/sla?windowDays=30')
      .set('Authorization', adminAuth)
      .expect(200);
    expectMatchesContract(adminPayoutSlaResponseSchema, response.body);

    expect(response.body.decided).toBe(1);
    expect(response.body.p50Minutes).toBeCloseTo(60, 0);
    expect(response.body.breaches24h).toBe(0);
    // The pending one has waited 30 h — the number that should page somebody.
    expect(response.body.pendingOver24h).toBe(1);
  });

  // ── reconciliation ─────────────────────────────────────────────────────────

  it('streams one IST day as a signed, time-ordered CSV', async () => {
    const bookingId = await seedPaidBooking();
    await request(app.getHttpServer())
      .post('/v1/admin/finance/refunds')
      .set('Authorization', adminAuth)
      .set('Idempotency-Key', 'w9-csv-1')
      .send({ bookingId, amountPaise: 25_000, liability: 'driver', reason: 'CSV coverage refund' })
      .expect(200);

    const istDay = new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);
    const response = await request(app.getHttpServer())
      .get(`/v1/admin/finance/reconciliation.csv?date=${istDay}`)
      .set('Authorization', adminAuth)
      .expect(200);

    expect(response.headers['content-type']).toContain('text/csv');
    const lines = String(response.text).trim().split('\n');
    expect(lines[0]).toBe('kind,ref,booking_code,amount_paise,status,method,gateway_ref,at,note');

    const paymentRow = lines.find((line) => line.startsWith('payment,'));
    expect(paymentRow).toBeDefined();
    expect(paymentRow).toContain(`TW-${bookingId.slice(0, 8).toUpperCase()}`);
    expect(paymentRow).toContain('100000');

    // Refund rows are NEGATIVE — the day's net needs no second sheet.
    const refundRow = lines.find((line) => line.startsWith('refund,'));
    expect(refundRow).toBeDefined();
    expect(refundRow).toContain('-25000');
  });

  // ── role matrix ────────────────────────────────────────────────────────────

  it('keeps operations out of the ledger (403) while the §14.2 summary route stays open', async () => {
    const bookingId = await seedPaidBooking();

    await request(app.getHttpServer())
      .get('/v1/admin/finance/ledger')
      .set('Authorization', opsAuth)
      .expect(403);
    await request(app.getHttpServer())
      .get('/v1/admin/finance/transactions')
      .set('Authorization', opsAuth)
      .expect(403);
    await request(app.getHttpServer())
      .get('/v1/admin/finance/invariants')
      .set('Authorization', opsAuth)
      .expect(403);
    await request(app.getHttpServer())
      .post('/v1/admin/finance/refunds')
      .set('Authorization', opsAuth)
      .set('Idempotency-Key', 'w9-ops-1')
      .send({ bookingId, reason: 'Ops must not refund' })
      .expect(403);

    // The work order's other half: `finance.summary` is an OPS permission, and
    // W8's unpaid-intervention recheck is where Ops legitimately touches money
    // state — it asks the gateway, it moves nothing.
    await request(app.getHttpServer())
      .post(`/v1/admin/bookings/${bookingId}/payment/recheck`)
      .set('Authorization', opsAuth)
      .expect(200);
  });
});
