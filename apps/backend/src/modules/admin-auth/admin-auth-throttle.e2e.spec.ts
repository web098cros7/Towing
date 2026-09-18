/**
 * A7: `GET /v1/admin/auth/me` lives in the `reads` bucket, not `auth`.
 *
 * The suite disables throttling globally (see `src/test/setup.ts`), so this
 * file — which is ABOUT throttling — turns it back on for itself, exactly
 * like `tenant-throttler.guard.spec.ts`. It must happen before
 * `createTestApp()`: `ConfigModule` calls `loadEnv()` once per app boot, and
 * `vitest`'s `isolate: true` gives this file its own module graph, so the
 * assignment cannot leak into another spec.
 */
process.env.THROTTLE_DISABLED = '';

import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { adminAuthHeaderFor, createTestApp } from '../../test/app';
import { seedAdmin, setupTestDatabase, truncateAll, type TestDatabase } from '../../test/db';
import { closeTestRedis, flushTestRedis } from '../../test/redis';

describe('admin auth throttle buckets (A7)', () => {
  let app: INestApplication;
  let db: TestDatabase;
  let auth: string;

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

    const admin = await seedAdmin(db, { subRole: 'operations' });
    auth = await adminAuthHeaderFor(app, { adminId: admin.id, subRole: 'operations' });
  });

  it('serves identity past the 5/min auth budget (reads bucket)', async () => {
    // The console shell and the BFF session route poll this on every admin
    // screen. Under the old class-level `auth` bucket (5/min) the 6th request
    // would 429; in `reads` (300/min) ten sequential reads all succeed.
    for (let i = 0; i < 10; i += 1) {
      const res = await request(app.getHttpServer())
        .get('/v1/admin/auth/me')
        .set('Authorization', auth)
        .expect(200);

      expect(res.body).toMatchObject({ subRole: 'operations' });
    }
  });

  it('refuses the 6th admin login in the window with 429 (the throttle is on)', async () => {
    // M0-F14: control for the test above. If throttling were simply off, the
    // reads test would pass 10/10 for the wrong reason — this one fails unless
    // the `auth` bucket (5/min, keyed by account) actually bites.
    const probe = await seedAdmin(db, { subRole: 'operations', password: 'Password123!' });

    for (let i = 0; i < 5; i += 1) {
      await request(app.getHttpServer())
        .post('/v1/admin/auth/login')
        .send({ email: probe.email, password: 'Password123!' })
        .expect(200);
    }
    const limited = await request(app.getHttpServer())
      .post('/v1/admin/auth/login')
      .send({ email: probe.email, password: 'Password123!' })
      .expect(429);
    expect(limited.body).toMatchObject({ error: { code: 'rate_limited' } });
  });
});
