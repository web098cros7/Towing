import type { INestApplication } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { QUEUE, type QueuePort } from '../../common/queue/queue.port';
import { adminActions, bookings, dispatchAttempts, drivers } from '../../db/schema';
import {
  adminAuthHeaderFor,
  createTestApp,
  customerAuthHeaderFor,
  driverAuthHeaderFor,
} from '../../test/app';
import {
  seedAdmin,
  seedCustomer,
  seedDriver,
  setupTestDatabase,
  truncateAll,
  type TestDatabase,
} from '../../test/db';
import { seedBooking } from '../../test/fixtures';
import { closeTestRedis, flushTestRedis } from '../../test/redis';
import { JobExecutionService } from '../job-execution/job-execution.service';
import { DispatchService } from '../dispatch/dispatch.service';
import { AdminDriversService } from './admin-drivers.service';
import {
  PICKUP,
  seedOnlineDriver,
  seedSearchingBooking,
  seedZone,
} from '../dispatch/dispatch-fixtures';

/**
 * A14 — two-mode suspension never strands a booking.
 *
 * `after_current_job` (the default) shelves the suspension on the driver row
 * while they hold a live booking: evicted from presence, blocked from new
 * offers, sessions and status untouched so the job completes — and the
 * suspension applies when it does. `immediate` suspends at once and is
 * refused while a live booking exists (the reassign/cancel disposition is
 * W8). `KycApprovedGuard` is untouched throughout.
 */
