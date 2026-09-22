import type { INestApplication } from '@nestjs/common';
import {
  adminBannersResponseSchema,
  adminCouponRedemptionsResponseSchema,
  adminCouponsResponseSchema,
  adminCouponSchema,
  couponValidationSchema,
} from '@towing/api-contracts';
import { sql } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { adminActions } from '../../db/schema';
import { ledgerInvariants } from '../../db/ledger/invariants';
import { CouponsService } from '../coupons/coupons.service';
import { adminAuthHeaderFor, createTestApp, customerAuthHeaderFor } from '../../test/app';
import { expectMatchesContract } from '../../test/contracts';
import {
  seedAdmin,
  seedCustomer,
  setupTestDatabase,
  truncateAll,
  type TestDatabase,
} from '../../test/db';
import { seedBooking } from '../../test/fixtures';

/**
 * W16 — §9.4.11's coupon manager, backend (`/v1/admin/coupons`).
 *
 * The phase's verification, quoted: "editing a coupon never changes used_count;
 * the coupon ledger invariant stays zero; an expired coupon is refused at
 * validation". The first is asserted against a coupon with a REAL redemption
 * behind it — a coupon nobody used has `used_count = 0` whatever the edit
 * does, so the test claims a use (through the same `applyInTransaction` the
 * confirm path runs) before editing anything.
 */
