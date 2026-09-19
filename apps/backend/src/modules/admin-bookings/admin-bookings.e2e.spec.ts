import type { INestApplication } from '@nestjs/common';
import { adminBookingDetailSchema, adminBookingInvoiceSchema, rupeeStringToPaise } from '@towing/api-contracts';
import { sql } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { adminActions } from '../../db/schema';
import { eq } from 'drizzle-orm';
import { bookings } from '../../db/schema';
import { LedgerService } from '../../db/ledger/ledger.service';
import { DispatchService } from '../dispatch/dispatch.service';
import { seedOnlineDriver, seedZone } from '../dispatch/dispatch-fixtures';
import { adminAuthHeaderFor, createTestApp } from '../../test/app';
import { expectMatchesContract } from '../../test/contracts';
import {
  seedAdmin,
  seedCustomer,
  seedDriver,
  seedFleet,
  setupTestDatabase,
  truncateAll,
} from '../../test/db';
import type { TestDatabase } from '../../test/db';
import { seedBooking, seedWalletWithLedger } from '../../test/fixtures';
import { closeTestRedis, flushTestRedis } from '../../test/redis';

/**
 * W8 — the bookings console (§9.4.7, §6.5, §14.2).
 *
 * What each block pins:
 * - **list/detail**: the filters, the derived code, the timeline's admin actor
 *   — `actor_id` is the one column migration 0020 added for this phase.
 * - **cancel**: waive by default (G4), the policy mirror when asked, the 409
 *   with its dispute-route hint for money-bearing statuses, and the audit row.
 * - **reassign**: §6.5's six steps — the attempt outcome `driverFault` selects,
 *   the wave resume, the previous driver's exclusion from the resumed search,
 *   and the eligibility refusal for an explicit driver.
 * - **override**: the allowlist (illegal edges 409 with the allowed list, and
 *   `→ paid` is not on it), through the REAL completion service for
 *   `in_progress → completed` so the waiting charge bills from the snapshot.
 * - **§14.2**: the recheck's single-booking settle, and the reminder's
 *   per-IST-day dedupe.
 */
