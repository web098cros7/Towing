import type { INestApplication } from '@nestjs/common';
import { bookingMessagesResponseSchema } from '@towing/api-contracts';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createTestApp,
  customerAuthHeaderFor,
  driverAuthHeaderFor,
} from '../../test/app';
import { expectMatchesContract } from '../../test/contracts';
import {
  seedCustomer,
  seedDriver,
  setupTestDatabase,
  truncateAll,
  type TestDatabase,
} from '../../test/db';
import { seedBooking } from '../../test/fixtures';
import { closeTestRedis, flushTestRedis } from '../../test/redis';
import { notificationEvents } from '../../db/schema';

/**
 * Figma 24's chat thread (§9.1.10, §9.2.3).
 *
 * The thread is open only while a driver is on the trip, and the two parties
 * are the only senders. `readAt` is stamped on the OTHER side's messages when
 * a party lists the thread.
 */
describe('booking chat', () => {
  let app: INestApplication;
  let db: TestDatabase;
  let userId: string;
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
    userId = await seedCustomer(db);
    auth = await customerAuthHeaderFor(app, { userId });
  });

  async function seedAssignedBooking(owner = userId): Promise<{ id: string; driverId: string }> {
    const driverId = await seedDriver(db);
    const id = await seedBooking(db, { userId: owner, status: 'assigned', driverId });
    return { id, driverId };
  }

  describe('customer side', () => {
    it('returns an empty thread for an assigned booking with no messages', async () => {
      const { id } = await seedAssignedBooking();

      const response = await request(app.getHttpServer())
        .get(`/v1/bookings/${id}/messages`)
        .set('Authorization', auth)
        .expect(200);

      expectMatchesContract(bookingMessagesResponseSchema, response.body);
      expect(response.body.items).toEqual([]);
    });

    it('stores a customer message and lists it back', async () => {
      const { id } = await seedAssignedBooking();

      const sent = await request(app.getHttpServer())
        .post(`/v1/bookings/${id}/messages`)
        .set('Authorization', auth)
        .send({ body: 'On my way to the pickup' })
        .expect(201);

      expect(sent.body.senderType).toBe('customer');
      expect(sent.body.body).toBe('On my way to the pickup');
      expect(sent.body.readAt).toBeNull();

      const listed = await request(app.getHttpServer())
        .get(`/v1/bookings/${id}/messages`)
        .set('Authorization', auth)
        .expect(200);

      expect(listed.body.items).toHaveLength(1);
      expect(listed.body.items[0].id).toBe(sent.body.id);
    });

    it('409s a booking with no driver yet', async () => {
      const id = await seedBooking(db, { userId, status: 'searching' });

      await request(app.getHttpServer())
        .post(`/v1/bookings/${id}/messages`)
        .set('Authorization', auth)
        .send({ body: 'Hello?' })
        .expect(409);
    });

    it('404s another customer\'s booking on both routes', async () => {
      const stranger = await seedCustomer(db);
      const { id } = await seedAssignedBooking(stranger);

      await request(app.getHttpServer())
        .get(`/v1/bookings/${id}/messages`)
        .set('Authorization', auth)
        .expect(404);

      await request(app.getHttpServer())
        .post(`/v1/bookings/${id}/messages`)
        .set('Authorization', auth)
        .send({ body: 'Hello?' })
        .expect(404);
    });
  });

  describe('driver side', () => {
    it('stores a driver message and marks it read after the customer opens the thread', async () => {
      const { id, driverId } = await seedAssignedBooking();
      const driverAuth = await driverAuthHeaderFor(app, { driverId });

      const sent = await request(app.getHttpServer())
        .post(`/v1/jobs/${id}/messages`)
        .set('Authorization', driverAuth)
        .send({ body: 'Arriving in 5 minutes' })
        .expect(201);

      expect(sent.body.senderType).toBe('driver');
      expect(sent.body.readAt).toBeNull();

      const first = await request(app.getHttpServer())
        .get(`/v1/bookings/${id}/messages`)
        .set('Authorization', auth)
        .expect(200);

      expect(first.body.items).toHaveLength(1);
      expect(first.body.items[0].id).toBe(sent.body.id);
      expect(first.body.items[0].readAt).not.toBeNull();

      const second = await request(app.getHttpServer())
        .get(`/v1/bookings/${id}/messages`)
        .set('Authorization', auth)
        .expect(200);

      expect(second.body.items[0].readAt).not.toBeNull();
    });
  });

  describe('push notifications', () => {
    it('emits chat.message_to_driver on a customer message and chat.message_to_customer on a driver reply', async () => {
      const { id, driverId } = await seedAssignedBooking();
      const driverAuth = await driverAuthHeaderFor(app, { driverId });

      await request(app.getHttpServer())
        .post(`/v1/bookings/${id}/messages`)
        .set('Authorization', auth)
        .send({ body: 'Where are you?' })
        .expect(201);

      const afterCustomer = await db.select().from(notificationEvents);
      expect(afterCustomer.map((row) => row.event)).toEqual(['chat.message_to_driver']);

      await request(app.getHttpServer())
        .post(`/v1/jobs/${id}/messages`)
        .set('Authorization', driverAuth)
        .send({ body: 'Five minutes away' })
        .expect(201);

      const afterDriver = await db.select().from(notificationEvents);
      expect(afterDriver.map((row) => row.event).sort()).toEqual([
        'chat.message_to_customer',
        'chat.message_to_driver',
      ]);
    });
  });
});