describe('admin coupons (/v1/admin/coupons, W16)', () => {
  let app: INestApplication;
  let db: TestDatabase;
  let opsAuth: string;
  let supportAuth: string;
  let financeAuth: string;
  let customerAuth: string;
  let userId: string;

  beforeAll(async () => {
    db = await setupTestDatabase();
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await truncateAll();

    userId = await seedCustomer(db, 'Coupon Customer');
    customerAuth = await customerAuthHeaderFor(app, { userId });

    const ops = await seedAdmin(db, { subRole: 'operations' });
    opsAuth = await adminAuthHeaderFor(app, { adminId: ops.id, subRole: 'operations' });
    supportAuth = await adminAuthHeaderFor(app, {
      adminId: (await seedAdmin(db, { subRole: 'support' })).id,
      subRole: 'support',
    });
    financeAuth = await adminAuthHeaderFor(app, {
      adminId: (await seedAdmin(db, { subRole: 'finance' })).id,
      subRole: 'finance',
    });
  });

  const createCoupon = (body: Record<string, unknown> = {}, auth = opsAuth) =>
    request(app.getHttpServer())
      .post('/v1/admin/coupons')
      .set('Authorization', auth)
      .send({
        code: 'SAVE20',
        kind: 'percent',
        percentValue: 20,
        ...body,
      });

  it('creates a coupon and records the write', async () => {
    const res = await createCoupon().expect(200);

    expect(res.body).toMatchObject({
      code: 'SAVE20',
      kind: 'percent',
      percentValue: 20,
      flatValuePaise: null,
      usedCount: 0,
      isActive: true,
    });
    expectMatchesContract(adminCouponSchema, res.body);

    const audit = await db.select().from(adminActions);
    const row = audit.find((entry) => entry.action === 'coupon.create');
    expect(row?.subjectType).toBe('coupon');
    expect(row?.subjectId).toBe(res.body.id);
  });

  it('refuses a duplicate code (case-insensitive) with 409', async () => {
    await createCoupon().expect(200);
    const res = await createCoupon({ code: 'save20' }).expect(409);
    expect(res.body.error.code).toBe('conflict');
  });

  it('refuses values the database would reject with a 422 that names the field, never a 500', async () => {
    // The window rule used to read endsAt, a field coupons do not have, so a reversed window reached the CHECK constraint and came back as an opaque 500. Zero and out-of-range numbers did the same.
    const cases: Array<{ body: Record<string, unknown>; field: string }> = [
      {
        body: { startsAt: '2026-10-10T00:00:00.000Z', expiresAt: '2026-10-01T00:00:00.000Z' },
        field: 'expiresAt',
      },
      {
        body: { startsAt: '2026-10-10T00:00:00.000Z', expiresAt: '2026-10-10T00:00:00.000Z' },
        field: 'expiresAt',
      },
      { body: { percentValue: 0 }, field: 'percentValue' },
      { body: { percentValue: 150 }, field: 'percentValue' },
      {
        body: { kind: 'flat', percentValue: undefined, flatValuePaise: 0 },
        field: 'flatValuePaise',
      },
      { body: { maxUses: 2_147_483_648 }, field: 'maxUses' },
      {
        body: { kind: 'flat', percentValue: undefined, flatValuePaise: 1_000_000_000_000 },
        field: 'flatValuePaise',
      },
    ];

    for (const { body, field } of cases) {
      const res = await createCoupon(body).expect(422);
      expect(res.body.error.code).toBe('validation_failed');
      const paths = res.body.error.details.issues.map((issue: { path: string }) => issue.path);
      expect(paths, JSON.stringify(body)).toContain(field);
    }

    // Nothing was written.
    const [{ n }] = (await db.execute(sql`select count(*)::int as n from coupons`)) as unknown as [
      { n: number },
    ];
    expect(n).toBe(0);
  });

  it('an edit never moves used_count, and the redemption ledger stays whole', async () => {
    const created = (await createCoupon({ maxUses: 10 }).expect(200)).body;

    // Claim a use the way the confirm path does — the counter and the
    // redemption row move together, so the edit below has something real to
    // leave alone.
    const bookingId = await seedBooking(db, {
      userId,
      status: 'searching',
      total: '2000.00',
    });
    const coupons = app.get(CouponsService);
    await db.transaction((tx) =>
      coupons.applyInTransaction(tx, {
        userId,
        bookingId,
        code: 'SAVE20',
        subtotalPaise: 200_000,
      }),
    );

    const updated = (
      await request(app.getHttpServer())
        .put(`/v1/admin/coupons/${created.id}`)
        .set('Authorization', opsAuth)
        .send({ percentValue: 25, maxUses: 5, isActive: false, reason: 'tightened' })
        .expect(200)
    ).body;

    // Read-only by construction: `usedCount` never appears in a write body,
    // and the service never includes it in an UPDATE.
    expect(updated.usedCount).toBe(1);
    expect(updated.percentValue).toBe(25);
    expect(updated.maxUses).toBe(5);
    expect(updated.isActive).toBe(false);

    const [row] = (await db.execute(sql`
      select used_count from coupons where id = ${created.id}::uuid
    `)) as unknown as [{ used_count: number }];
    expect(row.used_count).toBe(1);

    const [redemptions] = (await db.execute(sql`
      select count(*)::int as count from coupon_redemptions where coupon_id = ${created.id}::uuid
    `)) as unknown as [{ count: number }];
    expect(redemptions.count).toBe(1);

    await expect(ledgerInvariants(db)).resolves.toMatchObject({ couponDrift: 0 });

    const audit = await db.select().from(adminActions);
    const update = audit.find((entry) => entry.action === 'coupon.update');
    expect(update?.subjectId).toBe(created.id);
    expect(update?.reason).toBe('tightened');
  });

  it('an expired coupon is refused at validation, and an admin can rebuild the window', async () => {
    const created = (
      await createCoupon({
        expiresAt: new Date(Date.now() - 86_400_000).toISOString(),
      }).expect(200)
    ).body;

    const refused = await request(app.getHttpServer())
      .post('/v1/coupons/validate')
      .set('Authorization', customerAuth)
      .send({ code: 'SAVE20', subtotalPaise: 200_000 })
      .expect(200);
    expectMatchesContract(couponValidationSchema, refused.body);
    expect(refused.body).toMatchObject({ valid: false, reason: 'expired' });

    await request(app.getHttpServer())
      .put(`/v1/admin/coupons/${created.id}`)
      .set('Authorization', opsAuth)
      .send({ expiresAt: new Date(Date.now() + 86_400_000).toISOString() })
      .expect(200);

    const accepted = await request(app.getHttpServer())
      .post('/v1/coupons/validate')
      .set('Authorization', customerAuth)
      .send({ code: 'SAVE20', subtotalPaise: 200_000 })
      .expect(200);
    expect(accepted.body.valid).toBe(true);
    expect(accepted.body.discountPaise).toBe(40_000);
  });

  it('a kind switch must bring its value — and the list prices both kinds', async () => {
    const created = (await createCoupon().expect(200)).body;

    const refused = await request(app.getHttpServer())
      .put(`/v1/admin/coupons/${created.id}`)
      .set('Authorization', opsAuth)
      .send({ kind: 'flat' })
      .expect(422);
    expect(refused.body.error.code).toBe('validation_failed');

    const switched = (
      await request(app.getHttpServer())
        .put(`/v1/admin/coupons/${created.id}`)
        .set('Authorization', opsAuth)
        .send({ kind: 'flat', flatValuePaise: 15_000 })
        .expect(200)
    ).body;
    expect(switched).toMatchObject({
      kind: 'flat',
      percentValue: null,
      flatValuePaise: 15_000,
    });

    const list = await request(app.getHttpServer())
      .get('/v1/admin/coupons?code=save&isActive=true')
      .set('Authorization', opsAuth)
      .expect(200);
    expectMatchesContract(adminCouponsResponseSchema, list.body);
    expect(list.body.total).toBe(1);
    expect(list.body.items[0]).toMatchObject({ kind: 'flat', flatValuePaise: 15_000 });
  });

  it('lists the redemptions behind the counter, with the booking code', async () => {
    const created = (await createCoupon().expect(200)).body;
    const bookingId = await seedBooking(db, { userId, status: 'searching', total: '2000.00' });
    const coupons = app.get(CouponsService);
    await db.transaction((tx) =>
      coupons.applyInTransaction(tx, {
        userId,
        bookingId,
        code: 'SAVE20',
        subtotalPaise: 200_000,
      }),
    );

    const res = await request(app.getHttpServer())
      .get(`/v1/admin/coupons/${created.id}/redemptions`)
      .set('Authorization', opsAuth)
      .expect(200);

    expectMatchesContract(adminCouponRedemptionsResponseSchema, res.body);
    expect(res.body.total).toBe(1);
    expect(res.body.items[0]).toMatchObject({
      userId,
      bookingId,
      discountPaise: 40_000,
    });
    expect(res.body.items[0].bookingCode.length).toBeGreaterThan(0);

    await request(app.getHttpServer())
      .get(`/v1/admin/coupons/${'00000000-0000-4000-8000-000000000000'}/redemptions`)
      .set('Authorization', opsAuth)
      .expect(404);
  });

  it('is a role matrix: ops creates, support/finance are refused, anon is 401', async () => {
    await createCoupon({}, opsAuth).expect(200);
    await createCoupon({ code: 'OTHER1' }, supportAuth).expect(403);
    await createCoupon({ code: 'OTHER2' }, financeAuth).expect(403);

    await request(app.getHttpServer())
      .post('/v1/admin/coupons')
      .send({ code: 'ANON1', kind: 'flat', flatValuePaise: 100 })
      .expect(401);

    // Reads too — the manager is the same pair end to end.
    await request(app.getHttpServer())
      .get('/v1/admin/coupons')
      .set('Authorization', supportAuth)
      .expect(403);
    await request(app.getHttpServer())
      .get('/v1/admin/coupons')
      .set('Authorization', opsAuth)
      .expect(200);
  });
});