describe('two-mode driver suspension (A14)', () => {
  let app: INestApplication;
  let db: TestDatabase;
  let adminAuth: string;
  let userId: string;

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
    adminAuth = await adminAuthHeaderFor(app, { adminId: admin.id, subRole: 'operations' });
    userId = await seedCustomer(db, 'Suspension Customer');
  });

  const suspend = (driverId: string, body: Record<string, unknown> = {}) =>
    request(app.getHttpServer())
      .post(`/v1/admin/drivers/${driverId}/kyc`)
      .set('Authorization', adminAuth)
      .send({ decision: 'suspend', ...body });

  const driverRow = async (driverId: string) => {
    const [row] = await db.select().from(drivers).where(eq(drivers.id, driverId));
    return row!;
  };

  const bookingStatus = async (bookingId: string): Promise<string> => {
    const [row] = await db
      .select({ status: bookings.status })
      .from(bookings)
      .where(eq(bookings.id, bookingId));
    return row!.status;
  };

  const liveBooking = (driverId: string) =>
    seedBooking(db, { userId, driverId, status: 'assigned' });

  it('defers by default with a live booking: shelved, evicted, job intact', async () => {
    const driverId = await seedDriver(db, { name: 'Mid-job Driver' });
    await db.update(drivers).set({ isOnline: true }).where(eq(drivers.id, driverId));
    const bookingId = await liveBooking(driverId);

    const res = await suspend(driverId).expect(200);

    // Still approved with sessions intact — the driver must finish the job.
    expect(res.body).toMatchObject({ driverId, kycStatus: 'approved', suspensionPending: true });
    const row = await driverRow(driverId);
    expect(row.kycStatus).toBe('approved');
    expect(row.pendingSuspensionReason).toBeNull();
    expect(row.pendingSuspensionBy).not.toBeNull();
    expect(row.pendingSuspensionAt).not.toBeNull();
    // Evicted from presence all the same.
    expect((await driverRow(driverId)).isOnline).toBe(false);
    // And the booking is untouched — nobody stranded.
    expect(await bookingStatus(bookingId)).toBe('assigned');
    const [booking] = await db.select().from(bookings).where(eq(bookings.id, bookingId));
    expect(booking!.driverId).toBe(driverId);

    const [action] = await db.select().from(adminActions).where(eq(adminActions.subjectId, driverId));
    expect(action!.action).toBe('driver.kyc.suspend');
  });

  it('applies the shelved suspension when the job completes', async () => {
    const driverId = await seedDriver(db, { name: 'Finishing Driver' });
    const bookingId = await seedBooking(db, { userId, driverId, status: 'in_progress' });
    await suspend(driverId).expect(200);
    expect((await driverRow(driverId)).kycStatus).toBe('approved');

    await app.get(JobExecutionService).complete(bookingId, driverId);

    expect(await bookingStatus(bookingId)).toBe('completed');
    const row = await driverRow(driverId);
    expect(row.kycStatus).toBe('suspended');
    expect(row.pendingSuspensionReason).toBeNull();
    expect(row.pendingSuspensionBy).toBeNull();
    expect(row.pendingSuspensionAt).toBeNull();
  });

  it('immediate with a live booking is refused and changes nothing', async () => {
    const driverId = await seedDriver(db, { name: 'Busy Driver' });
    const bookingId = await liveBooking(driverId);

    const res = await suspend(driverId, { mode: 'immediate' }).expect(409);

    expect(res.body.error.code).toBe('invalid_booking_state');
    expect(res.body.error.details).toMatchObject({ bookingId });
    expect((await driverRow(driverId)).kycStatus).toBe('approved');
    expect((await driverRow(driverId)).pendingSuspensionAt).toBeNull();
    expect(await bookingStatus(bookingId)).toBe('assigned');
  });

  it('immediate without a live booking suspends at once', async () => {
    const driverId = await seedDriver(db, { name: 'Idle Driver' });

    const res = await suspend(driverId, { mode: 'immediate' }).expect(200);

    expect(res.body).toMatchObject({
      driverId,
      kycStatus: 'suspended',
      suspensionPending: false,
    });
    expect(res.body.sessionsRevoked).toBeGreaterThanOrEqual(0);
  });

  it('a pending driver gets no new offers but the wave still serves others', async () => {
    const zoneId = await seedZone(db, { dispatchConfig: { radiusLadderKm: [5], offersPerWave: 2 } });
    const bookingId = await seedSearchingBooking(db, { userId, zoneId });
    const shelved = await seedOnlineDriver(db, { zoneId, metersAway: 400 });
    const free = await seedOnlineDriver(db, { zoneId, metersAway: 600 });
    await db
      .update(drivers)
      .set({ pendingSuspensionReason: 'test shelf', pendingSuspensionAt: new Date() })
      .where(eq(drivers.id, shelved));

    await app.get(DispatchService).runWave(bookingId);

    const attempts = await db
      .select()
      .from(dispatchAttempts)
      .where(eq(dispatchAttempts.bookingId, bookingId));
    expect(attempts.map((a) => a.driverId)).toEqual([free]);
    expect(attempts[0]).toMatchObject({ outcome: 'offered' });
  });

  it('a pending driver cannot go back online', async () => {
    await seedZone(db);
    const driverId = await seedDriver(db, { kycStatus: 'approved' });
    await db
      .update(drivers)
      .set({ pendingSuspensionReason: 'test shelf', pendingSuspensionAt: new Date() })
      .where(eq(drivers.id, driverId));

    const res = await request(app.getHttpServer())
      .post('/v1/driver/online')
      .set('Authorization', await driverAuthHeaderFor(app, { driverId }))
      .send({ at: PICKUP })
      .expect(403);

    expect(res.body.error.code).toBe('account_not_active');
  });

  it('a customer cancel enqueues the apply job, and the worker suspends the freed driver', async () => {
    const driverId = await seedDriver(db, { name: 'Cancelled-on Driver' });
    const bookingId = await seedBooking(db, { userId, driverId, status: 'assigned' });
    await suspend(driverId).expect(200);
    expect((await driverRow(driverId)).pendingSuspensionAt).not.toBeNull();

    // The queue is off in the suite, so the worker half is asserted in two
    // halves: the enqueue wiring here, the apply behaviour above.
    const enqueue = vi.spyOn(app.get<QueuePort>(QUEUE), 'enqueue');
    await request(app.getHttpServer())
      .post(`/v1/bookings/${bookingId}/cancel`)
      .set('Authorization', await customerAuthHeaderFor(app, { userId }))
      .send({ reason: 'changed my mind' })
      .expect(200);

    expect(enqueue).toHaveBeenCalledWith(
      'admin.apply-suspension',
      { driverId },
      expect.objectContaining({ jobId: `apply-suspension-${bookingId}` }),
    );
    expect(await bookingStatus(bookingId)).toBe('cancelled');

    // The worker body, invoked directly as the queue-off suite does everywhere.
    expect(await app.get(AdminDriversService).applyPendingSuspension(driverId)).toBe(true);
    expect((await driverRow(driverId)).kycStatus).toBe('suspended');
  });
});
