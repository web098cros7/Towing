import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  opsBookingCreatedEventSchema,
  opsBookingStatusEventSchema,
} from '@towing/api-contracts';
import { OPS_EVENTS_CHANNEL } from '../../redis/redis.constants';
import { bookings } from '../../db/schema';
import { createTestApp, customerAuthHeaderFor } from '../../test/app';
import { seedCustomer, setupTestDatabase, truncateAll, type TestDatabase } from '../../test/db';
import { closeTestRedis, flushTestRedis, testRedis } from '../../test/redis';
import { seedPricingFixtures } from '../pricing/pricing.e2e.spec';

const BENGALURU = { lat: 12.9716, lng: 77.5946 };
const BENGALURU_DROP = { lat: 12.9569, lng: 77.7011 };

/**
 * A18 — every status change is visible on `ops:events`, regardless of fleet.
 *
 * Collects what Redis actually carries while the real paths run: an HTTP
 * booking creation and an HTTP cancel. Both go through the same publish
 * discipline production does (warn-only, post-commit), and both payloads are
 * asserted against the contracts W1's admin feed will consume.
 */
describe('ops:events platform feed (A18)', () => {
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
    await seedPricingFixtures(db);
    userId = await seedCustomer(db, 'Ops Customer');
    auth = await customerAuthHeaderFor(app, { userId });
  });

  /** Collects messages published on a channel while `run` executes. */
  async function captureChannel<T>(
    run: () => Promise<T>,
  ): Promise<{ result: T; messages: Array<Record<string, unknown>> }> {
    const sub = testRedis().duplicate();
    const messages: Array<Record<string, unknown>> = [];
    await sub.subscribe(OPS_EVENTS_CHANNEL);
    sub.on('message', (_channel: string, raw: string) => {
      try {
        messages.push(JSON.parse(raw) as Record<string, unknown>);
      } catch {
        // Non-JSON on the channel is itself a finding; keep it visible.
        messages.push({ raw });
      }
    });

    try {
      const result = await run();
      // Redis pub/sub delivery is asynchronous to the publisher's reply;
      // without a beat the subscriber can be asserted before the message lands.
      await new Promise((resolve) => setTimeout(resolve, 150));
      return { result, messages };
    } finally {
      await sub.unsubscribe(OPS_EVENTS_CHANNEL);
      sub.disconnect();
    }
  }

  const createBooking = () =>
    request(app.getHttpServer())
      .post('/v1/bookings')
      .set('Authorization', auth)
      .set('Idempotency-Key', randomUUID())
      .send({
        serviceSlug: 'car_tow',
        vehicleClass: 'wheel_lift',
        pickup: BENGALURU,
        pickupAddress: 'MG Road, Bengaluru',
        drop: BENGALURU_DROP,
        dropAddress: 'Marathahalli, Bengaluru',
      })
      .expect(201);

  it('publishes booking_created when a search starts', async () => {
    const { result, messages } = await captureChannel(createBooking);

    const created = messages.filter((m) => m.kind === 'booking_created');
    expect(created).toHaveLength(1);
    expect(opsBookingCreatedEventSchema.parse(created[0])).toMatchObject({
      bookingId: result.body.id,
      userId,
      status: 'searching',
      scheduledAt: null,
    });
    expect(typeof created[0]!.zoneId).toBe('string');
  });

  it('publishes booking_status with full routing when the booking moves', async () => {
    const created = await createBooking();
    const bookingId: string = created.body.id;
    const [row] = await db
      .select({ zoneId: bookings.zoneId })
      .from(bookings)
      .where(eq(bookings.id, bookingId));
    const zoneId = row!.zoneId;

    const { messages } = await captureChannel(() =>
      request(app.getHttpServer())
        .post(`/v1/bookings/${bookingId}/cancel`)
        .set('Authorization', auth)
        .send({ reason: 'changed my mind' })
        .expect(200),
    );

    const moved = messages.filter((m) => m.kind === 'booking_status');
    expect(moved).toHaveLength(1);
    // The widened result, asserted against the contract: tenant routing plus
    // the zone/driver/user the admin feed filters and links on.
    expect(opsBookingStatusEventSchema.parse(moved[0])).toMatchObject({
      bookingId,
      from: 'searching',
      to: 'cancelled',
      zoneId,
      driverId: null,
      userId,
      fleetId: null,
    });
  });
});
