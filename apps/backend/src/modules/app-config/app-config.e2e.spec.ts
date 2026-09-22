import type { INestApplication } from '@nestjs/common';
import { appConfigSchema, type AppConfig } from '@towing/api-contracts';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { adminActions, appConfig } from '../../db/schema';
import { adminAuthHeaderFor, createTestApp } from '../../test/app';
import { expectMatchesContract } from '../../test/contracts';
import {
  seedAdmin,
  setupTestDatabase,
  testDb,
  truncateAll,
  type TestDatabase,
} from '../../test/db';
import { closeTestRedis, flushTestRedis } from '../../test/redis';
import { AppConfigRepo } from './app-config.repo';

/**
 * W12 — §19.8's minimum-supported-version gate and §19.9's SEV banner.
 *
 * TWO ROUTES, ONE ROW: the public `GET /v1/app-config` the handsets read at
 * launch (no session — a build that must force-upgrade cannot authenticate
 * against the API it is too old to call) and the admin read/write.
 */
describe('app config (W12)', () => {
  let app: INestApplication;
  let db: TestDatabase;
  let opsAuth: string;
  let opsId: string;

  beforeAll(async () => {
    await setupTestDatabase();
    db = testDb();
    app = await createTestApp();
  });

  beforeEach(async () => {
    await truncateAll();
    await flushTestRedis();
    await app.get(AppConfigRepo).invalidate();
    const ops = await seedAdmin(db, { subRole: 'operations' });
    opsId = ops.id;
    opsAuth = await adminAuthHeaderFor(app, { adminId: ops.id, subRole: 'operations' });
  });

  afterAll(async () => {
    await app.close();
    await closeTestRedis();
  });

  it('serves the public route with NO session, against its contract', async () => {
    await request(app.getHttpServer())
      .get('/v1/app-config')
      .expect(200)
      .expect(({ body }) => {
        expectMatchesContract(appConfigSchema, body);
        expect(body).toMatchObject({
          minCustomerVersion: '1.0.0',
          minDriverVersion: '1.0.0',
          forceUpgrade: false,
          sevLevel: null,
        });
      });
  });

  it('answers 304 when If-None-Match matches the ETag it served', async () => {
    const first = await request(app.getHttpServer()).get('/v1/app-config').expect(200);
    const etag = first.headers.etag!;
    expect(etag).toBeTruthy();

    await request(app.getHttpServer()).get('/v1/app-config').set('If-None-Match', etag).expect(304);

    // The tag covers the CONTENT, so a raised banner is a new tag — the whole
    // point of an ETag on the endpoint §19.9 depends on.
    await request(app.getHttpServer())
      .put('/v1/admin/app-config')
      .set('Authorization', opsAuth)
      .send({ sevLevel: 'sev1', sevMessage: 'Dispatch is degraded', reason: 'Incident 42' })
      .expect(200);

    const after = await request(app.getHttpServer()).get('/v1/app-config').expect(200);
    expect(after.headers.etag).not.toBe(etag);
  });

  it('lets operations raise a SEV banner and lower the version gate, audited', async () => {
    const response = await request(app.getHttpServer())
      .put('/v1/admin/app-config')
      .set('Authorization', opsAuth)
      .send({
        minCustomerVersion: '1.4.2',
        forceUpgrade: true,
        sevLevel: 'sev2',
        sevMessage: 'Payments are slow',
        reason: 'Payments incident',
      })
      .expect(200);

    expect(response.body).toMatchObject({
      minCustomerVersion: '1.4.2',
      forceUpgrade: true,
      sevLevel: 'sev2',
      sevMessage: 'Payments are slow',
    });
    expect(response.body.sevUpdatedAt).toBeTruthy();

    const audits = await db
      .select()
      .from(adminActions)
      .where(eq(adminActions.action, 'app_config.update'));
    expect(audits).toHaveLength(1);
    expect(audits[0]!.adminId).toBe(opsId);
    expect(audits[0]!.reason).toBe('Payments incident');
    // Whole before/after, so "what did the banner say when" is answerable.
    expect(audits[0]!.before).toMatchObject({ sevLevel: null });
    expect(audits[0]!.after).toMatchObject({ sevLevel: 'sev2' });
  });

  it('clears the banner with an explicit null pair', async () => {
    await db.insert(appConfig).values({ sevLevel: 'sev3', sevMessage: 'Minor' });
    await app.get(AppConfigRepo).invalidate();

    const response = await request(app.getHttpServer())
      .put('/v1/admin/app-config')
      .set('Authorization', opsAuth)
      .send({ sevLevel: null, sevMessage: null })
      .expect(200);

    expect(response.body.sevLevel).toBeNull();
    expect(response.body.sevMessage).toBeNull();
    expect(response.body.sevUpdatedAt).toBeNull();
  });

  it('refuses a level without a message — they are one decision', async () => {
    await request(app.getHttpServer())
      .put('/v1/admin/app-config')
      .set('Authorization', opsAuth)
      .send({ sevLevel: 'sev1' })
      .expect(422);
  });

  it('refuses a version that is not a semver, and an empty update', async () => {
    await request(app.getHttpServer())
      .put('/v1/admin/app-config')
      .set('Authorization', opsAuth)
      .send({ minCustomerVersion: 'latest' })
      .expect(422);

    await request(app.getHttpServer())
      .put('/v1/admin/app-config')
      .set('Authorization', opsAuth)
      .send({ reason: 'Nothing at all' })
      .expect(422);
  });

  it('keeps finance and support out — the banner rides `dispatch.config`', async () => {
    for (const subRole of ['finance', 'support'] as const) {
      const admin = await seedAdmin(db, { subRole });
      const auth = await adminAuthHeaderFor(app, { adminId: admin.id, subRole });
      await request(app.getHttpServer())
        .get('/v1/admin/app-config')
        .set('Authorization', auth)
        .expect(403);
      await request(app.getHttpServer())
        .put('/v1/admin/app-config')
        .set('Authorization', auth)
        .send({ forceUpgrade: true })
        .expect(403);
    }
  });

  it('falls back to the documented defaults when the row is missing', async () => {
    // `truncateAll` left the table empty; every handset must still be able to
    // start rather than 500 on a config read.
    const response = await request(app.getHttpServer()).get('/v1/app-config').expect(200);
    const body = response.body as AppConfig;
    expect(body.forceUpgrade).toBe(false);
    expect(body.sevLevel).toBeNull();
  });
});
