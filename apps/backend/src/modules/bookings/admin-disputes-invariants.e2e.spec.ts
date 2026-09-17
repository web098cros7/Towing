import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ledgerInvariants } from '../../db/ledger/invariants';
import { seedCustomer, seedDriver, setupTestDatabase, truncateAll } from '../../test/db';
import type { TestDatabase } from '../../test/db';
import { createTestApp } from '../../test/app';
import { seedBooking, seedWalletWithLedger } from '../../test/fixtures';
import { closeTestRedis, flushTestRedis } from '../../test/redis';
import { BookingStateMachineService } from './booking-state-machine.service';

/**
 * A9 — `disputed → paid` cannot manufacture ledger drift.
 *
 * The edge stays in the table for disputes opened from `paid`, but
 * `transition()` refuses it unless the booking settled first (a captured
 * payment AND settlement legs). A booking that reached `disputed` from
 * `in_progress` or `completed` has neither; resolving it to `paid` would make
 * `ledgerDrift` non-zero forever. W8's dispute resolver inherits this guard
 * by calling `transition()` — it cannot bypass it.
 *
 * (Named for the work order's verification file; W8 may consolidate dispute
 * specs alongside its `disputes` tables.)
 */
describe('dispute resolution invariants e2e (A9)', () => {
  let app: INestApplication;
  let db: TestDatabase;
  let machine: BookingStateMachineService;
  let userId: string;
  let driverId: string;

  beforeAll(async () => {
    db = await setupTestDatabase();
    app = await createTestApp();
    machine = app.get(BookingStateMachineService);
  });

  afterAll(async () => {
    await app.close();
    await closeTestRedis();
  });

  beforeEach(async () => {
    await truncateAll();
    await flushTestRedis();

    userId = await seedCustomer(db, 'Dispute Customer');
    driverId = await seedDriver(db, { name: 'Dispute Driver' });
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

  const status = async (booking: string): Promise<string> => {
    const [row] = (await db.execute(sql`
      select status from bookings where id = ${booking}::uuid
    `)) as unknown as [{ status: string }];
    return row.status;
  };

  const move = (booking: string, to: 'disputed' | 'paid' | 'completed' | 'in_progress') =>
    db.transaction((tx) => machine.transition(tx, { bookingId: booking, to, actor: 'system' }));

  const seedPaidBooking = async (): Promise<string> => {
    const bookingId = await seedBooking(db, {
      userId,
      driverId,
      status: 'paid',
      total: '1000.00',
      commissionAmount: '100.00',
      driverPayout: '900.00',
    });
    await db.execute(sql`
      insert into payments (booking_id, amount, tax_amount, purpose, method, status,
                            idempotency_key, provider, gateway_ref)
      values (${bookingId}::uuid, 1000.00, 0, 'booking', 'upi', 'captured',
              ${`pay:v1:test:${bookingId}:${randomUUID()}`}, 'dev', ${`pay_dev_${randomUUID().slice(0, 8)}`})
    `);
    await seedWalletWithLedger(db, { ownerType: 'driver', ownerId: driverId }, [
      { type: 'driver_share_credit', amount: '900.00', refId: bookingId },
    ]);
    return bookingId;
  };

  it('refuses disputed → paid for a dispute opened mid-trip, with zero drift', async () => {
    const bookingId = await seedBooking(db, {
      userId,
      driverId,
      status: 'in_progress',
      total: '1000.00',
      commissionAmount: '100.00',
      driverPayout: '900.00',
    });
    await move(bookingId, 'disputed');

    await expect(move(bookingId, 'paid')).rejects.toMatchObject({ status: 409 });
    expect(await status(bookingId)).toBe('disputed');

    await expectNoDrift();
  });

  it('refuses disputed → paid for a never-settled completed booking, with zero drift', async () => {
    const bookingId = await seedBooking(db, {
      userId,
      driverId,
      status: 'completed',
      total: '1000.00',
      commissionAmount: '100.00',
      driverPayout: '900.00',
    });
    await move(bookingId, 'disputed');

    await expect(move(bookingId, 'paid')).rejects.toMatchObject({ status: 409 });
    expect(await status(bookingId)).toBe('disputed');

    await expectNoDrift();
  });

  it('allows disputed → paid back for a settled booking, with zero drift', async () => {
    const bookingId = await seedPaidBooking();
    await move(bookingId, 'disputed');
    await move(bookingId, 'paid');

    expect(await status(bookingId)).toBe('paid');

    await expectNoDrift();
  });
});
