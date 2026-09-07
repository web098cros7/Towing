import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { rupeeStringToPaise } from '@towing/api-contracts';
import {
  adminAuthHeaderFor,
  authHeaderFor,
  createTestApp,
  driverAuthHeaderFor,
} from '../../test/app';
import {
  seedAdmin,
  seedDriver,
  seedFleet,
  seedPayoutAccount,
  setupTestDatabase,
  truncateAll,
  type TestDatabase,
} from '../../test/db';
import { seedWalletWithLedger } from '../../test/fixtures';

/**
 * §9.4.10's Finance approval queue, and §14.4's threshold.
 *
 * THE DECISIVE TEST IN THIS FILE is "a second request is blocked while one
 * awaits approval". It is the whole argument for making `approval_state` a
 * separate column rather than a fifth `payout_status` value:
 * `uq_payouts_one_open_per_owner` is partial on
 * `status IN ('requested','processing')`, so a payout waiting on Finance is
 * still inside that predicate and the index needs no change at all. A new enum
 * value would have meant altering a partial unique index on money for nothing.
 */
describe('admin finance e2e (/v1/admin/finance)', () => {
  let app: INestApplication;
  let db: TestDatabase;
  let financeAuth: string;
  let opsAuth: string;
  let driverId: string;
  let driverAuth: string;

  beforeAll(async () => {
    db = await setupTestDatabase();
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await truncateAll();

    const finance = await seedAdmin(db, { subRole: 'finance' });
    const ops = await seedAdmin(db, { subRole: 'operations' });
    financeAuth = await adminAuthHeaderFor(app, { adminId: finance.id, subRole: 'finance' });
    opsAuth = await adminAuthHeaderFor(app, { adminId: ops.id, subRole: 'operations' });

    driverId = await seedDriver(db, { name: 'Payout Driver' });
    driverAuth = await driverAuthHeaderFor(app, { driverId });

    // ₹50,000 earned, a linked destination, and the launch threshold of
    // ₹1,00,000 left alone unless a test moves it.
    await seedWalletWithLedger(db, { ownerType: 'driver', ownerId: driverId }, [
      { type: 'fare_credit', amount: '50000.00' },
    ]);
    await seedPayoutAccount(db, driverId, { ownerType: 'driver' });
  });

  const setThreshold = async (rupees: string): Promise<void> => {
    await db.execute(sql`
      insert into charge_config (singleton, payout_auto_approve_max)
      values (true, ${rupees}::numeric)
      on conflict (singleton) do update set payout_auto_approve_max = excluded.payout_auto_approve_max
    `);
    // The rate card is cached for five minutes; §6.7 means "no deploy", not
    // "eventually".
    await request(app.getHttpServer())
      .put('/v1/admin/finance/config')
      .set('Authorization', financeAuth)
      .send({ payoutAutoApproveMaxPaise: rupeeStringToPaise(rupees) })
      .expect(200);
  };

  const requestPayout = (amountPaise: number) =>
    request(app.getHttpServer())
      .post('/v1/driver/payouts')
      .set('Authorization', driverAuth)
      .set('Idempotency-Key', randomUUID())
      .send({ amountPaise });

  const balancePaise = async (): Promise<number> => {
    const [row] = (await db.execute(sql`
      select coalesce(balance, 0)::text as balance from wallets
       where owner_type = 'driver' and owner_id = ${driverId}::uuid
    `)) as unknown as [{ balance: string }];
    return rupeeStringToPaise(row.balance);
  };

  it('auto-approves below the threshold and calls the provider', async () => {
    await setThreshold('10000.00');

    const res = await requestPayout(500_000).expect(201);

    expect(res.body.approvalState).toBe('auto_approved');
    // The dev adapter accepts immediately, so it is already with the provider.
    expect(res.body.status).toBe('processing');
  });

  it('queues above the threshold — provider NOT called, wallet ALREADY debited', async () => {
    await setThreshold('10000.00');

    const res = await requestPayout(2_000_000).expect(201);

    expect(res.body.approvalState).toBe('pending_approval');
    // Still `requested`: `payout_status` is the VENDOR lifecycle, and no vendor
    // has been told about this yet.
    expect(res.body.status).toBe('requested');
    expect(res.body.providerRef).toBeNull();

    // THE HOLD IS TAKEN REGARDLESS. That is what stops the driver spending the
    // same balance twice while Finance deliberates — approval gates only the
    // vendor call, never the ledger.
    expect(await balancePaise()).toBe(5_000_000 - 2_000_000);
  });

  it('blocks a SECOND request while one awaits approval', async () => {
    // The decisive test — see the file header.
    await setThreshold('10000.00');
    await requestPayout(2_000_000).expect(201);

    const second = await requestPayout(1_000_000);
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('payout_already_pending');
  });

  it('approve sends it to the provider and writes an audit row', async () => {
    await setThreshold('10000.00');
    const created = await requestPayout(2_000_000).expect(201);

    const approved = await request(app.getHttpServer())
      .post(`/v1/admin/finance/payouts/${created.body.id}/approve`)
      .set('Authorization', financeAuth)
      .expect(200);

    expect(approved.body.status).toBe('processing');

    const [audit] = (await db.execute(sql`
      select action, subject_id from admin_actions where action = 'payout.approve'
    `)) as unknown as [{ action: string; subject_id: string }];
    expect(audit.subject_id).toBe(created.body.id);
  });

  it('a second approve is a 409, not a second payout', async () => {
    await setThreshold('10000.00');
    const created = await requestPayout(2_000_000).expect(201);

    await request(app.getHttpServer())
      .post(`/v1/admin/finance/payouts/${created.body.id}/approve`)
      .set('Authorization', financeAuth)
      .expect(200);

    // `decideApproval`'s zero-row result means somebody already decided, and
    // the caller must then do nothing at all — no vendor call, no audit row.
    await request(app.getHttpServer())
      .post(`/v1/admin/finance/payouts/${created.body.id}/approve`)
      .set('Authorization', financeAuth)
      .expect(409);

    const [audits] = (await db.execute(sql`
      select count(*)::int as count from admin_actions where action = 'payout.approve'
    `)) as unknown as [{ count: number }];
    expect(audits.count).toBe(1);
  });

  it('reject restores the balance TO THE PAISA via a compensating entry', async () => {
    await setThreshold('10000.00');
    const created = await requestPayout(2_000_000).expect(201);

    expect(await balancePaise()).toBe(3_000_000);

    await request(app.getHttpServer())
      .post(`/v1/admin/finance/payouts/${created.body.id}/reject`)
      .set('Authorization', financeAuth)
      .send({ reason: 'Bank details do not match the KYC name' })
      .expect(200);

    // §14.5: a NEW leg with the opposite sign, never an edit. Both facts stay
    // in the history.
    expect(await balancePaise()).toBe(5_000_000);

    // ⚠ NO `order by type` HERE, and the reason is a Postgres subtlety worth
    // knowing: ORDER BY on an ENUM column sorts by DECLARATION order, not
    // alphabetically. `wallet_txn_type` declares `payout_debit` before
    // `adjustment`, so an assertion written against alphabetical order fails
    // for a reason that looks like a bug in the code under test.
    const legs = (await db.execute(sql`
      select type from wallet_transactions where ref_id = ${created.body.id}::uuid
    `)) as unknown as Array<{ type: string }>;
    expect(legs.map((leg) => leg.type).sort()).toEqual(['adjustment', 'payout_debit']);

    const [payout] = (await db.execute(sql`
      select status, approval_state, rejection_reason, failure_reason
        from payouts where id = ${created.body.id}::uuid
    `)) as unknown as [Record<string, string>];
    expect(payout.approval_state).toBe('rejected');
    expect(payout.status).toBe('failed');
    expect(payout.failure_reason).toContain('Rejected by Finance');
  });

  it('reject requires a reason', async () => {
    await setThreshold('10000.00');
    const created = await requestPayout(2_000_000).expect(201);

    await request(app.getHttpServer())
      .post(`/v1/admin/finance/payouts/${created.body.id}/reject`)
      .set('Authorization', financeAuth)
      .send({})
      .expect(422);
  });

  it('a driver payout failure writes ZERO alert rows', async () => {
    // `alerts.fleet_id` is an FK to `fleets`, so a driver payout cannot be
    // represented there — `openPayoutFailedAlert`'s SELECT already filters
    // `owner_type = 'fleet'` and therefore inserts nothing. The driver-facing
    // substitute is the §12.2 `payout_status` notification, which already
    // resolves all three owner types.
    await setThreshold('10000.00');
    const created = await requestPayout(2_000_000).expect(201);

    await request(app.getHttpServer())
      .post(`/v1/admin/finance/payouts/${created.body.id}/reject`)
      .set('Authorization', financeAuth)
      .send({ reason: 'Testing the alert path' })
      .expect(200);

    const [alerts] = (await db.execute(sql`
      select count(*)::int as count from alerts where subject_type = 'payout'
    `)) as unknown as [{ count: number }];
    expect(alerts.count).toBe(0);
  });

  it('the queue shows the owner name and a redacted destination', async () => {
    await setThreshold('10000.00');
    await requestPayout(2_000_000).expect(201);

    const queue = await request(app.getHttpServer())
      .get('/v1/admin/finance/payouts')
      .set('Authorization', financeAuth)
      .expect(200);

    expect(queue.body.items).toHaveLength(1);
    expect(queue.body.items[0]).toMatchObject({
      ownerType: 'driver',
      ownerName: 'Payout Driver',
      approvalState: 'pending_approval',
    });
    expect(queue.body.items[0].destinationLast4).not.toBeNull();
  });

  it('FLEET payouts join the same threshold', async () => {
    // A behaviour change, not a new feature: fleet payouts bypassed approval
    // entirely from Track A Phase 7 until Phase 19.
    await setThreshold('10000.00');

    const fleet = await seedFleet(db, 'Threshold Fleet');
    await seedWalletWithLedger(db, { ownerType: 'fleet', ownerId: fleet.fleetId }, [
      { type: 'fleet_share_credit', amount: '50000.00' },
    ]);
    await seedPayoutAccount(db, fleet.fleetId);

    const fleetAuth = await authHeaderFor(app, { userId: fleet.ownerId, fleetId: fleet.fleetId });

    const res = await request(app.getHttpServer())
      .post('/v1/fleet/payouts')
      .set('Authorization', fleetAuth)
      .set('Idempotency-Key', randomUUID())
      .send({ amountPaise: 2_000_000 })
      .expect(201);

    expect(res.body.approvalState).toBe('pending_approval');
  });

  describe('RBAC', () => {
    it('operations cannot read or decide', async () => {
      await request(app.getHttpServer())
        .get('/v1/admin/finance/payouts')
        .set('Authorization', opsAuth)
        .expect(403);
    });

    it('a driver token cannot reach the admin realm', async () => {
      await request(app.getHttpServer())
        .get('/v1/admin/finance/payouts')
        .set('Authorization', driverAuth)
        .expect(403);
    });
  });

  describe('config', () => {
    it('serves and updates the money knobs, and audits the change', async () => {
      const before = await request(app.getHttpServer())
        .get('/v1/admin/finance/config')
        .set('Authorization', financeAuth)
        .expect(200);

      expect(before.body.taxPct).toBe(0);

      await request(app.getHttpServer())
        .put('/v1/admin/finance/config')
        .set('Authorization', financeAuth)
        .send({ cancelDriverCompPct: 60 })
        .expect(200);

      const after = await request(app.getHttpServer())
        .get('/v1/admin/finance/config')
        .set('Authorization', financeAuth)
        .expect(200);

      expect(after.body.cancelDriverCompPct).toBe(60);

      const [audit] = (await db.execute(sql`
        select count(*)::int as count from admin_actions where action = 'finance.config.update'
      `)) as unknown as [{ count: number }];
      expect(audit.count).toBeGreaterThan(0);
    });

    it('refuses a partial window that starts before the free one ends', async () => {
      await request(app.getHttpServer())
        .put('/v1/admin/finance/config')
        .set('Authorization', financeAuth)
        .send({ cancelFreeMinutes: 10, cancelPartialMinutes: 5 })
        .expect(422);
    });
  });
});
