import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, customerAuthHeaderFor } from '../../test/app';
import { seedCustomer, setupTestDatabase, truncateAll, type TestDatabase } from '../../test/db';

describe('me emergency contacts (/v1/me/emergency-contacts)', () => {
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

  it('creates, lists and deletes a contact', async () => {
    const userId = await seedCustomer(db);
    const auth = await customerAuthHeaderFor(app, { userId });

    const created = await request(app.getHttpServer())
      .post('/v1/me/emergency-contacts')
      .set('Authorization', auth)
      .send({ name: 'Anita Sharma', phone: '+919845123456', relation: 'Spouse' })
      .expect(201);
    expect(created.body).toMatchObject({ name: 'Anita Sharma', relation: 'Spouse' });

    const list = await request(app.getHttpServer())
      .get('/v1/me/emergency-contacts')
      .set('Authorization', auth)
      .expect(200);
    expect(list.body).toHaveLength(1);

    await request(app.getHttpServer())
      .delete(`/v1/me/emergency-contacts/${created.body.id}`)
      .set('Authorization', auth)
      .expect(204);

    const afterDelete = await request(app.getHttpServer())
      .get('/v1/me/emergency-contacts')
      .set('Authorization', auth)
      .expect(200);
    expect(afterDelete.body).toHaveLength(0);
  });

  it('rejects a non-Indian-mobile phone number', async () => {
    const userId = await seedCustomer(db);
    const auth = await customerAuthHeaderFor(app, { userId });

    await request(app.getHttpServer())
      .post('/v1/me/emergency-contacts')
      .set('Authorization', auth)
      .send({ name: 'Anita Sharma', phone: '12345' })
      .expect(422);
  });

  it('never lets one customer delete another customer\'s contact', async () => {
    const ownerId = await seedCustomer(db, 'Owner');
    const otherId = await seedCustomer(db, 'Other');
    const ownerAuth = await customerAuthHeaderFor(app, { userId: ownerId });
    const otherAuth = await customerAuthHeaderFor(app, { userId: otherId });

    const created = await request(app.getHttpServer())
      .post('/v1/me/emergency-contacts')
      .set('Authorization', ownerAuth)
      .send({ name: 'Anita Sharma', phone: '+919845123456' })
      .expect(201);

    await request(app.getHttpServer())
      .delete(`/v1/me/emergency-contacts/${created.body.id}`)
      .set('Authorization', otherAuth)
      .expect(404);
  });

  it('updates name and relation', async () => {
    const userId = await seedCustomer(db);
    const auth = await customerAuthHeaderFor(app, { userId });

    const created = await request(app.getHttpServer())
      .post('/v1/me/emergency-contacts')
      .set('Authorization', auth)
      .send({ name: 'Anita Sharma', phone: '+919845123456', relation: 'Spouse' })
      .expect(201);

    const updated = await request(app.getHttpServer())
      .put(`/v1/me/emergency-contacts/${created.body.id}`)
      .set('Authorization', auth)
      .send({ name: 'Anita Verma', relation: 'Sister' })
      .expect(200);
    expect(updated.body).toMatchObject({ name: 'Anita Verma', relation: 'Sister' });
  });

  it('never lets one customer update another customer\'s contact', async () => {
    const ownerId = await seedCustomer(db, 'Owner');
    const otherId = await seedCustomer(db, 'Other');
    const ownerAuth = await customerAuthHeaderFor(app, { userId: ownerId });
    const otherAuth = await customerAuthHeaderFor(app, { userId: otherId });

    const created = await request(app.getHttpServer())
      .post('/v1/me/emergency-contacts')
      .set('Authorization', ownerAuth)
      .send({ name: 'Anita Sharma', phone: '+919845123456' })
      .expect(201);

    await request(app.getHttpServer())
      .put(`/v1/me/emergency-contacts/${created.body.id}`)
      .set('Authorization', otherAuth)
      .send({ name: 'Hacked' })
      .expect(404);
  });

  it('rejects an empty update body', async () => {
    const userId = await seedCustomer(db);
    const auth = await customerAuthHeaderFor(app, { userId });

    const created = await request(app.getHttpServer())
      .post('/v1/me/emergency-contacts')
      .set('Authorization', auth)
      .send({ name: 'Anita Sharma', phone: '+919845123456' })
      .expect(201);

    await request(app.getHttpServer())
      .put(`/v1/me/emergency-contacts/${created.body.id}`)
      .set('Authorization', auth)
      .send({})
      .expect(422);
  });
});
