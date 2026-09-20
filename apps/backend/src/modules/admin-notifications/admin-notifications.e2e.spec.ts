import type { INestApplication } from '@nestjs/common';
import {
  adminNotificationDeliveriesResponseSchema,
  adminNotificationTemplatesResponseSchema,
} from '@towing/api-contracts';
import { desc, sql } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { adminActions } from '../../db/schema';
import { adminAuthHeaderFor, createTestApp } from '../../test/app';
import { expectMatchesContract } from '../../test/contracts';
import { seedAdmin, setupTestDatabase, truncateAll, type TestDatabase } from '../../test/db';
import { closeTestRedis, flushTestRedis } from '../../test/redis';

/**
 * W18 — the notification console (§12.3), backend.
 *
 * WHAT MATTERS HERE, in the guide's own framing: the catalogue is READ-ONLY
 * and it tells the truth about which channels cannot send (every SMS and
 * WhatsApp row today, because DLT and Meta approvals are pending); the
 * delivery log is masked at rest; and the test-send is super-admin-only and
 * CANNOT BE POINTED AT ANYBODY — there is no destination field, and the test
 * proves the destination comes from the caller's own admin row.
 */
describe('notification console (/v1/admin/notifications, W18)', () => {
  let app: INestApplication;
  let db: TestDatabase;
  let opsAuth: string;
  let supportAuth: string;
  let financeAuth: string;
  let superId: string;
  let superMobile: string;
  let superEmail: string;
  let superAuth: string;

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

    opsAuth = await adminAuthHeaderFor(app, {
      adminId: (await seedAdmin(db, { subRole: 'operations' })).id,
      subRole: 'operations',
    });
    supportAuth = await adminAuthHeaderFor(app, {
      adminId: (await seedAdmin(db, { subRole: 'support' })).id,
      subRole: 'support',
    });
    financeAuth = await adminAuthHeaderFor(app, {
      adminId: (await seedAdmin(db, { subRole: 'finance' })).id,
      subRole: 'finance',
    });

    const superAdmin = await seedAdmin(db, { subRole: 'super_admin' });
    superId = superAdmin.id;
    superMobile = superAdmin.mobile;
    superEmail = superAdmin.email;
    superAuth = await adminAuthHeaderFor(app, { adminId: superId, subRole: 'super_admin' });
  });

  it('serves the catalogue and names the channels that cannot send', async () => {
    const res = await request(app.getHttpServer())
      .get('/v1/admin/notifications/templates')
      .set('Authorization', opsAuth)
      .expect(200);

    expectMatchesContract(adminNotificationTemplatesResponseSchema, res.body);
    expect(res.body.items.length).toBeGreaterThan(20);

    // `driver_kyc_approved` fans out on sms + whatsapp, and BOTH provider
    // template ids are null (DLT + Meta pending) — the screen must say so.
    const kyc = res.body.items.find(
      (item: { templateKey: string }) => item.templateKey === 'driver_kyc_approved',
    );
    expect(kyc).toBeDefined();
    expect(kyc.channels).toEqual(expect.arrayContaining(['sms', 'whatsapp']));
    expect(kyc.unusableChannels).toEqual(expect.arrayContaining(['sms', 'whatsapp']));
    expect(kyc.sampleTitle.length).toBeGreaterThan(0);

    // Every trigger is wired as of W14 (`DEFERRED_TRIGGERS` is empty), so the
    // "unwired template" state is not reachable — but email-less templates are,
    // and they must say so with a null subject rather than an invented one.
    const emailLess = res.body.items.filter(
      (item: { sampleSubject: string | null }) => item.sampleSubject === null,
    );
    expect(emailLess.length).toBeGreaterThan(0);

    // The catalogue has no write surface at all.
    await request(app.getHttpServer())
      .post('/v1/admin/notifications/templates')
      .set('Authorization', superAuth)
      .send({})
      .expect(404);
  });

  it('lists masked deliveries and reports the dead-letter depth', async () => {
    const [event] = (await db.execute(sql`
      insert into notification_events (event, payload)
      values ('contract.delivery', '{}'::jsonb)
      returning id
    `)) as unknown as [{ id: string }];

    await db.execute(sql`
      insert into notification_deliveries
        (event_id, recipient_key, channel, destination, status, vendor, attempts, sent_at)
      values (${event!.id}::uuid, 'user:00000000-0000-4000-8000-000000000001', 'email',
              'c***@example.com', 'sent', 'log', 1, now())
    `);

    const res = await request(app.getHttpServer())
      .get('/v1/admin/notifications/deliveries?status=sent')
      .set('Authorization', opsAuth)
      .expect(200);

    expectMatchesContract(adminNotificationDeliveriesResponseSchema, res.body);
    expect(res.body.total).toBe(1);
    expect(res.body.items[0]).toMatchObject({
      event: 'contract.delivery',
      channel: 'email',
      status: 'sent',
      destination: 'c***@example.com',
    });
    expect(typeof res.body.deadLetterDepth).toBe('number');

    const skipped = await request(app.getHttpServer())
      .get('/v1/admin/notifications/deliveries?status=skipped')
      .set('Authorization', opsAuth)
      .expect(200);
    expect(skipped.body.total).toBe(0);

    // Support reads incident logs; finance does not.
    await request(app.getHttpServer())
      .get('/v1/admin/notifications/deliveries')
      .set('Authorization', supportAuth)
      .expect(200);
    await request(app.getHttpServer())
      .get('/v1/admin/notifications/templates')
      .set('Authorization', financeAuth)
      .expect(403);
    await request(app.getHttpServer())
      .get('/v1/admin/notifications/templates')
      .expect(401);
  });

  it('test-sends only to the caller, and only for super admins', async () => {
    // Ops reads the console; the one route that SENDS is super-admin only.
    await request(app.getHttpServer())
      .post('/v1/admin/notifications/test-send')
      .set('Authorization', opsAuth)
      .send({ channel: 'sms', templateKey: 'driver_kyc_approved' })
      .expect(403);

    const sms = await request(app.getHttpServer())
      .post('/v1/admin/notifications/test-send')
      .set('Authorization', superAuth)
      .send({ channel: 'sms', templateKey: 'driver_kyc_approved' })
      .expect(200);
    // Default env runs the log adapters: `sent: true`, no provider code.
    expect(sms.body).toMatchObject({ sent: true, channel: 'sms', code: null });
    expect(sms.body.destination).toMatch(/^\*+/);
    expect(sms.body.destination).not.toBe(superMobile);
    expect(sms.body.destination.endsWith(superMobile.slice(-4))).toBe(true);

    const email = await request(app.getHttpServer())
      .post('/v1/admin/notifications/test-send')
      .set('Authorization', superAuth)
      .send({ channel: 'email', templateKey: 'job_invoice_email' })
      .expect(200);
    expect(email.body.sent).toBe(true);
    expect(email.body.destination).toContain('***@');
    expect(email.body.destination).not.toBe(superEmail);

    await request(app.getHttpServer())
      .post('/v1/admin/notifications/test-send')
      .set('Authorization', superAuth)
      .send({ channel: 'sms', templateKey: 'no_such_template' })
      .expect(422);

    const audit = await db.select().from(adminActions).orderBy(desc(adminActions.createdAt));
    const row = audit.find((entry) => entry.action === 'notification.test_send');
    expect(row?.adminId).toBe(superId);
    expect(row?.after).toMatchObject({ channel: 'email', sent: true });
  });
});
