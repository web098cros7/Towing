import type { INestApplication } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ledgerInvariants } from '../../db/ledger/invariants';
import {
  seedAdmin,
  seedCustomer,
  seedDriver,
  seedFleet,
  setupTestDatabase,
  truncateAll,
} from '../../test/db';
import type { TestDatabase } from '../../test/db';
import { createTestApp } from '../../test/app';
import { seedBooking, seedWalletWithLedger } from '../../test/fixtures';
import { closeTestRedis, flushTestRedis } from '../../test/redis';
import { LedgerService } from '../../db/ledger/ledger.service';
import { PAYMENT_GATEWAY } from './payment-gateway.port';
import { RefundsService } from './refunds.service';

/**
 * W8 — partial refunds, to the paisa.
 *
 * The design under test: a partial refund claws back the LIABLE party's share
 * of X as a compensating `refund_debit` (capped at what the settlement credited
 * them) and leaves the booking `paid` — drift-free by construction, because
 * `ledgerDrift` sums only credits and `reversalDrift` runs at every status and
 * only bounds refunds by credits. A chained full refund reverses what earlier
 * partials had not yet clawed back, so the bound stays exact at every step.
 *
 * The route-level path is covered in `admin-disputes.e2e.spec.ts`; this spec
 * drives the engine directly so the arithmetic is assertable without a dispute.
 */
