import type { INestApplication } from '@nestjs/common';
import { adminDisputeDetailSchema } from '@towing/api-contracts';
import { eq, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { adminActions, bookings } from '../../db/schema';
import { ledgerInvariants } from '../../db/ledger/invariants';
import { adminAuthHeaderFor, createTestApp } from '../../test/app';
import { expectMatchesContract } from '../../test/contracts';
import { seedAdmin, seedCustomer, seedDriver, setupTestDatabase, truncateAll } from '../../test/db';
import type { TestDatabase } from '../../test/db';
import { seedBooking, seedWalletWithLedger } from '../../test/fixtures';
import { closeTestRedis, flushTestRedis } from '../../test/redis';

/**
 * W8 — the dispute lifecycle and THE FIVE EXITS (§9.4.7).
 *
 * Every exit test asserts all five ledger invariants are zero, because every
 * exit is a money path even when it moves nothing: `uphold_charge`'s job is to
 * prove the guard held, and the two refund exits post compensating legs.
 *
 * The A9 test at the bottom is the one the M0 fix-up wrote the guard for: a
 * dispute claiming to come from `paid` on a booking that never settled must NOT
 * be resolvable to `paid` — `transition()` refuses it inside the state machine
 * and the resolver cannot bypass it.
 */
describe('W8 — disputes (/v1/admin/disputes)', () => {
  let app: INestApplication;
  let db: TestDatabase;
  let adminAuth: string;
  let adminId: string;

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

  const bookingStatus = async (bookingId: string): Promise<string> => {
    const [row] = (await db.execute(sql`
      select status from bookings where id = ${bookingId}::uuid
    `)) as unknown as [{ status: string }];
    return row.status;
  };

  /**
   * A settled paid booking — the origin every money exit is defined for:
   * a captured payment and the driver's settlement credit leg, which is what
   * A9's guard checks before any `disputed → paid` transition.
   */
  async function seedSettledPaid(params: { baseFare?: string } = {}): Promise<{
    bookingId: string;
    driverId: string;
    userId: string;
  }> {
    const userId = await seedCustomer(db, 'Dispute Customer');
    const driverId = await seedDriver(db, { name: 'Dispute Driver' });
    const bookingId = await seedBooking(db, {
      userId,
      driverId,
      status: 'paid',
      total: '1000.00',
      commissionAmount: '100.00',
      driverPayout: '900.00',
    });
    if (params.baseFare) {
      await db
        .update(bookings)
        .set({ baseFare: params.baseFare })
        .where(eq(bookings.id, bookingId));
    }
    await db.execute(sql`
      insert into payments (booking_id, amount, tax_amount, purpose, method, status,
                            idempotency_key, provider, gateway_ref)
      values (${bookingId}::uuid, 1000.00, 0, 'booking', 'upi', 'captured',
              ${`pay:v1:test:${bookingId}:${randomUUID()}`}, 'dev', ${`pay_dev_${randomUUID().slice(0, 8)}`})
    `);
    await seedWalletWithLedger(db, { ownerType: 'driver', ownerId: driverId }, [
      { type: 'driver_share_credit', amount: '900.00', refId: bookingId },
    ]);
    return { bookingId, driverId, userId };
  }

  /** An unsettled in_progress trip — the origin the two no-charge exits are for. */
  async function seedInProgress(): Promise<{
    bookingId: string;
    driverId: string;
    userId: string;
  }> {
    const userId = await seedCustomer(db, 'In Progress Customer');
    const driverId = await seedDriver(db, { name: 'In Progress Driver' });
    const bookingId = await seedBooking(db, {
      userId,
      driverId,
      status: 'in_progress',
      total: '1000.00',
    });
    await db
      .update(bookings)
      .set({
        baseFare: '500.00',
        arrivedAt: new Date(Date.now() - 30 * 60_000),
        startedAt: new Date(Date.now() - 10 * 60_000),
        waitingFreeMinutes: 15,
        waitingPerMinute: '2.00',
      })
      .where(eq(bookings.id, bookingId));
    return { bookingId, driverId, userId };
  }

  async function open(bookingId: string, reasonCode = 'other'): Promise<string> {
    const res = await request(app.getHttpServer())
      .post(`/v1/admin/bookings/${bookingId}/dispute`)
      .set('Authorization', adminAuth)
      .send({ reasonCode, description: 'customer says the fare is wrong' })
      .expect(200);
    return res.body.disputeId as string;
  }

  // -------------------------------------------------------------------------
  // Open + queue + lifecycle
  // -------------------------------------------------------------------------

  it('opens a dispute — the only path to DISPUTED — and refuses a second one', async () => {
    const { bookingId } = await seedSettledPaid();

    const disputeId = await open(bookingId, 'overcharge');
    expect(await bookingStatus(bookingId)).toBe('disputed');

    const [row] = (await db.execute(sql`
      select opened_from_status, opened_by_type, opened_by_id, status
        from disputes where id = ${disputeId}::uuid
    `)) as unknown as [
      { opened_from_status: string; opened_by_type: string; opened_by_id: string; status: string },
    ];
    expect(row).toEqual({
      opened_from_status: 'paid',
      opened_by_type: 'admin',
      opened_by_id: adminId,
      status: 'open',
    });

    const actions = await db.select({ action: adminActions.action }).from(adminActions);
    expect(actions.map((entry) => entry.action)).toContain('dispute.open');

    await request(app.getHttpServer())
      .post(`/v1/admin/bookings/${bookingId}/dispute`)
      .set('Authorization', adminAuth)
      .send({ reasonCode: 'other', description: 'again' })
      .expect(409);
  });

  it('refuses to open from a status with no defined exit', async () => {
    const userId = await seedCustomer(db, 'Searching Customer');
    const bookingId = await seedBooking(db, { userId, status: 'searching' });

    const res = await request(app.getHttpServer())
      .post(`/v1/admin/bookings/${bookingId}/dispute`)
      .set('Authorization', adminAuth)
      .send({ reasonCode: 'other', description: 'premature' })
      .expect(409);
    expect(res.body.error.code).toBe('invalid_booking_state');
    expect(await bookingStatus(bookingId)).toBe('searching');
  });

  it('queues, filters and serves the detail against its contract', async () => {
    const { bookingId } = await seedSettledPaid();
    const disputeId = await open(bookingId, 'driver_conduct');

    const queue = await request(app.getHttpServer())
      .get('/v1/admin/disputes?status=open')
      .set('Authorization', adminAuth)
      .expect(200);
    expect(queue.body.total).toBe(1);
    expect(queue.body.items[0]).toMatchObject({
      id: disputeId,
      bookingId,
      reasonCode: 'driver_conduct',
    });
    expect(queue.body.items[0].booking.status).toBe('disputed');

    const detail = await request(app.getHttpServer())
      .get(`/v1/admin/disputes/${disputeId}`)
      .set('Authorization', adminAuth)
      .expect(200);
    expectMatchesContract(adminDisputeDetailSchema, detail.body);

    const empty = await request(app.getHttpServer())
      .get('/v1/admin/disputes?status=resolved')
      .set('Authorization', adminAuth)
      .expect(200);
    expect(empty.body.total).toBe(0);
  });

  it('assigns (open → under_review), notes, and stores confirmed evidence', async () => {
    const { bookingId } = await seedSettledPaid();
    const disputeId = await open(bookingId);

    const assigned = await request(app.getHttpServer())
      .post(`/v1/admin/disputes/${disputeId}/assign`)
      .set('Authorization', adminAuth)
      .send({})
      .expect(200);
    expect(assigned.body).toMatchObject({ status: 'under_review', assignedAdminId: adminId });

    await request(app.getHttpServer())
      .post(`/v1/admin/disputes/${disputeId}/note`)
      .set('Authorization', adminAuth)
      .send({ note: 'spoke to the customer, waiting on the garage invoice' })
      .expect(200);

    // Evidence rides the presign → upload → confirm shape, like KYC documents.
    const presign = await request(app.getHttpServer())
      .post(`/v1/admin/disputes/${disputeId}/evidence/presign`)
      .set('Authorization', adminAuth)
      .expect(200);
    const { pathname, search } = new URL(presign.body.uploadUrl as string);
    await request(app.getHttpServer())
      .put(`${pathname}${search}`)
      .set('Content-Type', 'application/octet-stream')
      .send(Buffer.from('evidence-bytes'))
      .expect(204);

    const confirmed = await request(app.getHttpServer())
      .post(`/v1/admin/disputes/${disputeId}/evidence`)
      .set('Authorization', adminAuth)
      .send({ key: presign.body.key, kind: 'photo', note: 'damage close-up' })
      .expect(200);
    expect(confirmed.body.url).toBeTruthy();

    // A key minted for a different dispute is refused.
    const other = await open((await seedSettledPaid()).bookingId);
    const otherPresign = await request(app.getHttpServer())
      .post(`/v1/admin/disputes/${other}/evidence/presign`)
      .set('Authorization', adminAuth)
      .expect(200);
    await request(app.getHttpServer())
      .post(`/v1/admin/disputes/${disputeId}/evidence`)
      .set('Authorization', adminAuth)
      .send({ key: otherPresign.body.key, kind: 'photo' })
      .expect(422);

    const detail = await request(app.getHttpServer())
      .get(`/v1/admin/disputes/${disputeId}`)
      .set('Authorization', adminAuth)
      .expect(200);
    expect(detail.body.evidence).toHaveLength(1);
    expect(detail.body.evidence[0]).toMatchObject({ kind: 'photo', note: 'damage close-up' });
  });

  // -------------------------------------------------------------------------
  // The five exits
  // -------------------------------------------------------------------------

  it('exit 1: complete_and_charge — the trip is finished through the real completion service', async () => {
    const { bookingId } = await seedInProgress();
    const disputeId = await open(bookingId, 'service_not_completed');

    const res = await request(app.getHttpServer())
      .post(`/v1/admin/disputes/${disputeId}/resolve`)
      .set('Authorization', adminAuth)
      .send({ resolution: 'complete_and_charge', note: 'trip did complete — call records agree' })
      .expect(200);

    expect(res.body).toMatchObject({
      status: 'resolved',
      resolution: 'complete_and_charge',
      bookingStatus: 'completed',
      refundId: null,
    });
    expect(await bookingStatus(bookingId)).toBe('completed');

    // §7.4's waiting charge billed from the snapshot (20 min waited, 15 free, ₹2/min).
    const [booking] = (await db.execute(sql`
      select waiting_charge::text as waiting, total::text as total
        from bookings where id = ${bookingId}::uuid
    `)) as unknown as [{ waiting: string; total: string }];
    expect(booking).toEqual({ waiting: '10.00', total: '1010.00' });

    await expectNoDrift();
  });

  it('exit 2: cancel_no_charge — no capture, the open intent is failed, comp is optional', async () => {
    const { bookingId } = await seedInProgress();
    await db.execute(sql`
      insert into payments (booking_id, amount, tax_amount, purpose, method, status,
                            idempotency_key, provider, gateway_order_ref)
      values (${bookingId}::uuid, 500.00, 0, 'booking', 'upi', 'pending',
              ${`pay:v1:test:${bookingId}:intent`}, 'dev', 'order_still_open')
    `);
    const disputeId = await open(bookingId, 'unable_to_deliver');

    const res = await request(app.getHttpServer())
      .post(`/v1/admin/disputes/${disputeId}/resolve`)
      .set('Authorization', adminAuth)
      .send({
        resolution: 'cancel_no_charge',
        note: 'tow never happened — nobody pays',
        compensateDriver: true,
      })
      .expect(200);

    expect(res.body).toMatchObject({
      resolution: 'cancel_no_charge',
      bookingStatus: 'cancelled',
      refundId: null,
    });
    expect(await bookingStatus(bookingId)).toBe('cancelled');

    const [payment] = (await db.execute(sql`
      select status, failure_reason from payments where booking_id = ${bookingId}::uuid
    `)) as unknown as [{ status: string; failure_reason: string }];
    expect(payment.status).toBe('failed');
    expect(payment.failure_reason).toContain('without charge');

    // Platform compensation: §3.5's default share of the base fare, an adjustment leg.
    const [leg] = (await db.execute(sql`
      select type, amount::text as amount from wallet_transactions
       where ref_id = ${bookingId}::uuid
    `)) as unknown as [{ type: string; amount: string }];
    expect(leg).toEqual({ type: 'adjustment', amount: '250.00' });

    await expectNoDrift();
  });

  it('exit 3: uphold_charge — nothing moves, and the booking goes back to paid', async () => {
    const { bookingId } = await seedSettledPaid();
    const disputeId = await open(bookingId, 'overcharge');

    const res = await request(app.getHttpServer())
      .post(`/v1/admin/disputes/${disputeId}/resolve`)
      .set('Authorization', adminAuth)
      .send({ resolution: 'uphold_charge', note: 'meter and slab both check out' })
      .expect(200);

    expect(res.body).toMatchObject({
      resolution: 'uphold_charge',
      bookingStatus: 'paid',
      refundId: null,
    });
    expect(await bookingStatus(bookingId)).toBe('paid');

    const [refunds] = (await db.execute(sql`
      select count(*)::int as n from refunds where booking_id = ${bookingId}::uuid
    `)) as unknown as [{ n: number }];
    expect(refunds.n).toBe(0);

    await expectNoDrift();
  });

  it('exit 3b (A9): uphold_charge on a never-settled booking is refused', async () => {
    const userId = await seedCustomer(db, 'Unsettled Customer');
    const bookingId = await seedBooking(db, { userId, status: 'completed' });
    // The lie a corrupt or historical row could carry: a dispute claiming the
    // paid origin on a booking with no capture behind it.
    await db.execute(sql`
      insert into disputes (booking_id, opened_by_type, opened_by_id, reason_code, description,
                            status, opened_from_status)
      values (${bookingId}::uuid, 'admin', ${adminId}::uuid, 'overcharge', 'seeded',
              'open', 'paid')
    `);
    const [dispute] = (await db.execute(sql`
      select id from disputes where booking_id = ${bookingId}::uuid
    `)) as unknown as [{ id: string }];
    await db.execute(sql`
      update bookings set status = 'disputed' where id = ${bookingId}::uuid
    `);

    const res = await request(app.getHttpServer())
      .post(`/v1/admin/disputes/${dispute.id}/resolve`)
      .set('Authorization', adminAuth)
      .send({ resolution: 'uphold_charge', note: 'let it through' })
      .expect(409);
    expect(res.body.error.code).toBe('dispute_not_settled');

    expect(await bookingStatus(bookingId)).toBe('disputed');
    await expectNoDrift();
  });

  it('exit 4: full_refund — the reversal lands, dispute-keyed, and a second resolve is refused', async () => {
    const { bookingId } = await seedSettledPaid();
    const disputeId = await open(bookingId, 'service_not_completed');

    const res = await request(app.getHttpServer())
      .post(`/v1/admin/disputes/${disputeId}/resolve`)
      .set('Authorization', adminAuth)
      .send({ resolution: 'full_refund', note: 'full reversal agreed with the customer' })
      .expect(200);

    expect(res.body).toMatchObject({
      resolution: 'full_refund',
      bookingStatus: 'cancelled',
      refundAmountPaise: 100_000,
    });
    expect(await bookingStatus(bookingId)).toBe('cancelled');

    const [refund] = (await db.execute(sql`
      select kind, dispute_id, idempotency_key from refunds where booking_id = ${bookingId}::uuid
    `)) as unknown as [{ kind: string; dispute_id: string; idempotency_key: string }];
    expect(refund.kind).toBe('full');
    expect(refund.dispute_id).toBe(disputeId);
    expect(refund.idempotency_key).toBe(`rf:v2:${bookingId}:full:dispute:${disputeId}`);

    const [payment] = (await db.execute(sql`
      select status, refunded_amount::text as refunded from payments
       where booking_id = ${bookingId}::uuid
    `)) as unknown as [{ status: string; refunded: string }];
    expect(payment).toEqual({ status: 'refunded', refunded: '1000.00' });

    // The dispute row records the money it ordered.
    const [row] = (await db.execute(sql`
      select refund_id, refund_amount::text as amount, resolved_by from disputes
       where id = ${disputeId}::uuid
    `)) as unknown as [{ refund_id: string; amount: string; resolved_by: string }];
    expect(row.refund_id).toBeTruthy();
    expect(row.amount).toBe('1000.00');
    expect(row.resolved_by).toBe(adminId);

    await request(app.getHttpServer())
      .post(`/v1/admin/disputes/${disputeId}/resolve`)
      .set('Authorization', adminAuth)
      .send({ resolution: 'full_refund', note: 'again' })
      .expect(409);

    await expectNoDrift();
  });

  it('exit 5: partial_refund — the booking STAYS paid, and an overcharge is shared paisa-exact', async () => {
    const { bookingId } = await seedSettledPaid();
    const disputeId = await open(bookingId, 'overcharge');

    const res = await request(app.getHttpServer())
      .post(`/v1/admin/disputes/${disputeId}/resolve`)
      .set('Authorization', adminAuth)
      .send({
        resolution: 'partial_refund',
        note: 'overcharge of ₹300 refunded, the rest of the trip stands',
        refundAmountPaise: 30_000,
        // ADM-6: an overcharge is a fare error, so it is shared the way a fare
        // recalculation is: the driver was credited 900 of the 1000, so they
        // give back 90 % of the 300, and MiTow gives back the other 30.
        terms: { cause: 'fare_error' },
      })
      .expect(200);

    expect(res.body).toMatchObject({
      resolution: 'partial_refund',
      bookingStatus: 'paid',
      refundAmountPaise: 30_000,
    });
    expect(await bookingStatus(bookingId)).toBe('paid');

    // The payment stays captured with the running refunded amount.
    const [payment] = (await db.execute(sql`
      select status, refunded_amount::text as refunded from payments
       where booking_id = ${bookingId}::uuid
    `)) as unknown as [{ status: string; refunded: string }];
    expect(payment).toEqual({ status: 'captured', refunded: '300.00' });

    // The clawback: the driver's 90 % of X, not all of it.
    const legs = (await db.execute(sql`
      select type, amount::text as amount from wallet_transactions
       where ref_id = ${bookingId}::uuid order by created_at
    `)) as unknown as Array<{ type: string; amount: string }>;
    expect(legs).toEqual([
      { type: 'driver_share_credit', amount: '900.00' },
      { type: 'refund_debit', amount: '-270.00' },
    ]);

    const [refund] = (await db.execute(sql`
      select kind, liability, cause, amount::text as amount from refunds
       where booking_id = ${bookingId}::uuid
    `)) as unknown as [{ kind: string; liability: string; cause: string; amount: string }];
    expect(refund).toEqual({
      kind: 'partial',
      liability: 'shared',
      cause: 'fare_error',
      amount: '300.00',
    });

    await expectNoDrift();
  });

  it('a misconduct refund notes it on the driver and tells them what was deducted', async () => {
    // ADM-6's industry-standard half: the driver sees a deduction explained,
    // and repeat complaints are visible on their record rather than scattered
    // across bookings.
    const { bookingId } = await seedSettledPaid();
    const disputeId = await open(bookingId, 'overcharge');

    await request(app.getHttpServer())
      .post(`/v1/admin/disputes/${disputeId}/resolve`)
      .set('Authorization', adminAuth)
      .send({
        resolution: 'partial_refund',
        note: 'driver refused to load the car properly',
        refundAmountPaise: 20_000,
        terms: { cause: 'driver_misconduct' },
      })
      .expect(200);

    const [booking] = (await db.execute(sql`
      select driver_id from bookings where id = ${bookingId}::uuid
    `)) as unknown as [{ driver_id: string }];

    const notes = (await db.execute(sql`
      select body from admin_notes
       where subject_type = 'driver' and subject_id = ${booking.driver_id}::uuid
    `)) as unknown as Array<{ body: string }>;
    expect(notes).toHaveLength(1);
    expect(notes[0]!.body).toContain('₹200.00 was deducted');

    const events = (await db.execute(sql`
      select payload from notification_events where event = 'earnings.adjusted'
    `)) as unknown as Array<{ payload: { driverId: string; amount: string; cause: string } }>;
    expect(events).toHaveLength(1);
    expect(events[0]!.payload).toMatchObject({
      driverId: booking.driver_id,
      amount: '₹200.00',
      cause: 'driver_misconduct',
    });

    await expectNoDrift();
  });

  it('refuses an override of who pays without a written reason', async () => {
    const { bookingId } = await seedSettledPaid();
    const disputeId = await open(bookingId, 'overcharge');

    const refused = await request(app.getHttpServer())
      .post(`/v1/admin/disputes/${disputeId}/resolve`)
      .set('Authorization', adminAuth)
      .send({
        resolution: 'partial_refund',
        note: 'goodwill, but charge the driver',
        refundAmountPaise: 10_000,
        terms: { cause: 'goodwill', bearer: 'provider' },
      })
      .expect(422);
    expect(JSON.stringify(refused.body)).toContain('overrideReason');
    expect(await bookingStatus(bookingId)).toBe('disputed');
  });

  it('refuses money exits from the wrong origin and comp on the wrong exit', async () => {
    const { bookingId } = await seedInProgress();
    const disputeId = await open(bookingId);

    // A no-money origin cannot uphold a charge it never took.
    await request(app.getHttpServer())
      .post(`/v1/admin/disputes/${disputeId}/resolve`)
      .set('Authorization', adminAuth)
      .send({ resolution: 'uphold_charge', note: 'nope' })
      .expect(409);

    // `compensateDriver` is defined for cancel_no_charge only — the contract refuses it elsewhere.
    await request(app.getHttpServer())
      .post(`/v1/admin/disputes/${disputeId}/resolve`)
      .set('Authorization', adminAuth)
      .send({ resolution: 'complete_and_charge', note: 'nope', compensateDriver: true })
      .expect(422);
  });

  it('requires dispute.handle: an anonymous caller is refused', async () => {
    await request(app.getHttpServer()).get('/v1/admin/disputes').expect(401);
  });
});