describe('W8 — admin bookings (/v1/admin/bookings)', () => {
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

  const status = async (bookingId: string): Promise<string> => {
    const [row] = (await db.execute(sql`
      select status from bookings where id = ${bookingId}::uuid
    `)) as unknown as [{ status: string }];
    return row.status;
  };

  const auditActions = async (): Promise<string[]> => {
    const rows = await db.select({ action: adminActions.action }).from(adminActions);
    return rows.map((row) => row.action);
  };

  /** A searching booking with a zone — the shape the console cancels most often. */
  async function seedSearching(zoneId?: string): Promise<{ bookingId: string; userId: string }> {
    const userId = await seedCustomer(db, 'W8 Customer');
    const bookingId = await seedBooking(db, { userId, status: 'searching' });
    if (zoneId) {
      await db.update(bookings).set({ zoneId }).where(eq(bookings.id, bookingId));
    }
    return { bookingId, userId };
  }

  /**
   * An assigned booking on wave 2 with the accepted attempt row reassign reads —
   * the state §6.5's re-dispatch resumes from.
   */
  async function seedAssigned(params: {
    zoneId: string;
    driverId: string;
    wave?: number;
  }): Promise<string> {
    const userId = await seedCustomer(db, 'W8 Assigned Customer');
    const bookingId = await seedBooking(db, {
      userId,
      driverId: params.driverId,
      status: 'assigned',
      total: '1000.00',
      commissionAmount: '100.00',
      driverPayout: '900.00',
    });
    await db
      .update(bookings)
      .set({ zoneId: params.zoneId, searchWave: params.wave ?? 2 })
      .where(eq(bookings.id, bookingId));
    await db.execute(sql`
      insert into dispatch_attempts (booking_id, driver_id, wave, radius_km, outcome, offered_at, responded_at)
      values (${bookingId}::uuid, ${params.driverId}::uuid, ${params.wave ?? 2}, 4.00, 'accepted', now(), now())
    `);
    return bookingId;
  }

  // -------------------------------------------------------------------------
  // List + detail + invoice
  // -------------------------------------------------------------------------

  it('lists with filters, a real total and the derived code', async () => {
    const paid = await seedBooking(db, { userId: await seedCustomer(db, 'Paid'), status: 'paid' });
    const searching = (await seedSearching()).bookingId;

    const all = await request(app.getHttpServer())
      .get('/v1/admin/bookings')
      .set('Authorization', adminAuth)
      .expect(200);
    expect(all.body.total).toBe(2);

    const onlyPaid = await request(app.getHttpServer())
      .get('/v1/admin/bookings?status=paid')
      .set('Authorization', adminAuth)
      .expect(200);
    expect(onlyPaid.body.total).toBe(1);
    expect(onlyPaid.body.items[0].id).toBe(paid);
    expect(onlyPaid.body.items[0].code).toBe(`TW-${paid.slice(0, 8).toUpperCase()}`);

    const both = await request(app.getHttpServer())
      .get('/v1/admin/bookings?status=paid&status=searching')
      .set('Authorization', adminAuth)
      .expect(200);
    expect(both.body.total).toBe(2);
    expect(both.body.items.map((item: { id: string }) => item.id)).toContain(searching);
  });

  it('serves the detail against its contract, with the admin actor in the timeline', async () => {
    const { bookingId } = await seedSearching();
    await request(app.getHttpServer())
      .post(`/v1/admin/bookings/${bookingId}/cancel`)
      .set('Authorization', adminAuth)
      .send({ reason: 'operator cancelled the search' })
      .expect(200);

    const detail = await request(app.getHttpServer())
      .get(`/v1/admin/bookings/${bookingId}`)
      .set('Authorization', adminAuth)
      .expect(200);

    expectMatchesContract(adminBookingDetailSchema, detail.body);
    const cancelledRow = detail.body.timeline.find(
      (entry: { status: string }) => entry.status === 'cancelled',
    );
    expect(cancelledRow).toMatchObject({ actor: 'admin', actorId: adminId });
  });

  it('audits every invoice view through the admin link path', async () => {
    const userId = await seedCustomer(db, 'Invoice Customer');
    const bookingId = await seedBooking(db, { userId, status: 'paid', total: '1000.00' });

    const res = await request(app.getHttpServer())
      .get(`/v1/admin/bookings/${bookingId}/invoice`)
      .set('Authorization', adminAuth)
      .expect(200);
    expectMatchesContract(adminBookingInvoiceSchema, res.body);

    expect(await auditActions()).toContain('booking.invoice.view');
  });

  // -------------------------------------------------------------------------
  // Cancel
  // -------------------------------------------------------------------------

  it('cancels a searching booking free by default (G4) and audits it', async () => {
    const { bookingId } = await seedSearching();

    const res = await request(app.getHttpServer())
      .post(`/v1/admin/bookings/${bookingId}/cancel`)
      .set('Authorization', adminAuth)
      .send({ reason: 'no longer needed' })
      .expect(200);

    expect(res.body).toMatchObject({
      bookingId,
      status: 'cancelled',
      feePaise: 0,
      driverCompensationPaise: 0,
      couponReleased: false,
    });
    expect(await status(bookingId)).toBe('cancelled');
    expect(await auditActions()).toContain('booking.cancel');
  });

  it('applies the §3.5 policy when asked, posting the driver compensation as an adjustment', async () => {
    // A driver committed at the pickup, an hour on the clock: the full-fare tier.
    const driverId = await seedDriver(db, { name: 'Policy Driver' });
    const userId = await seedCustomer(db, 'Policy Customer');
    const bookingId = await seedBooking(db, { userId, driverId, status: 'assigned' });
    await db
      .update(bookings)
      .set({ createdAt: new Date(Date.now() - 60 * 60_000), baseFare: '500.00' })
      .where(eq(bookings.id, bookingId));

    const res = await request(app.getHttpServer())
      .post(`/v1/admin/bookings/${bookingId}/cancel`)
      .set('Authorization', adminAuth)
      .send({ reason: 'driver cannot proceed', feeMode: 'apply_policy' })
      .expect(200);

    // Full base fare (₹500), half of it to the driver (§3.5's default comp).
    expect(res.body.feePaise).toBe(50_000);
    expect(res.body.driverCompensationPaise).toBe(25_000);

    const [booking] = (await db.execute(sql`
      select cancellation_fee::text as fee, driver_compensation::text as comp,
             cancelled_by
        from bookings where id = ${bookingId}::uuid
    `)) as unknown as [{ fee: string; comp: string; cancelled_by: string }];
    expect(booking).toEqual({ fee: '500.00', comp: '250.00', cancelled_by: 'admin' });

    // The leg is an `adjustment`, never an earning type.
    const [leg] = (await db.execute(sql`
      select type, amount::text as amount from wallet_transactions
       where ref_id = ${bookingId}::uuid
    `)) as unknown as [{ type: string; amount: string }];
    expect(leg).toEqual({ type: 'adjustment', amount: '250.00' });
  });

  it('refuses a completed booking with the dispute-route hint and changes nothing', async () => {
    const userId = await seedCustomer(db, 'Completed Customer');
    const bookingId = await seedBooking(db, { userId, status: 'completed' });

    const res = await request(app.getHttpServer())
      .post(`/v1/admin/bookings/${bookingId}/cancel`)
      .set('Authorization', adminAuth)
      .send({ reason: 'customer asked' })
      .expect(409);

    expect(res.body.error.code).toBe('invalid_booking_state');
    expect(res.body.error.message).toContain('dispute');
    expect(await status(bookingId)).toBe('completed');
    expect(await auditActions()).not.toContain('booking.cancel');
  });

  // -------------------------------------------------------------------------
  // Reassign
  // -------------------------------------------------------------------------

  it('reassigns with driverFault → `unable`, resumes the stored wave and excludes the previous driver', async () => {
    const zoneId = await seedZone(db);
    const previousDriver = await seedOnlineDriver(db, { zoneId, metersAway: 400 });
    const otherDriver = await seedOnlineDriver(db, { zoneId, metersAway: 600 });
    const bookingId = await seedAssigned({ zoneId, driverId: previousDriver, wave: 2 });

    const res = await request(app.getHttpServer())
      .post(`/v1/admin/bookings/${bookingId}/reassign`)
      .set('Authorization', adminAuth)
      .send({ mode: 'redispatch', reason: 'driver stopped responding', driverFault: true })
      .expect(200);

    expect(res.body).toMatchObject({
      bookingId,
      status: 'searching',
      mode: 'redispatch',
      attemptOutcome: 'unable',
      previousDriverId: previousDriver,
      offeredDriverId: null,
    });

    // The unable row, on the rung it happened on.
    const [attempt] = (await db.execute(sql`
      select outcome, wave from dispatch_attempts
       where booking_id = ${bookingId}::uuid and driver_id = ${previousDriver}::uuid
         and outcome = 'unable'
    `)) as unknown as [{ outcome: string; wave: number }];
    expect(attempt).toEqual({ outcome: 'unable', wave: 2 });

    // Driver cleared, wave kept (§6.5: resume, don't restart), deadline extended.
    const [booking] = (await db.execute(sql`
      select driver_id, search_wave, dispatch_deadline_at, status
        from bookings where id = ${bookingId}::uuid
    `)) as unknown as [
      { driver_id: string | null; search_wave: number; dispatch_deadline_at: Date; status: string },
    ];
    expect(booking.driver_id).toBeNull();
    expect(booking.search_wave).toBe(2);
    expect(booking.dispatch_deadline_at).not.toBeNull();

    // The resumed search excludes the previous driver and reaches the other one.
    await app.get(DispatchService).runWave(bookingId);
    const offered = (await db.execute(sql`
      select driver_id from dispatch_attempts
       where booking_id = ${bookingId}::uuid and outcome = 'offered'
    `)) as unknown as Array<{ driver_id: string }>;
    const offeredIds = offered.map((row) => row.driver_id);
    expect(offeredIds).not.toContain(previousDriver);
    expect(offeredIds).toContain(otherDriver);
  });

  it('records `reassigned` when the driver was not at fault', async () => {
    const zoneId = await seedZone(db);
    const driverId = await seedOnlineDriver(db, { zoneId });
    const bookingId = await seedAssigned({ zoneId, driverId });

    await request(app.getHttpServer())
      .post(`/v1/admin/bookings/${bookingId}/reassign`)
      .set('Authorization', adminAuth)
      .send({ mode: 'redispatch', reason: 'vehicle swapped at the depot', driverFault: false })
      .expect(200);

    const rows = (await db.execute(sql`
      select outcome from dispatch_attempts
       where booking_id = ${bookingId}::uuid and driver_id = ${driverId}::uuid
    `)) as unknown as Array<{ outcome: string }>;
    expect(rows.map((row) => row.outcome).sort()).toEqual(['accepted', 'reassigned']);
  });

  it('sends one exclusive offer to a chosen eligible driver, and refuses an unknown one', async () => {
    const zoneId = await seedZone(db);
    const previousDriver = await seedOnlineDriver(db, { zoneId, metersAway: 300 });
    const chosenDriver = await seedOnlineDriver(db, { zoneId, metersAway: 500 });
    const bookingId = await seedAssigned({ zoneId, driverId: previousDriver });

    const ok = await request(app.getHttpServer())
      .post(`/v1/admin/bookings/${bookingId}/reassign`)
      .set('Authorization', adminAuth)
      .send({
        mode: 'offer_to_driver',
        driverId: chosenDriver,
        reason: 'customer requested this driver',
        driverFault: false,
      })
      .expect(200);
    expect(ok.body.offeredDriverId).toBe(chosenDriver);

    const [offer] = (await db.execute(sql`
      select outcome from dispatch_attempts
       where booking_id = ${bookingId}::uuid and driver_id = ${chosenDriver}::uuid
         and outcome = 'offered'
    `)) as unknown as Array<{ outcome: string }>;
    expect(offer).toEqual({ outcome: 'offered' });

    // A driver who is not in the candidate store cannot be offered to.
    const stranger = await seedDriver(db, { name: 'Offline Stranger' });
    await db.update(bookings).set({ status: 'assigned', driverId: previousDriver }).where(eq(bookings.id, bookingId));
    await db.execute(sql`
      insert into dispatch_attempts (booking_id, driver_id, wave, radius_km, outcome, offered_at, responded_at)
      values (${bookingId}::uuid, ${previousDriver}::uuid, 2, 4.00, 'accepted', now(), now())
    `);
    const refused = await request(app.getHttpServer())
      .post(`/v1/admin/bookings/${bookingId}/reassign`)
      .set('Authorization', adminAuth)
      .send({
        mode: 'offer_to_driver',
        driverId: stranger,
        reason: 'customer requested this driver',
        driverFault: false,
      })
      .expect(422);
    expect(refused.body.error.message).toContain('cannot take this offer');
    expect(await auditActions()).toContain('booking.reassign');
  });

  // -------------------------------------------------------------------------
  // Manual override
  // -------------------------------------------------------------------------

  it('enforces the allowlist: an illegal edge 409s with the allowed list, and never → paid', async () => {
    const { bookingId } = await seedSearching();

    const res = await request(app.getHttpServer())
      .post(`/v1/admin/bookings/${bookingId}/transition`)
      .set('Authorization', adminAuth)
      .send({ to: 'in_progress', reason: 'force it' })
      .expect(409);
    expect(res.body.error.details.allowed).toEqual([]);

    const paid = await request(app.getHttpServer())
      .post(`/v1/admin/bookings/${bookingId}/transition`)
      .set('Authorization', adminAuth)
      .send({ to: 'paid', reason: 'mark it paid' })
      .expect(409);
    expect(paid.body.error.details.allowed).toEqual([]);
  });

  it('routes in_progress → completed through the completion service, billing waiting from the snapshot', async () => {
    const driverId = await seedDriver(db, { name: 'Waiting Driver' });
    const userId = await seedCustomer(db, 'Waiting Customer');
    const bookingId = await seedBooking(db, {
      userId,
      driverId,
      status: 'in_progress',
      total: '1000.00',
      commissionAmount: '0.00',
      driverPayout: '0.00',
    });
    await db
      .update(bookings)
      .set({
        arrivedAt: new Date(Date.now() - 30 * 60_000),
        startedAt: new Date(Date.now() - 10 * 60_000),
        waitingFreeMinutes: 15,
        waitingPerMinute: '2.00',
      })
      .where(eq(bookings.id, bookingId));

    const res = await request(app.getHttpServer())
      .post(`/v1/admin/bookings/${bookingId}/transition`)
      .set('Authorization', adminAuth)
      .send({ to: 'completed', reason: 'trip actually finished' })
      .expect(200);

    expect(res.body).toMatchObject({ from: 'in_progress', to: 'completed' });

    // 20 minutes waited − 15 free = 5 × ₹2 = ₹10 waiting, on top of ₹1000.
    const [booking] = (await db.execute(sql`
      select waiting_charge::text as waiting, total::text as total, completed_at
        from bookings where id = ${bookingId}::uuid
    `)) as unknown as [{ waiting: string; total: string; completed_at: Date }];
    expect(booking.waiting).toBe('10.00');
    expect(booking.total).toBe('1010.00');

    // The history row names the admin, the actor_id column's first writer.
    const [history] = (await db.execute(sql`
      select actor, actor_id from booking_status_history
       where booking_id = ${bookingId}::uuid and status = 'completed'
    `)) as unknown as [{ actor: string; actor_id: string }];
    expect(history).toEqual({ actor: 'admin', actor_id: adminId });
  });

  it('moves the clock edges with their instants and reopens a no_drivers_found search', async () => {
    const driverId = await seedDriver(db, { name: 'Edge Driver' });
    const userId = await seedCustomer(db, 'Edge Customer');
    const assigned = await seedBooking(db, { userId, driverId, status: 'assigned' });

    await request(app.getHttpServer())
      .post(`/v1/admin/bookings/${assigned}/transition`)
      .set('Authorization', adminAuth)
      .send({ to: 'arrived', reason: 'driver is at the pickup' })
      .expect(200);
    const [arrived] = (await db.execute(sql`
      select arrived_at from bookings where id = ${assigned}::uuid
    `)) as unknown as [{ arrived_at: Date | null }];
    expect(arrived.arrived_at).not.toBeNull();

    await request(app.getHttpServer())
      .post(`/v1/admin/bookings/${assigned}/transition`)
      .set('Authorization', adminAuth)
      .send({ to: 'in_progress', reason: 'customer met' })
      .expect(200);
    const [started] = (await db.execute(sql`
      select started_at from bookings where id = ${assigned}::uuid
    `)) as unknown as [{ started_at: Date | null }];
    expect(started.started_at).not.toBeNull();

    const noDrivers = await seedBooking(db, {
      userId: await seedCustomer(db, 'No Drivers'),
      status: 'no_drivers_found',
    });
    await request(app.getHttpServer())
      .post(`/v1/admin/bookings/${noDrivers}/transition`)
      .set('Authorization', adminAuth)
      .send({ to: 'searching', reason: 'customer retried' })
      .expect(200);
    expect(await status(noDrivers)).toBe('searching');
  });

  it('gates the override on booking.override — operations cannot use it', async () => {
    const opsAdmin = await seedAdmin(db, { subRole: 'operations' });
    const opsAuth = await adminAuthHeaderFor(app, {
      adminId: opsAdmin.id,
      subRole: 'operations',
    });
    const { bookingId } = await seedSearching();

    await request(app.getHttpServer())
      .post(`/v1/admin/bookings/${bookingId}/transition`)
      .set('Authorization', opsAuth)
      .send({ to: 'arrived', reason: 'let me in' })
      .expect(403);
  });

  // -------------------------------------------------------------------------
  // §14.2 — recheck + remind
  // -------------------------------------------------------------------------

  it('rechecks a booking\'s payment and settles it when the gateway confirms', async () => {
    const driverId = await seedDriver(db, { name: 'Recheck Driver' });
    const userId = await seedCustomer(db, 'Recheck Customer');
    const bookingId = await seedBooking(db, {
      userId,
      driverId,
      status: 'completed',
      total: '1000.00',
      commissionAmount: '0.00',
      driverPayout: '0.00',
    });
    await db.update(bookings).set({ commissionBand: 'A' }).where(eq(bookings.id, bookingId));
    await db.execute(sql`
      insert into payments (booking_id, amount, tax_amount, purpose, method, status,
                            idempotency_key, provider, gateway_ref, gateway_order_ref)
      values (${bookingId}::uuid, 1000.00, 0, 'booking', 'upi', 'pending',
              ${`pay:v1:test:${bookingId}`}, 'dev', 'pay_late_1', 'order_late_1')
    `);

    const res = await request(app.getHttpServer())
      .post(`/v1/admin/bookings/${bookingId}/payment/recheck`)
      .set('Authorization', adminAuth)
      .expect(200);

    expect(res.body).toMatchObject({
      bookingId,
      paymentStatus: 'captured',
      settled: true,
    });
    expect(await status(bookingId)).toBe('paid');

    // All five invariants hold after the settle the recheck triggered.
    const ledger = app.get(LedgerService);
    await expect(ledger.invariants()).resolves.toEqual({
      walletDrift: 0,
      bookingDrift: 0,
      ledgerDrift: 0,
      reversalDrift: 0,
      couponDrift: 0,
    });
  });

  it('reminds once per IST day and collapses the double submit', async () => {
    const userId = await seedCustomer(db, 'Remind Customer');
    const bookingId = await seedBooking(db, { userId, status: 'completed', total: '1000.00' });

    const first = await request(app.getHttpServer())
      .post(`/v1/admin/bookings/${bookingId}/payment/remind`)
      .set('Authorization', adminAuth)
      .expect(200);
    expect(first.body.sent).toBe(true);

    const second = await request(app.getHttpServer())
      .post(`/v1/admin/bookings/${bookingId}/payment/remind`)
      .set('Authorization', adminAuth)
      .expect(200);
    expect(second.body.sent).toBe(false);

    const [events] = (await db.execute(sql`
      select count(*)::int as count from notification_events where event = 'payment.reminder'
    `)) as unknown as [{ count: number }];
    expect(events.count).toBe(1);
  });
});
