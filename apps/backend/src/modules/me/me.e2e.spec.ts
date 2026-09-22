import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, customerAuthHeaderFor, driverAuthHeaderFor } from '../../test/app';
import { seedCustomer, seedDriver, setupTestDatabase, truncateAll, type TestDatabase } from '../../test/db';

describe('me profile (/v1/me)', () => {
  let app: INestApplication;
  let db: TestDatabase;

  beforeAll(async () => {
    db = await setupTestDatabase();
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it('returns the caller own profile, never anyone else', async () => {
    const userId = await seedCustomer(db, 'Priya Sharma');
    const auth = await customerAuthHeaderFor(app, { userId });

    const res = await request(app.getHttpServer()).get('/v1/me').set('Authorization', auth).expect(200);
    expect(res.body).toMatchObject({ id: userId, name: 'Priya Sharma' });
  });

  it('updates name/email, leaves mobile untouched (it is the auth key, not an editable field)', async () => {
    const userId = await seedCustomer(db, 'Priya Sharma');
    const auth = await customerAuthHeaderFor(app, { userId });

    const res = await request(app.getHttpServer())
      .put('/v1/me')
      .set('Authorization', auth)
      .send({ name: 'Priya S.', email: 'priya@example.com' })
      .expect(200);

    expect(res.body.name).toBe('Priya S.');
    expect(res.body.email).toBe('priya@example.com');

    // mobile isn't in the update schema at all — Zod strips it as an unknown
    // key rather than rejecting the request, so this 200s but leaves mobile
    // untouched (it's the auth key; changing it needs a re-verification flow
    // this phase does not build, not a profile-edit field).
    const before = await request(app.getHttpServer()).get('/v1/me').set('Authorization', auth);
    await request(app.getHttpServer())
      .put('/v1/me')
      .set('Authorization', auth)
      .send({ mobile: '+919999999999' })
      .expect(200);
    const after = await request(app.getHttpServer()).get('/v1/me').set('Authorization', auth);
    expect(after.body.mobile).toBe(before.body.mobile);
  });

  it('a driver token cannot reach the customer-only profile route', async () => {
    // Realm-gating regression: @Realms('customer') must actually reject a
    // driver token, not just default-allow it.
    const driverId = await seedDriver(db);
    const auth = await driverAuthHeaderFor(app, { driverId });

    await request(app.getHttpServer()).get('/v1/me').set('Authorization', auth).expect(403);
  });

  it('persists language and appearance preferences', async () => {
    const userId = await seedCustomer(db, 'Priya Sharma');
    const auth = await customerAuthHeaderFor(app, { userId });

    const put = await request(app.getHttpServer())
      .put('/v1/me')
      .set('Authorization', auth)
      .send({ language: 'hi', appearance: 'dark' })
      .expect(200);
    expect(put.body.language).toBe('hi');
    expect(put.body.appearance).toBe('dark');

    const get = await request(app.getHttpServer()).get('/v1/me').set('Authorization', auth).expect(200);
    expect(get.body.language).toBe('hi');
    expect(get.body.appearance).toBe('dark');
  });

  it('rejects an unsupported language code', async () => {
    const userId = await seedCustomer(db, 'Priya Sharma');
    const auth = await customerAuthHeaderFor(app, { userId });

    await request(app.getHttpServer())
      .put('/v1/me')
      .set('Authorization', auth)
      .send({ language: 'xx' })
      .expect(422);
  });

  it('presigns a profile photo key namespaced under the caller', async () => {
    const userId = await seedCustomer(db, 'Priya Sharma');
    const auth = await customerAuthHeaderFor(app, { userId });

    const res = await request(app.getHttpServer())
      .post('/v1/me/photo/presign')
      .set('Authorization', auth)
      .expect(200);

    expect(typeof res.body.uploadUrl).toBe('string');
    expect(res.body.key.startsWith(`customer-photos/${userId}/photo-`)).toBe(true);
  });

  it('refuses to confirm a photo key issued to another user', async () => {
    const userId = await seedCustomer(db, 'Priya Sharma');
    const otherId = await seedCustomer(db, 'Someone Else');
    const auth = await customerAuthHeaderFor(app, { userId });

    const presign = await request(app.getHttpServer())
      .post('/v1/me/photo/presign')
      .set('Authorization', auth)
      .expect(200);
    const otherKey = presign.body.key.replace(`/${userId}/`, `/${otherId}/`);

    await request(app.getHttpServer())
      .post('/v1/me/photo/confirm')
      .set('Authorization', auth)
      .send({ key: otherKey })
      .expect(403);
  });

  it('confirms the presigned photo key and returns a fetchable photoUrl', async () => {
    const userId = await seedCustomer(db, 'Priya Sharma');
    const auth = await customerAuthHeaderFor(app, { userId });

    const presign = await request(app.getHttpServer())
      .post('/v1/me/photo/presign')
      .set('Authorization', auth)
      .expect(200);

    const confirm = await request(app.getHttpServer())
      .post('/v1/me/photo/confirm')
      .set('Authorization', auth)
      .send({ key: presign.body.key })
      .expect(200);

    expect(typeof confirm.body.photoUrl).toBe('string');
    expect(confirm.body.photoUrl).not.toBeNull();
    expect(confirm.body.photoUrl.startsWith('local://')).toBe(false);
  });
});
