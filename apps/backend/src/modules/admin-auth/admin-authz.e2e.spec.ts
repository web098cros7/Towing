/**
 * A17: an admin demotion lands in seconds, not at the 900-second expiry.
 *
 * The suite disables throttling globally; this file turns nothing back on —
 * the guard re-check is not a throttle. `ADMIN_AUTHZ_TTL_MS=0` makes every
 * re-check read fresh (deterministic: no sleeps), which is the strictest
 * setting for the mechanism under test. Production's ~5 s window only
 * *delays* the 401 proven here; the directional comparison (row newer than
 * token) is what makes the refresh-retry succeed either way.
 *
 * Must happen before `createTestApp()`: `ConfigModule` calls `loadEnv()`
 * once per app boot, and `vitest`'s `isolate: true` gives this file its own
 * module graph, so the assignment cannot leak into another spec.
 */
process.env.AUTH_DEV_OTP_ECHO = '1';
process.env.ADMIN_AUTHZ_TTL_MS = '0';

import type { INestApplication } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { adminUsers } from '../../db/schema';
import { createTestApp } from '../../test/app';
import { seedAdmin, setupTestDatabase, truncateAll, type TestDatabase } from '../../test/db';
import { closeTestRedis, flushTestRedis } from '../../test/redis';

const PASSWORD = 'Password123!';

describe('admin demotion takes effect immediately (A17)', () => {
  let app: INestApplication;
  let db: TestDatabase;
  let adminId: string;
  let email: string;

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

    const admin = await seedAdmin(db, { subRole: 'super_admin', password: PASSWORD });
    adminId = admin.id;
    email = admin.email;
  });

  const login = async (email: string) => {
    const started = await request(app.getHttpServer())
      .post('/v1/admin/auth/login')
      .send({ email, password: PASSWORD })
      .expect(200);
    const otp = await request(app.getHttpServer())
      .get('/v1/admin/auth/dev/otp')
      .query({ challengeId: started.body.challengeId })
      .expect(200);
    const session = await request(app.getHttpServer())
      .post('/v1/admin/auth/verify')
      .send({ challengeId: started.body.challengeId, otp: otp.body.otp })
      .expect(200);
    return session.body as { accessToken: string; refreshToken: string };
  };

  it('a demoted admin 401s on the next request, then continues with reduced scope', async () => {
    const session = await login(email);

    // Super admin reads the commission config.
    await request(app.getHttpServer())
      .get('/v1/admin/commission')
      .set('Authorization', `Bearer ${session.accessToken}`)
      .expect(200);

    // Demote out of band (W2 owns the writer; the version bump is what W2
    // must do on every authz mutation — the guard compares it, not the role).
    await db
      .update(adminUsers)
      .set({ subRole: 'support', authzVersion: 2 })
      .where(eq(adminUsers.id, adminId));

    // The old token is stale now: 401, and the family is NOT burned.
    await request(app.getHttpServer())
      .get('/v1/admin/commission')
      .set('Authorization', `Bearer ${session.accessToken}`)
      .expect(401);

    // One refresh mints a correctly-scoped token; the retry succeeds.
    const rotated = await request(app.getHttpServer())
      .post('/v1/admin/auth/refresh')
      .send({ refreshToken: session.refreshToken })
      .expect(200);

    // Reduced scope works: support reads the KYC queue…
    await request(app.getHttpServer())
      .get('/v1/admin/drivers/pending')
      .set('Authorization', `Bearer ${rotated.body.accessToken}`)
      .expect(200);
    // …and is refused the finance surface it just lost.
    await request(app.getHttpServer())
      .get('/v1/admin/commission')
      .set('Authorization', `Bearer ${rotated.body.accessToken}`)
      .expect(403);
  });

  it('a deactivated admin 401s, and refresh refuses as well', async () => {
    const session = await login(email);

    await db
      .update(adminUsers)
      .set({ status: 'suspended', authzVersion: 2 })
      .where(eq(adminUsers.id, adminId));

    await request(app.getHttpServer())
      .get('/v1/admin/commission')
      .set('Authorization', `Bearer ${session.accessToken}`)
      .expect(401);
    await request(app.getHttpServer())
      .post('/v1/admin/auth/refresh')
      .send({ refreshToken: session.refreshToken })
      .expect(401);
  });
});
