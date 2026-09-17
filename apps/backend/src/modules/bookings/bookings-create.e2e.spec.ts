import type { INestApplication } from '@nestjs/common';
import { bookingDetailSchema } from '@towing/api-contracts';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  bookingStatusHistory,
  bookings,
  commissionConfig,
  dispatchConfig,
  serviceZones,
  users,
} from '../../db/schema';
import { KillSwitchService } from '../../common/killswitch/killswitch.service';
import { createTestApp, customerAuthHeaderFor } from '../../test/app';
import { expectMatchesContract } from '../../test/contracts';
import { seedCustomer, setupTestDatabase, truncateAll, type TestDatabase } from '../../test/db';
import { closeTestRedis, flushTestRedis } from '../../test/redis';
import { seedPricingFixtures } from '../pricing/pricing.e2e.spec';

/**
 * §3.4 — "Atomic booking + fare lock + commission lock … no double-assignment,
 * no orphan bookings, no rate drift."
 */
const BENGALURU = { lat: 12.9716, lng: 77.5946 };
const BENGALURU_DROP = { lat: 12.9569, lng: 77.7011 };
const MUMBAI = { lat: 19.076, lng: 72.8777 };

describe('POST /v1/bookings', () => {
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
    userId = await seedCustomer(db);
    auth = await customerAuthHeaderFor(app, { userId });
  });

  const body = (overrides: Record<string, unknown> = {}) => ({
    serviceSlug: 'car_tow',
    vehicleClass: 'wheel_lift',
    pickup: BENGALURU,
    pickupAddress: 'MG Road, Bengaluru',
    drop: BENGALURU_DROP,
    dropAddress: 'Marathahalli, Bengaluru',
    ...overrides,
  });

  const confirm = (overrides: Record<string, unknown> = {}, key = randomUUID()) =>
    request(app.getHttpServer())
      .post('/v1/bookings')
      .set('Authorization', auth)
      .set('Idempotency-Key', key)
      .send(body(overrides));

  describe('the happy path', () => {
    it('creates a booking that sits in SEARCHING with a locked fare', async () => {
      const response = await confirm().expect(201);
      expectMatchesContract(bookingDetailSchema, response.body);

      expect(response.body.status).toBe('searching');
      expect(response.body.breakdown.totalPaise).toBeGreaterThan(0);
      expect(response.body.band).toBe('A');
      expect(response.body.reference).toMatch(/^TW-[0-9A-F]{8}$/);
      // §9.1.7 — the OTP is not readable yet.
      expect(response.body.otpAvailable).toBe(false);
    });

    it('writes exactly one opening history row', async () => {
      const { body: created } = await confirm().expect(201);
      const history = await db
        .select()
        .from(bookingStatusHistory)
        .where(eq(bookingStatusHistory.bookingId, created.id));

      expect(history).toHaveLength(1);
      expect(history[0]!.status).toBe('searching');
      expect(history[0]!.actor).toBe('customer');
    });

    it('mints a HASHED OTP and never returns the code', async () => {
      const { body: created } = await confirm().expect(201);
      const [row] = await db.select().from(bookings).where(eq(bookings.id, created.id));

      expect(row!.bookingOtpHash).toMatch(/^[0-9a-f]{64}$/);
      expect(row!.otpVerified).toBe(false);

      // The only OTP-shaped thing the customer may see at confirm is the
      // AVAILABILITY flag. A naive "no six digits anywhere" check does not work
      // here — `totalPaise` is routinely six digits — so this asserts on the
      // field names instead, which is what would actually leak.
      expect(Object.keys(created).filter((k) => /otp/i.test(k))).toEqual(['otpAvailable']);
      expect(JSON.stringify(created)).not.toContain(row!.bookingOtpHash);
    });

    it('never exposes commission to the customer (§7.6)', async () => {
      const { body: created } = await confirm().expect(201);
      const serialised = JSON.stringify(created).toLowerCase();
      for (const forbidden of ['commission', 'driverpayout', 'platformearning']) {
        expect(serialised).not.toContain(forbidden);
      }
    });

    it('records the note, the contact and the vehicle', async () => {
      const { body: created } = await confirm({
        note: 'Blue hatchback, basement parking',
        contact: { name: 'Asha', mobile: '+919812345678' },
      }).expect(201);

      expect(created.note).toBe('Blue hatchback, basement parking');
      expect(created.contactName).toBe('Asha');
      expect(created.contactMobile).toBe('+919812345678');
    });
  });

  describe('§19.4 idempotency', () => {
    it('double-POST with one key yields ONE booking', async () => {
      const key = randomUUID();
      const first = await confirm({}, key).expect(201);
      const second = await confirm({}, key).expect(201);

      expect(second.body.id).toBe(first.body.id);
      expect(second.headers['idempotency-replayed']).toBe('true');
      expect(await db.select().from(bookings)).toHaveLength(1);
    });

    it('rejects the same key carrying a different request', async () => {
      const key = randomUUID();
      await confirm({}, key).expect(201);
      // §3.8's one-active-booking would 409 this anyway, so the pickup is moved
      // to make the FINGERPRINT the thing under test rather than the guard.
      await request(app.getHttpServer())
        .post('/v1/bookings')
        .set('Authorization', auth)
        .set('Idempotency-Key', key)
        .send(body({ pickupAddress: 'Somewhere else entirely' }))
        .expect(409)
        .expect(({ body: err }) => expect(err.error.code).toBe('idempotency_replay_mismatch'));
    });

    it('refuses a request with no key at all', async () => {
      await request(app.getHttpServer())
        .post('/v1/bookings')
        .set('Authorization', auth)
        .send(body())
        .expect(422);
    });
  });

  describe('§3.7 / §3.8 guards', () => {
    it('refuses a suspended account', async () => {
      await db.update(users).set({ status: 'suspended' }).where(eq(users.id, userId));
      const response = await confirm().expect(403);
      expect(response.body.error.code).toBe('account_not_active');
      expect(await db.select().from(bookings)).toHaveLength(0);
    });

    it('refuses a second active booking and names the first', async () => {
      const first = await confirm().expect(201);
      const response = await confirm().expect(409);

      expect(response.body.error.code).toBe('active_booking_exists');
      // The id is what lets the app offer "view your current trip" instead of a
      // dead end.
      expect(response.body.error.details.bookingId).toBe(first.body.id);
    });

    it('allows a new booking once the previous one is terminal', async () => {
      const first = await confirm().expect(201);
      await db.update(bookings).set({ status: 'cancelled' }).where(eq(bookings.id, first.body.id));
      await confirm().expect(201);
      expect(await db.select().from(bookings)).toHaveLength(2);
    });

    it('refuses a customer with an unpaid delivered trip', async () => {
      const first = await confirm().expect(201);
      // §5.1's `completed` is delivered-but-not-settled — §19.2's
      // "Razorpay down → COMPLETED (unpaid)" lands here exactly.
      await db.update(bookings).set({ status: 'completed' }).where(eq(bookings.id, first.body.id));

      const response = await confirm().expect(409);
      expect(response.body.error.code).toBe('unpaid_balance');
    });

    it('honours the admin toggles — both guards off means both pass', async () => {
      const first = await confirm().expect(201);
      await db.update(bookings).set({ status: 'completed' }).where(eq(bookings.id, first.body.id));

      // §3.8 calls the unpaid block "admin-configurable"; §6.7 says the same of
      // the one-active rule. Neither is worth having if it cannot be turned off.
      await db
        .update(dispatchConfig)
        .set({ oneActiveBookingPerCustomer: false, blockOnUnpaidBalance: false });
      await flushTestRedis();

      await confirm().expect(201);
    });
  });

  describe('the fare lock reads the CONFIGURED commission, not the constant', () => {
    it('locks commission_pct at whatever commission_config holds', async () => {
      // THE REGRESSION THIS EXISTS FOR. `commissionPaise(total, band)`
      // multiplies by the hard-coded `BAND_PCT`; Phase 14 made
      // `commission_config` the source of truth. Locking through the constant
      // would write 10 % here and nobody would notice until the month's take
      // rate came out wrong.
      await db.update(commissionConfig).set({ pct: '9.00' }).where(eq(commissionConfig.band, 'A'));
      await flushTestRedis();

      const { body: created } = await confirm().expect(201);
      const [row] = await db.select().from(bookings).where(eq(bookings.id, created.id));

      expect(Number(row!.commissionPct)).toBe(9);
      expect(row!.commissionBand).toBe('A');
    });

    it('leaves the commission AMOUNT at zero until capture', async () => {
      const { body: created } = await confirm().expect(201);
      const [row] = await db.select().from(bookings).where(eq(bookings.id, created.id));

      // §19.2: credit happens on capture, never at completion. A pre-credited
      // commission would surface as ledger drift on the very first booking.
      expect(row!.commissionAmount).toBe('0.00');
      expect(row!.driverPayout).toBe('0.00');
    });
  });

  describe('validation', () => {
    it('refuses a pickup outside every service zone', async () => {
      await confirm({ pickup: MUMBAI, drop: MUMBAI }).expect(422);
    });

    it('refuses a tow with no drop', async () => {
      await request(app.getHttpServer())
        .post('/v1/bookings')
        .set('Authorization', auth)
        .set('Idempotency-Key', randomUUID())
        .send({
          serviceSlug: 'car_tow',
          vehicleClass: 'wheel_lift',
          pickup: BENGALURU,
          pickupAddress: 'MG Road',
        })
        .expect(422);
    });

    it('refuses a drop with no address', async () => {
      await confirm({ dropAddress: undefined }).expect(422);
    });

    it('refuses a scheduled pickup in the past', async () => {
      await confirm({ scheduledAt: new Date(Date.now() - 60_000).toISOString() }).expect(422);
    });

    it('accepts a scheduled pickup in the future and records it', async () => {
      const when = new Date(Date.now() + 3 * 3_600_000).toISOString();
      const { body: created } = await confirm({ scheduledAt: when }).expect(201);

      expect(created.scheduledAt).toBe(when);
      // §5.1 has no scheduled STATE — the booking is created now and enters
      // searching now; only its dispatch job is delayed.
      expect(created.status).toBe('searching');
    });

    it('refuses an unknown service slug', async () => {
      await confirm({ serviceSlug: 'helicopter_lift' }).expect(422);
    });

    it('rejects an anonymous caller', async () => {
      await request(app.getHttpServer()).post('/v1/bookings').send(body()).expect(401);
    });
  });

  describe('§19.8 kill switches (A11)', () => {
    // ~170 km north — Band C (>100 km) without tripping the 600 km manual
    // quote. Haversine, so no Maps key is needed.
    const FAR_DROP = { lat: 14.5, lng: 77.6 };

    const bengaluruZoneId = async (): Promise<string> => {
      const [zone] = await db
        .select({ id: serviceZones.id })
        .from(serviceZones)
        .where(eq(serviceZones.name, 'Bengaluru Metro'));
      return zone!.id;
    };

    const bookingCount = async (): Promise<number> => {
      const rows = await db.select({ id: bookings.id }).from(bookings);
      return rows.length;
    };

    it('refuses creation in a paused zone with dispatch_paused', async () => {
      await app.get(KillSwitchService).setPausedZones([await bengaluruZoneId()]);

      await confirm()
        .expect(409)
        .expect(({ body }) => {
          expect(body.error.code).toBe('dispatch_paused');
        });
      expect(await bookingCount()).toBe(0);
    });

    it('books again once the zone is unpaused', async () => {
      const killSwitch = app.get(KillSwitchService);
      await killSwitch.setPausedZones([await bengaluruZoneId()]);
      await confirm().expect(409);

      await killSwitch.setPausedZones([]);
      await confirm().expect(201);
    });

    it('refuses a long-distance booking while long-distance is disabled', async () => {
      await app.get(KillSwitchService).setLongDistanceDisabled(true);

      const refused = await confirm({ drop: FAR_DROP, dropAddress: 'Far away' }).expect(409);
      expect(refused.body.error.code).toBe('dispatch_paused');
      expect(await bookingCount()).toBe(0);
    });

    it('still books a city tow while long-distance is disabled', async () => {
      await app.get(KillSwitchService).setLongDistanceDisabled(true);

      const { body: created } = await confirm().expect(201);
      expect(created.band).toBe('A');
    });
  });
});