/**
 * Banners are a separate route family but the same authority and the same
 * phase; the spec lives here so one file owns "W16's admin surface".
 */
describe('admin banners (/v1/admin/banners + /v1/banners, W16)', () => {
  let app: INestApplication;
  let db: TestDatabase;
  let opsId: string;
  let opsAuth: string;
  let supportAuth: string;

  beforeAll(async () => {
    db = await setupTestDatabase();
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await truncateAll();
    const ops = await seedAdmin(db, { subRole: 'operations' });
    opsId = ops.id;
    opsAuth = await adminAuthHeaderFor(app, { adminId: ops.id, subRole: 'operations' });
    supportAuth = await adminAuthHeaderFor(app, {
      adminId: (await seedAdmin(db, { subRole: 'support' })).id,
      subRole: 'support',
    });
  });

  const presign = async (contentType = 'image/png'): Promise<{ key: string }> => {
    const res = await request(app.getHttpServer())
      .post('/v1/admin/banners/presign')
      .set('Authorization', opsAuth)
      .send({ contentType })
      .expect(200);
    return res.body;
  };

  it('mints upload keys under banner-images/, with the extension the content type asks for', async () => {
    const png = await presign('image/png');
    expect(png.key).toMatch(new RegExp(`^banner-images/${opsId}/banner-[0-9a-f-]{36}\\.png$`));

    const webp = await presign('image/webp');
    expect(webp.key.endsWith('.webp')).toBe(true);

    // The declared type decides the extension; a free-form filename never
    // reaches the key.
    await request(app.getHttpServer())
      .post('/v1/admin/banners/presign')
      .set('Authorization', opsAuth)
      .send({ contentType: 'image/svg+xml' })
      .expect(422);
  });

  it('refuses an imageKey that is not a minted key, on create and on update', async () => {
    const forged = await request(app.getHttpServer())
      .post('/v1/admin/banners')
      .set('Authorization', opsAuth)
      .send({ title: 'Forged', imageKey: 'banner-images/../../etc/passwd', audience: 'customer' })
      .expect(422);
    expect(forged.body.error.code).toBe('validation_failed');

    const slot = await presign();
    const created = (
      await request(app.getHttpServer())
        .post('/v1/admin/banners')
        .set('Authorization', opsAuth)
        .send({ title: 'Real', imageKey: slot.key, audience: 'customer' })
        .expect(200)
    ).body;

    await request(app.getHttpServer())
      .put(`/v1/admin/banners/${created.id}`)
      .set('Authorization', opsAuth)
      .send({ imageKey: 'driver-documents/abc/def.jpg' })
      .expect(422);
  });

  it('serves live banners in sort order and honours the window and the switch', async () => {
    const slot = await presign();
    const create = (body: Record<string, unknown>) =>
      request(app.getHttpServer())
        .post('/v1/admin/banners')
        .set('Authorization', opsAuth)
        .send({ title: 'Banner', imageKey: slot.key, audience: 'customer', ...body })
        .expect(200);

    // Three live, deliberately out of order.
    await create({ title: 'Second', sortOrder: 2 });
    await create({ title: 'First', sortOrder: 1 });

    // Three that must NOT surface.
    await create({
      title: 'Future',
      sortOrder: 0,
      startsAt: new Date(Date.now() + 86_400_000).toISOString(),
    });
    await create({
      title: 'Expired',
      sortOrder: 0,
      endsAt: new Date(Date.now() - 86_400_000).toISOString(),
    });
    await create({ title: 'Off', sortOrder: 0, isActive: false });
    await create({ title: 'Driver only', sortOrder: 0, audience: 'driver' });

    const publicRead = await request(app.getHttpServer())
      .get('/v1/banners?audience=customer')
      .expect(200);
    expect(publicRead.body.items.map((item: { title: string }) => item.title)).toEqual([
      'First',
      'Second',
    ]);
    const first = publicRead.body.items[0];
    expect(first.imageUrl).toContain('sig=');

    // The driver audience is a filter, not a different table.
    const driverRead = await request(app.getHttpServer())
      .get('/v1/banners?audience=driver')
      .expect(200);
    expect(driverRead.body.items.map((item: { title: string }) => item.title)).toEqual([
      'Driver only',
    ]);

    // The default audience is the customer carousel.
    const defaultRead = await request(app.getHttpServer()).get('/v1/banners').expect(200);
    expect(defaultRead.body.items).toHaveLength(2);

    const adminList = await request(app.getHttpServer())
      .get('/v1/admin/banners')
      .set('Authorization', opsAuth)
      .expect(200);
    expectMatchesContract(adminBannersResponseSchema, adminList.body);
    expect(adminList.body.items).toHaveLength(6);
  });

  it('reorders with a PUT and records both writes', async () => {
    const slot = await presign();
    const created = (
      await request(app.getHttpServer())
        .post('/v1/admin/banners')
        .set('Authorization', opsAuth)
        .send({ title: 'Movable', imageKey: slot.key, audience: 'customer', sortOrder: 5 })
        .expect(200)
    ).body;
    expect(created.sortOrder).toBe(5);

    const moved = (
      await request(app.getHttpServer())
        .put(`/v1/admin/banners/${created.id}`)
        .set('Authorization', opsAuth)
        .send({ sortOrder: 1, reason: 'rank ahead of the launch banner' })
        .expect(200)
    ).body;
    expect(moved.sortOrder).toBe(1);

    const audit = await db.select().from(adminActions);
    expect(audit.some((entry) => entry.action === 'banner.create')).toBe(true);
    const update = audit.find((entry) => entry.action === 'banner.update');
    expect(update?.subjectType).toBe('banner');
    expect(update?.reason).toBe('rank ahead of the launch banner');
  });

  it('refuses a window that ends before it starts, including across two edits', async () => {
    const slot = await presign();
    const startsAt = new Date(Date.now() + 86_400_000).toISOString();
    const endsAt = new Date(Date.now() + 172_800_000).toISOString();

    await request(app.getHttpServer())
      .post('/v1/admin/banners')
      .set('Authorization', opsAuth)
      .send({
        title: 'Bad window',
        imageKey: slot.key,
        audience: 'customer',
        startsAt,
        endsAt: startsAt,
      })
      .expect(422);

    const created = (
      await request(app.getHttpServer())
        .post('/v1/admin/banners')
        .set('Authorization', opsAuth)
        .send({ title: 'Good window', imageKey: slot.key, audience: 'customer', startsAt, endsAt })
        .expect(200)
    ).body;

    // Moving one half past the other half is refused against the EFFECTIVE
    // pair — the stored `ends_at` counts even though this request omits it.
    await request(app.getHttpServer())
      .put(`/v1/admin/banners/${created.id}`)
      .set('Authorization', opsAuth)
      .send({ startsAt: new Date(Date.now() + 259_200_000).toISOString() })
      .expect(422);
  });

  it('is a role matrix: ops manages, support is refused, the public read needs no session', async () => {
    await request(app.getHttpServer())
      .get('/v1/admin/banners')
      .set('Authorization', supportAuth)
      .expect(403);
    await request(app.getHttpServer()).get('/v1/banners').expect(200);
  });
});