describe('W8 — partial refunds (money engine)', () => {
  let app: INestApplication;
  let db: TestDatabase;
  let refunds: RefundsService;
  let adminId: string;
  let userId: string;
  let driverId: string;

  beforeAll(async () => {
    db = await setupTestDatabase();
    app = await createTestApp();
    refunds = app.get(RefundsService);
  });

  afterAll(async () => {
    await app.close();
    await closeTestRedis();
  });

  beforeEach(async () => {
    await truncateAll();
    await flushTestRedis();
    adminId = (await seedAdmin(db, { subRole: 'super_admin' })).id;
    userId = await seedCustomer(db, 'Partial Customer');
    driverId = await seedDriver(db, { name: 'Partial Driver' });
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

  const legs = async (bookingId: string): Promise<Array<{ type: string; amount: string }>> => {
    return (await db.execute(sql`
      select type, amount::text as amount from wallet_transactions
       where ref_id = ${bookingId}::uuid order by created_at, type
    `)) as unknown as Array<{ type: string; amount: string }>;
  };

  const paymentOf = async (bookingId: string): Promise<{ status: string; refunded: string }> => {
    const [row] = (await db.execute(sql`
      select status, refunded_amount::text as refunded from payments
       where booking_id = ${bookingId}::uuid
    `)) as unknown as [{ status: string; refunded: string }];
    return row;
  };

  /** 1000 paid, 100 commission, 900 credited to the driver. */
  async function seedPaidBooking(): Promise<string> {
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
  }

  const adminKey = (): { kind: 'admin'; adminId: string; clientKey: string } => ({
    kind: 'admin',
    adminId,
    clientKey: randomUUID(),
  });

  it("refunds X to the paisa, claws back the driver's share, and keeps the booking paid", async () => {
    const bookingId = await seedPaidBooking();

    const result = await refunds.refundPartial({
      bookingId,
      amountPaise: 30_000,
      terms: { cause: 'driver_misconduct', delivery: 'original' },
      reason: 'goodwill',
      initiatedBy: adminId,
      keySource: adminKey(),
    });

    expect(result.replayed).toBe(false);
    expect(await paymentOf(bookingId)).toEqual({ status: 'captured', refunded: '300.00' });
    expect(await legs(bookingId)).toEqual([
      { type: 'driver_share_credit', amount: '900.00' },
      { type: 'refund_debit', amount: '-300.00' },
    ]);

    const [booking] = (await db.execute(sql`
      select status from bookings where id = ${bookingId}::uuid
    `)) as unknown as [{ status: string }];
    expect(booking.status).toBe('paid');

    const [refund] = (await db.execute(sql`
      select kind, amount::text as amount, liability from refunds
       where booking_id = ${bookingId}::uuid
    `)) as unknown as [{ kind: string; amount: string; liability: string }];
    expect(refund).toEqual({ kind: 'partial', amount: '300.00', liability: 'provider' });

    await expectNoDrift();
  });

  it('stacks partials up to the credited amount, then refuses the one that would exceed it', async () => {
    const bookingId = await seedPaidBooking();

    await refunds.refundPartial({
      bookingId,
      amountPaise: 30_000,
      terms: { cause: 'driver_misconduct', delivery: 'original' },
      reason: 'goodwill',
      initiatedBy: adminId,
      keySource: adminKey(),
    });
    await refunds.refundPartial({
      bookingId,
      amountPaise: 20_000,
      terms: { cause: 'driver_misconduct', delivery: 'original' },
      reason: 'goodwill',
      initiatedBy: adminId,
      keySource: adminKey(),
    });

    expect(await paymentOf(bookingId)).toEqual({ status: 'captured', refunded: '500.00' });

    // 900 credited − 500 already clawed = 400 of headroom; 400.01 is a refusal.
    const gateway = vi.spyOn(app.get(PAYMENT_GATEWAY), 'refund');
    gateway.mockClear();
    await expect(
      refunds.refundPartial({
        bookingId,
        amountPaise: 40_001,
        terms: { cause: 'driver_misconduct', delivery: 'original' },
        reason: 'goodwill',
        initiatedBy: adminId,
        keySource: adminKey(),
      }),
    ).rejects.toMatchObject({ status: 422 });

    expect(gateway).not.toHaveBeenCalled();
    expect(await paymentOf(bookingId)).toEqual({ status: 'captured', refunded: '500.00' });

    await expectNoDrift();
  });

  it("refuses an amount beyond the payment's remaining balance before any money moves", async () => {
    const bookingId = await seedPaidBooking();
    const gateway = vi.spyOn(app.get(PAYMENT_GATEWAY), 'refund');
    gateway.mockClear();

    await expect(
      refunds.refundPartial({
        bookingId,
        amountPaise: 100_001,
        terms: { cause: 'goodwill', delivery: 'original' },
        reason: 'goodwill',
        initiatedBy: adminId,
        keySource: adminKey(),
      }),
    ).rejects.toMatchObject({ status: 422 });

    expect(gateway).not.toHaveBeenCalled();
    const [count] = (await db.execute(sql`
      select count(*)::int as n from refunds where booking_id = ${bookingId}::uuid
    `)) as unknown as [{ n: number }];
    expect(count.n).toBe(0);
    await expectNoDrift();
  });

  it('platform liability writes no legs — the platform absorbs its share', async () => {
    const bookingId = await seedPaidBooking();

    await refunds.refundPartial({
      bookingId,
      amountPaise: 20_000,
      terms: { cause: 'goodwill', delivery: 'original' },
      reason: 'goodwill',
      initiatedBy: adminId,
      keySource: adminKey(),
    });

    expect(await legs(bookingId)).toEqual([{ type: 'driver_share_credit', amount: '900.00' }]);
    expect(await paymentOf(bookingId)).toEqual({ status: 'captured', refunded: '200.00' });
    await expectNoDrift();
  });

  it('a later full refund reverses only what the partial did not, and reaches full coverage', async () => {
    const bookingId = await seedPaidBooking();

    await refunds.refundPartial({
      bookingId,
      amountPaise: 30_000,
      terms: { cause: 'driver_misconduct', delivery: 'original' },
      reason: 'goodwill',
      initiatedBy: adminId,
      keySource: adminKey(),
    });

    const full = await refunds.refundBooking({
      bookingId,
      reason: 'dispute',
      initiatedBy: adminId,
      transitionTo: 'disputed',
      keySource: adminKey(),
    });

    // The full refund moved the REMAINING ₹700, not the original ₹1000.
    const [row] = (await db.execute(sql`
      select amount::text as amount from refunds where id = ${full.refundId}::uuid
    `)) as unknown as [{ amount: string }];
    expect(row.amount).toBe('700.00');

    // Clawback total: 300 + 600 = 900, the driver's whole credit — never more.
    expect(await legs(bookingId)).toEqual([
      { type: 'driver_share_credit', amount: '900.00' },
      { type: 'refund_debit', amount: '-300.00' },
      { type: 'refund_debit', amount: '-600.00' },
    ]);
    expect(await paymentOf(bookingId)).toEqual({ status: 'refunded', refunded: '1000.00' });

    const [booking] = (await db.execute(sql`
      select status from bookings where id = ${bookingId}::uuid
    `)) as unknown as [{ status: string }];
    expect(booking.status).toBe('disputed');

    await expectNoDrift();
  });

  it('replays a double-submitted partial without a second gateway call or clawback', async () => {
    const bookingId = await seedPaidBooking();
    const keySource = adminKey();
    const gateway = vi.spyOn(app.get(PAYMENT_GATEWAY), 'refund');

    const first = await refunds.refundPartial({
      bookingId,
      amountPaise: 25_000,
      terms: { cause: 'driver_misconduct', delivery: 'original' },
      reason: 'goodwill',
      initiatedBy: adminId,
      keySource,
    });
    expect(first.replayed).toBe(false);
    const callsAfterFirst = gateway.mock.calls.length;

    const second = await refunds.refundPartial({
      bookingId,
      amountPaise: 25_000,
      terms: { cause: 'driver_misconduct', delivery: 'original' },
      reason: 'goodwill',
      initiatedBy: adminId,
      keySource,
    });

    expect(second).toMatchObject({ refundId: first.refundId, replayed: true });
    expect(gateway.mock.calls.length).toBe(callsAfterFirst);
    expect(await paymentOf(bookingId)).toEqual({ status: 'captured', refunded: '250.00' });
    expect(await legs(bookingId)).toEqual([
      { type: 'driver_share_credit', amount: '900.00' },
      { type: 'refund_debit', amount: '-250.00' },
    ]);

    await expectNoDrift();
  });

  describe('ADM-6 — the cause decides who pays', () => {
    /**
     * Ehsan, 23 Sep, after comparing Uber, Ola and Rapido: the admin says WHY
     * the customer is being refunded and the cause sets who bears it. The
     * booking above is the fixture throughout: 1000 paid, 900 credited to the
     * driver, so the driver side holds 90 % of the customer's money.
     */
    const refundRow = async (refundId: string) => {
      const [row] = (await db.execute(sql`
        select liability, cause, delivery, provider_share::text as provider_share,
               bearer_override_reason, status, gateway_amount::text as gateway_amount,
               wallet_amount::text as wallet_amount
          from refunds where id = ${refundId}::uuid
      `)) as unknown as [Record<string, string | null>];
      return row;
    };

    it('a fare error is shared: the driver gives back their 90 %, MiTow its 10 %', async () => {
      // The fare-recalculation rule. Before ADM-6 this refund had to be pinned
      // on ONE party, so either the driver lost ₹200 for a ₹180 share of the
      // fare, or MiTow kept a commission on money it gave back.
      const bookingId = await seedPaidBooking();

      const result = await refunds.refundPartial({
        bookingId,
        amountPaise: 20_000,
        terms: { cause: 'fare_error', delivery: 'original' },
        reason: 'Took the long way round',
        initiatedBy: adminId,
        keySource: adminKey(),
      });

      expect(result.providerSharePaise).toBe(18_000);
      expect(await legs(bookingId)).toEqual([
        { type: 'driver_share_credit', amount: '900.00' },
        { type: 'refund_debit', amount: '-180.00' },
      ]);
      expect(await refundRow(result.refundId)).toMatchObject({
        liability: 'shared',
        cause: 'fare_error',
        provider_share: '180.00',
        delivery: 'original',
      });
      await expectNoDrift();
    });

    it('goodwill and platform errors never touch the driver', async () => {
      const bookingId = await seedPaidBooking();

      for (const cause of ['goodwill', 'platform_error'] as const) {
        const result = await refunds.refundPartial({
          bookingId,
          amountPaise: 10_000,
          terms: { cause, delivery: 'original' },
          reason: 'Customer kept waiting by our estimate',
          initiatedBy: adminId,
          keySource: adminKey(),
        });
        expect(result.providerSharePaise).toBe(0);
      }

      expect(await legs(bookingId)).toEqual([{ type: 'driver_share_credit', amount: '900.00' }]);
      await expectNoDrift();
    });

    it('a fleet trip shares the driver side between the fleet and its driver', async () => {
      // "Fleet" is never named by the admin: the engine reads who the trip
      // actually paid. Here it paid both, 270 to the fleet and 630 to the
      // driver, so each gives back its own proportion of the 180.
      const fleet = await seedFleet(db, 'Share Fleet');
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
      await seedWalletWithLedger(db, { ownerType: 'fleet', ownerId: fleet.fleetId }, [
        { type: 'fleet_share_credit', amount: '270.00', refId: bookingId },
      ]);
      await seedWalletWithLedger(db, { ownerType: 'driver', ownerId: driverId }, [
        { type: 'driver_share_credit', amount: '630.00', refId: bookingId },
      ]);

      const result = await refunds.refundPartial({
        bookingId,
        amountPaise: 20_000,
        terms: { cause: 'fare_error', delivery: 'original' },
        reason: 'Waiting time was counted twice',
        initiatedBy: adminId,
        keySource: adminKey(),
      });

      expect(result.providerSharePaise).toBe(18_000);
      const debits = (await legs(bookingId))
        .filter((leg) => leg.type === 'refund_debit')
        .map((leg) => leg.amount)
        .sort();
      expect(debits).toEqual(['-126.00', '-54.00']);
      await expectNoDrift();
    });

    it('misconduct puts it all on the driver side, but never more than the trip paid them', async () => {
      const bookingId = await seedPaidBooking();
      const gateway = vi.spyOn(app.get(PAYMENT_GATEWAY), 'refund');
      gateway.mockClear();

      // ₹950 back to the customer would take ₹950 from a driver who was paid
      // ₹900. Refused before the gateway is called.
      await expect(
        refunds.refundPartial({
          bookingId,
          amountPaise: 95_000,
          terms: { cause: 'driver_misconduct', delivery: 'original' },
          reason: 'Driver was abusive',
          initiatedBy: adminId,
          keySource: adminKey(),
        }),
      ).rejects.toMatchObject({ status: 422 });
      expect(gateway).not.toHaveBeenCalled();

      // The same complaint with MiTow covering the rest is an override, and
      // the engine takes it.
      const result = await refunds.refundPartial({
        bookingId,
        amountPaise: 95_000,
        terms: {
          cause: 'driver_misconduct',
          bearer: 'shared',
          overrideReason: 'First complaint in two years; sharing the cost',
          delivery: 'original',
        },
        reason: 'Driver was abusive',
        initiatedBy: adminId,
        keySource: adminKey(),
      });
      expect(result.providerSharePaise).toBe(85_500);
      expect(await refundRow(result.refundId)).toMatchObject({
        liability: 'shared',
        cause: 'driver_misconduct',
        bearer_override_reason: 'First complaint in two years; sharing the cost',
      });
      await expectNoDrift();
    });

    it('wallet delivery sends every rupee to the wallet, and a later full refund cannot pay the card twice', async () => {
      const bookingId = await seedPaidBooking();
      const gateway = vi.spyOn(app.get(PAYMENT_GATEWAY), 'refund');
      gateway.mockClear();

      const partial = await refunds.refundPartial({
        bookingId,
        amountPaise: 30_000,
        terms: { cause: 'goodwill', delivery: 'wallet' },
        reason: 'Sorry for the wait',
        initiatedBy: adminId,
        keySource: adminKey(),
      });

      // No card refund, the whole ₹300 as MiTow credit, done at once.
      expect(gateway).not.toHaveBeenCalled();
      expect(await refundRow(partial.refundId)).toMatchObject({
        delivery: 'wallet',
        status: 'processed',
        // The POOL it came from is still the card's, which is what keeps the
        // next refund honest.
        gateway_amount: '300.00',
        wallet_amount: '0.00',
      });
      const [credit] = (await db.execute(sql`
        select coalesce(sum(t.amount), 0)::text as credited
          from wallet_transactions t join wallets w on w.id = t.wallet_id
         where t.ref_id = ${bookingId}::uuid and w.owner_type = 'user'
           and t.type = 'refund_credit'
      `)) as unknown as [{ credited: string }];
      expect(credit.credited).toBe('300.00');

      // The full refund returns the REMAINING ₹700 to the card, not ₹1000:
      // the customer gets ₹1000 in total, never ₹1300.
      await refunds.refundBooking({
        bookingId,
        reason: 'dispute',
        initiatedBy: adminId,
        transitionTo: 'disputed',
        keySource: adminKey(),
      });
      expect(gateway).toHaveBeenCalledTimes(1);
      expect(gateway.mock.calls[0]![0]).toMatchObject({ amountPaise: 70_000 });
      expect(await paymentOf(bookingId)).toEqual({ status: 'refunded', refunded: '1000.00' });
      await expectNoDrift();
    });

    it('a refund resumed after a crash claws back the share decided at issue time', async () => {
      // The crash window: the card refund went through, the clawback did not.
      // The replay must finish the job with the STORED share, not charge the
      // driver the whole refund (which the old resume path did for any
      // non-platform refund).
      const bookingId = await seedPaidBooking();
      const keySource = adminKey();
      const post = vi
        .spyOn(app.get(LedgerService), 'post')
        .mockRejectedValueOnce(new Error('connection reset'));

      await expect(
        refunds.refundPartial({
          bookingId,
          amountPaise: 20_000,
          terms: { cause: 'fare_error', delivery: 'original' },
          reason: 'Longer route',
          initiatedBy: adminId,
          keySource,
        }),
      ).rejects.toThrow('connection reset');
      post.mockRestore();
      expect((await legs(bookingId)).filter((leg) => leg.type === 'refund_debit')).toEqual([]);

      const resumed = await refunds.refundPartial({
        bookingId,
        amountPaise: 20_000,
        terms: { cause: 'fare_error', delivery: 'original' },
        reason: 'Longer route',
        initiatedBy: adminId,
        keySource,
      });

      expect(resumed).toMatchObject({ replayed: true, providerSharePaise: 18_000 });
      expect((await legs(bookingId)).filter((leg) => leg.type === 'refund_debit')).toEqual([
        { type: 'refund_debit', amount: '-180.00' },
      ]);
      await expectNoDrift();
    });
  });
});
