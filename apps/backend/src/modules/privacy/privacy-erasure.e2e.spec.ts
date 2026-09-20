import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  adminDeletionRequestSchema,
  adminDeletionRequestsResponseSchema,
  adminSubjectExportResponseSchema,
} from '@towing/api-contracts';
import { eq, sql } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { STORAGE, type StoragePort } from '../../common/storage/storage.port';
import {
  adminActions,
  addresses,
  bookingLocationPath,
  bookings,
  deletionRequests,
  devices,
  driverDocumentVersions,
  driverDocuments,
  drivers,
  emergencyContacts,
  erasureJobs,
  loginChallenges,
  notificationDeliveries,
  notificationEvents,
  otpVerifications,
  payouts,
  retentionPolicies,
  savedVehicles,
  socialIdentities,
  sosAlertContacts,
  sosAlerts,
  users,
  webhookEvents,
} from '../../db/schema';
import {
  adminAuthHeaderFor,
  createTestApp,
  customerAuthHeaderFor,
  driverAuthHeaderFor,
} from '../../test/app';
import { expectMatchesContract } from '../../test/contracts';
import { seedAdmin, seedCustomer, seedDriver, setupTestDatabase, truncateAll, type TestDatabase } from '../../test/db';
import { seedBooking } from '../../test/fixtures';
import { TokenService } from '../auth/token.service';
import { ErasureService } from './erasure.service';
import { RETENTION_POLICY_DEFAULTS } from './retention';

const DAY_MS = 86_400_000;

/**
 * W19 acceptance (§20.4 DPDP). The milestone's stated criteria live here as
 * assertions rather than prose:
 *
 *   · A deletion REQUEST suspends the account and kills its sessions in one
 *     commit (A16), and cannot be filed twice.
 *   · An approved request's EXECUTION leaves the money tables exactly as it
 *     found them (row counts, ledger included) while the subject's PII is gone
 *     — the two halves that make "erasure" true rather than "a cascade".
 *   · The audit trail SURVIVES the erasure and records it.
 *   · Holds park a request with a reason instead of refusing it, and a parked
 *     request is re-runnable.
 *   · Execute is idempotent: the second press adds no second job.
 *   · The retention sweep deletes exactly the rows past policy and nothing on
 *     the near side of the cutoff.
 *
 * The runner is called DIRECTLY (queue-off), the house pattern for worker
 * bodies: `QUEUE_ENABLED=false` in tests, and the route-level tests assert the
 * state machine + audit rows the enqueue leaves behind.
 */
describe('privacy erasure and retention (W19 §20.4)', () => {
  let app: INestApplication;
  let db: TestDatabase;
  let erasure: ErasureService;
  let tokens: TokenService;
  let storage: StoragePort;

  beforeAll(async () => {
    db = await setupTestDatabase();
    app = await createTestApp();
    erasure = app.get(ErasureService);
    tokens = app.get(TokenService);
    storage = app.get(STORAGE);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await truncateAll();
    // `truncateAll` empties every table, and `retention_policies` is seeded by
    // migration 0033 + `db:seed` (which does not run here). Re-inserting the
    // defaults keeps the sweep and the console reading the same rows they read
    // in production, instead of passing because "no policy means no deletes".
    await db
      .insert(retentionPolicies)
      .values(
        RETENTION_POLICY_DEFAULTS.map((policy) => ({
          policyKey: policy.policyKey,
          retentionDays: policy.retentionDays,
          description: policy.description,
        })),
      )
      .onConflictDoNothing({ target: retentionPolicies.policyKey });
  });

  const tableCount = async (table: string): Promise<number> => {
    const rows = (await db.execute(
      sql`select count(*)::int as n from ${sql.identifier(table)}`,
    )) as unknown as Array<{ n: number }>;
    return rows[0]?.n ?? 0;
  };

  const moneySnapshot = async (): Promise<Record<string, number>> => {
    const tables = [
      'wallets',
      'wallet_transactions',
      'payments',
      'payouts',
      'refunds',
      'earnings_daily',
    ];
    const entries = await Promise.all(tables.map(async (table) => [table, await tableCount(table)]));
    return Object.fromEntries(entries);
  };

  /** Files a request through the customer route and returns the row id. */
  const fileRequest = async (userId: string): Promise<string> => {
    const auth = await customerAuthHeaderFor(app, { userId });
    const res = await request(app.getHttpServer())
      .delete('/v1/me')
      .set('Authorization', auth)
      .expect(200);
    return res.body.requestId as string;
  };

  const approve = async (requestId: string): Promise<void> => {
    const admin = await seedAdmin(db, { subRole: 'super_admin' });
    const auth = await adminAuthHeaderFor(app, { adminId: admin.id, subRole: 'super_admin' });
    await request(app.getHttpServer())
      .post(`/v1/admin/privacy/deletion-requests/${requestId}/approve`)
      .set('Authorization', auth)
      .send({ reason: 'verified with the customer' })
      .expect(200);
  };

  describe('A16 — the request suspends and revokes in one commit', () => {
    it('suspends the account, kills the session and revokes the devices', async () => {
      const userId = await seedCustomer(db, 'Anita Rao');
      const session = await tokens.issueSession({ subjectId: userId, realm: 'customer' });
      await db.insert(devices).values({
        subjectId: userId,
        subjectType: 'user',
        installationId: randomUUID(),
        pushToken: 'ExponentPushToken[test]',
      });

      const requestId = await fileRequest(userId);

      const [user] = await db.select().from(users).where(eq(users.id, userId));
      expect(user).toMatchObject({
        status: 'suspended',
        suspensionReason: 'account_deletion_requested',
      });

      // The session is dead NOW, not at the next refresh: `revokeSubject` ran
      // in the same transaction as the insert.
      await expect(
        tokens.rotate(session.refreshToken, ['customer']),
      ).rejects.toMatchObject({ code: 'unauthorized' });

      const deviceRows = await db.select().from(devices).where(eq(devices.subjectId, userId));
      expect(deviceRows[0]?.revokedAt).not.toBeNull();

      const rows = await db.select().from(deletionRequests).where(eq(deletionRequests.id, requestId));
      expect(rows[0]).toMatchObject({ status: 'requested', subjectType: 'user' });
    });

    it('still 409s a second request — the widened index keeps one open', async () => {
      const userId = await seedCustomer(db);
      await fileRequest(userId);

      const auth = await customerAuthHeaderFor(app, { userId });
      await request(app.getHttpServer()).delete('/v1/me').set('Authorization', auth).expect(409);
      await expect(tableCount('deletion_requests')).resolves.toBe(1);
    });
  });

  describe('erasure acceptance — PII gone, money untouched, evidence kept', () => {
    it('erases a customer end to end and leaves the ledger row counts identical', async () => {
      const userId = await seedCustomer(db, 'Ravi Kumar');
      const bookingId = await seedBooking(db, { userId, status: 'paid', total: '1450.00' });
      await db
        .update(bookings)
        .set({
          contactName: 'Ravi Kumar',
          contactMobile: '9876543210',
          pickupAddress: '12 MG Road',
          dropAddress: '45 Park Street',
          routePolyline: 'encoded-route',
        })
        .where(eq(bookings.id, bookingId));

      // A real storage object behind a saved vehicle's RC scan.
      const stored = await storage.put({
        buffer: Buffer.from('rc-scan-bytes'),
        mimeType: 'image/jpeg',
        keyPrefix: 'test-w19',
      });
      const rcKey = stored.fileUrl.replace('local://', '');

      await db.insert(savedVehicles).values({ userId, type: 'hatchback', rcUrl: stored.fileUrl });
      await db.insert(addresses).values({ userId, fullAddress: '12 MG Road', lat: 12.97, lng: 77.59 });
      await db.insert(emergencyContacts).values({ userId, name: 'Sister', phone: '9000000000' });
      await db.insert(socialIdentities).values({
        provider: 'google',
        providerSubject: `sub-${randomUUID()}`,
        subjectType: 'user',
        subjectId: userId,
      });
      await db.insert(loginChallenges).values({
        subjectId: userId,
        subjectType: 'user',
        realm: 'customer',
        otpId: randomUUID(),
        expiresAt: new Date(Date.now() + 300_000),
      });
      // The OTP rows are keyed by PHONE, not subject — the erasure looks them up
      // by the mobile it is about to tombstone, so this one has to carry the
      // user's real number rather than a convenient literal.
      const [seededUser] = await db
        .select({ mobile: users.mobile })
        .from(users)
        .where(eq(users.id, userId));
      await db.insert(otpVerifications).values({
        phone: seededUser!.mobile,
        purpose: 'customer_login',
        codeHash: 'hash',
        expiresAt: new Date(Date.now() + 300_000),
      });
      await db.insert(bookingLocationPath).values([
        { bookingId, lat: 12.97, lng: 77.59 },
        { bookingId, lat: 12.98, lng: 77.6 },
      ]);

      const moneyBefore = await moneySnapshot();
      const requestId = await fileRequest(userId);
      await approve(requestId);

      const run = await erasure.execute(requestId);
      expect(run.status).toBe('completed');

      // ── The subject's identity is a tombstone ─────────────────────────────
      const [user] = await db.select().from(users).where(eq(users.id, userId));
      expect(user!.mobile).toBe(`deleted:${userId}`);
      expect(user!.name).toBeNull();
      expect(user!.email).toBeNull();

      // ── Every small PII table is emptied ──────────────────────────────────
      await expect(db.select().from(savedVehicles).where(eq(savedVehicles.userId, userId))).resolves.toHaveLength(0);
      await expect(db.select().from(addresses).where(eq(addresses.userId, userId))).resolves.toHaveLength(0);
      await expect(
        db.select().from(emergencyContacts).where(eq(emergencyContacts.userId, userId)),
      ).resolves.toHaveLength(0);
      await expect(
        db.select().from(loginChallenges).where(eq(loginChallenges.subjectId, userId)),
      ).resolves.toHaveLength(0);
      await expect(db.select().from(devices).where(eq(devices.subjectId, userId))).resolves.toHaveLength(0);
      await expect(
        db.select().from(socialIdentities).where(eq(socialIdentities.subjectId, userId)),
      ).resolves.toHaveLength(0);
      const otpRows = await db
        .select()
        .from(otpVerifications)
        .where(eq(otpVerifications.phone, seededUser!.mobile));
      expect(otpRows).toHaveLength(0);

      // ── The booking keeps its numbers and loses its words ────────────────
      const [booking] = await db.select().from(bookings).where(eq(bookings.id, bookingId));
      expect(booking).toMatchObject({
        total: '1450.00',
        contactName: null,
        contactMobile: null,
        pickupAddress: null,
        dropAddress: null,
        routePolyline: null,
      });
      const pathRows = await db
        .select()
        .from(bookingLocationPath)
        .where(eq(bookingLocationPath.bookingId, bookingId));
      expect(pathRows).toHaveLength(0);

      // ── The object behind the RC scan is gone from storage ───────────────
      await expect(storage.get(rcKey)).rejects.toThrow();

      // ── Money is EXACTLY where it was ────────────────────────────────────
      await expect(moneySnapshot()).resolves.toEqual(moneyBefore);

      // ── The audit trail survived, and says what happened ─────────────────
      const auditRows = await db
        .select()
        .from(adminActions)
        .where(eq(adminActions.subjectType, 'deletion_request'));
      const actions = auditRows.map((row) => row.action);
      expect(actions).toContain('privacy.deletion.approve');
      const [requestRow] = await db
        .select()
        .from(deletionRequests)
        .where(eq(deletionRequests.id, requestId));
      expect(requestRow!.status).toBe('completed');
      expect(requestRow!.executedAt).not.toBeNull();
      expect(requestRow!.anonymisedAt).not.toBeNull();

      // ── The job log names the six ordered steps ──────────────────────────
      const [job] = await db
        .select()
        .from(erasureJobs)
        .where(eq(erasureJobs.requestId, requestId));
      expect(job!.status).toBe('completed');
      expect(job!.steps.map((step) => step.step)).toEqual([
        'holds',
        'revoke_sessions',
        'anonymise_identity',
        'erase_records',
        'erase_booking_pii',
        'complete',
      ]);

      // ── Idempotence: the second press adds no second job ─────────────────
      const again = await erasure.execute(requestId);
      expect(again.status).toBe('completed');
      await expect(tableCount('erasure_jobs')).resolves.toBe(1);
    });

    it('erases a driver: KYC scans, contact snapshots and the booking trail go; the safety record stays', async () => {
      const driverId = await seedDriver(db);
      const userId = await seedCustomer(db);
      const bookingId = await seedBooking(db, { userId, driverId, status: 'paid' });

      const license = await storage.put({
        buffer: Buffer.from('license-scan'),
        mimeType: 'image/jpeg',
        keyPrefix: 'test-w19',
      });
      const selfie = await storage.put({
        buffer: Buffer.from('selfie-scan'),
        mimeType: 'image/jpeg',
        keyPrefix: 'test-w19',
      });
      await db.insert(driverDocuments).values({
        driverId,
        docType: 'license',
        fileUrl: license.fileUrl,
        status: 'approved',
      });
      await db.insert(driverDocumentVersions).values({
        driverId,
        docType: 'selfie',
        fileUrl: selfie.fileUrl,
        status: 'rejected',
      });

      const [alert] = await db
        .insert(sosAlerts)
        .values({
          subjectType: 'driver',
          subjectId: driverId,
          lat: 12.97,
          lng: 77.59,
          source: 'app',
          status: 'triggered',
        })
        .returning({ id: sosAlerts.id });
      await db.insert(sosAlertContacts).values({
        alertId: alert!.id,
        name: 'Emergency Contact',
        phone: '9000000001',
      });

      await db
        .update(bookings)
        .set({ contactName: 'Shipper', contactMobile: '9876500000', dropAddress: 'Yard 7' })
        .where(eq(bookings.id, bookingId));

      const auth = await driverAuthHeaderFor(app, { driverId });
      await request(app.getHttpServer()).delete('/v1/me').set('Authorization', auth).expect(200);
      const [requestRow] = await db.select().from(deletionRequests);
      await approve(requestRow!.id);

      const run = await erasure.execute(requestRow!.id);
      expect(run.status).toBe('completed');

      const [driver] = await db.select().from(drivers).where(eq(drivers.id, driverId));
      expect(driver).toMatchObject({
        mobile: `deleted:${driverId}`,
        name: null,
        kycStatus: 'suspended',
        isOnline: false,
      });

      await expect(db.select().from(driverDocuments).where(eq(driverDocuments.driverId, driverId))).resolves.toHaveLength(0);
      await expect(
        db.select().from(driverDocumentVersions).where(eq(driverDocumentVersions.driverId, driverId)),
      ).resolves.toHaveLength(0);
      await expect(storage.get(license.fileUrl.replace('local://', ''))).rejects.toThrow();
      await expect(storage.get(selfie.fileUrl.replace('local://', ''))).rejects.toThrow();

      // The contact SNAPSHOT is PII; the incident row is a safety record.
      const contactRows = await db
        .select()
        .from(sosAlertContacts)
        .where(eq(sosAlertContacts.alertId, alert!.id));
      expect(contactRows).toHaveLength(0);
      const alertRows = await db.select().from(sosAlerts).where(eq(sosAlerts.id, alert!.id));
      expect(alertRows).toHaveLength(1);

      const [booking] = await db.select().from(bookings).where(eq(bookings.id, bookingId));
      expect(booking).toMatchObject({ contactName: null, contactMobile: null, dropAddress: null });
    });
  });

  describe('holds', () => {
    it('parks a live-booking erasure with a reason, erases nothing, and completes on the retry', async () => {
      const userId = await seedCustomer(db);
      const bookingId = await seedBooking(db, { userId, status: 'in_progress' });

      const requestId = await fileRequest(userId);
      await approve(requestId);

      const held = await erasure.execute(requestId);
      expect(held.status).toBe('on_hold');

      const [requestRow] = await db
        .select()
        .from(deletionRequests)
        .where(eq(deletionRequests.id, requestId));
      expect(requestRow).toMatchObject({ status: 'on_hold', holdReason: 'live_booking:1' });

      const [stillThere] = await db.select().from(users).where(eq(users.id, userId));
      expect(stillThere!.mobile).not.toContain('deleted:');

      // The job records the refusal — the operator can see WHY it is parked.
      const [job] = await db
        .select()
        .from(erasureJobs)
        .where(eq(erasureJobs.requestId, requestId));
      expect(job!.status).toBe('failed');
      expect(job!.steps[0]).toMatchObject({ step: 'holds', outcome: 'refused' });

      // The trip ends; the hold is re-run and the erasure completes.
      await db.update(bookings).set({ status: 'paid' }).where(eq(bookings.id, bookingId));
      const retry = await erasure.execute(requestId);
      expect(retry.status).toBe('completed');
      await expect(tableCount('erasure_jobs')).resolves.toBe(2);
    });

    it('parks a driver erasure while a payout is still open', async () => {
      const driverId = await seedDriver(db);
      await db.insert(payouts).values({
        ownerId: driverId,
        ownerType: 'driver',
        amount: '500.00',
        status: 'requested',
      });

      const auth = await driverAuthHeaderFor(app, { driverId });
      await request(app.getHttpServer()).delete('/v1/me').set('Authorization', auth).expect(200);
      const [requestRow] = await db.select().from(deletionRequests);
      await approve(requestRow!.id);

      const held = await erasure.execute(requestRow!.id);
      expect(held.status).toBe('on_hold');
      const [row] = await db.select().from(deletionRequests);
      expect(row!.holdReason).toBe('open_payout:1');

      await db.update(payouts).set({ status: 'paid' }).where(eq(payouts.ownerId, driverId));
      const retry = await erasure.execute(requestRow!.id);
      expect(retry.status).toBe('completed');
    });
  });

  describe('the retention sweep', () => {
    it('deletes exactly the rows past policy', async () => {
      const userId = await seedCustomer(db);
      const bookingId = await seedBooking(db, { userId });
      const old = new Date(Date.now() - 200 * DAY_MS);
      const recent = new Date(Date.now() - 5 * DAY_MS);

      await db.insert(bookingLocationPath).values([
        { bookingId, lat: 1, lng: 1, recordedAt: old },
        { bookingId, lat: 2, lng: 2, recordedAt: recent },
      ]);

      const [oldEvent] = await db
        .insert(notificationEvents)
        .values({ event: 'test.old', payload: {}, createdAt: old, updatedAt: old })
        .returning({ id: notificationEvents.id });
      const [newEvent] = await db
        .insert(notificationEvents)
        .values({ event: 'test.new', payload: {} })
        .returning({ id: notificationEvents.id });
      await db.insert(notificationDeliveries).values([
        {
          eventId: oldEvent!.id,
          recipientKey: 'user:x',
          channel: 'email',
          status: 'sent',
          destination: 'r***@example.com',
          createdAt: old,
          updatedAt: old,
        },
        {
          eventId: newEvent!.id,
          recipientKey: 'user:x',
          channel: 'email',
          status: 'sent',
          destination: 'r***@example.com',
        },
      ]);

      await db.insert(webhookEvents).values([
        { provider: 'razorpay', eventId: 'old-event', eventType: 'payment.captured', payload: {}, receivedAt: old },
        { provider: 'razorpay', eventId: 'new-event', eventType: 'payment.captured', payload: {} },
      ]);

      await erasure.sweep('manual');

      const paths = await db.select().from(bookingLocationPath);
      expect(paths).toHaveLength(1);
      expect(paths[0]!.lat).toBeCloseTo(2);

      // The old event takes its delivery with it (FK cascade); the new pair survives.
      const events = await db.select().from(notificationEvents);
      expect(events.map((row) => row.event)).toEqual(['test.new']);
      const deliveries = await db.select().from(notificationDeliveries);
      expect(deliveries).toHaveLength(1);
      expect(deliveries[0]!.eventId).toBe(newEvent!.id);

      const hooks = await db.select().from(webhookEvents);
      expect(hooks.map((row) => row.eventId)).toEqual(['new-event']);
    });
  });

  describe('the console lane', () => {
    it('gates the queue on privacy.handle and the retention editor on admin.manage', async () => {
      const userId = await seedCustomer(db);
      await fileRequest(userId);

      const support = await seedAdmin(db, { subRole: 'support' });
      const supportAuth = await adminAuthHeaderFor(app, { adminId: support.id, subRole: 'support' });
      const operations = await seedAdmin(db, { subRole: 'operations' });
      const operationsAuth = await adminAuthHeaderFor(app, {
        adminId: operations.id,
        subRole: 'operations',
      });

      // Support holds `privacy.handle` (Phase 12's matrix); operations does not.
      const list = await request(app.getHttpServer())
        .get('/v1/admin/privacy/deletion-requests')
        .set('Authorization', supportAuth)
        .expect(200);
      // The excluded-route contract assert: this envelope is the one the
      // contracts walk cannot build, so it is pinned here.
      expectMatchesContract(adminDeletionRequestsResponseSchema, list.body);
      expect(list.body.items).toHaveLength(1);
      expect(list.body.items[0]).toMatchObject({ status: 'requested', subjectType: 'user' });
      // The label is masked, never the raw mobile.
      expect(list.body.items[0].subjectLabel).toMatch(/^(\*\*\*\*\*\*|\S)/);

      await request(app.getHttpServer())
        .get('/v1/admin/privacy/deletion-requests')
        .set('Authorization', operationsAuth)
        .expect(403);

      // Reads are fine for support; the retention WRITE is super-only.
      await request(app.getHttpServer())
        .get('/v1/admin/privacy/retention')
        .set('Authorization', supportAuth)
        .expect(200);
      await request(app.getHttpServer())
        .put('/v1/admin/privacy/retention')
        .set('Authorization', supportAuth)
        .send({ policies: [{ policyKey: 'location_paths', retentionDays: 30 }] })
        .expect(403);
    });

    it('drives the workflow: hold needs a reason, decisions are one-way, execute waits for approval', async () => {
      const userId = await seedCustomer(db);
      const requestId = await fileRequest(userId);
      const admin = await seedAdmin(db, { subRole: 'super_admin' });
      const auth = await adminAuthHeaderFor(app, { adminId: admin.id, subRole: 'super_admin' });

      // A hold with no reason is a 422 — the contract requires it.
      await request(app.getHttpServer())
        .post(`/v1/admin/privacy/deletion-requests/${requestId}/hold`)
        .set('Authorization', auth)
        .send({})
        .expect(422);

      // Executing before approving is refused: the two-person discipline is the point.
      await request(app.getHttpServer())
        .post(`/v1/admin/privacy/deletion-requests/${requestId}/execute`)
        .set('Authorization', auth)
        .send({})
        .expect(409);

      await request(app.getHttpServer())
        .post(`/v1/admin/privacy/deletion-requests/${requestId}/hold`)
        .set('Authorization', auth)
        .send({ reason: 'customer is disputing a charge' })
        .expect(200);

      await request(app.getHttpServer())
        .post(`/v1/admin/privacy/deletion-requests/${requestId}/reject`)
        .set('Authorization', auth)
        .send({ reason: 'chargeback first' })
        .expect(200);

      // Rejected is terminal for this row — approve cannot revive it.
      await request(app.getHttpServer())
        .post(`/v1/admin/privacy/deletion-requests/${requestId}/approve`)
        .set('Authorization', auth)
        .send({})
        .expect(409);

      const [row] = await db
        .select()
        .from(deletionRequests)
        .where(eq(deletionRequests.id, requestId));
      expect(row).toMatchObject({ status: 'rejected', decidedBy: admin.id });

      // The parameterised detail is EXCLUDED from the contracts walk; its
      // contract is asserted here instead.
      const detail = await request(app.getHttpServer())
        .get(`/v1/admin/privacy/deletion-requests/${requestId}`)
        .set('Authorization', auth)
        .expect(200);
      expectMatchesContract(adminDeletionRequestSchema, detail.body);

      const auditRows = await db
        .select()
        .from(adminActions)
        .where(eq(adminActions.subjectId, requestId));
      expect(auditRows.map((r) => r.action).sort()).toEqual([
        'privacy.deletion.hold',
        'privacy.deletion.reject',
      ]);
    });

    it('serves the export bundle with bookings, and audits the read', async () => {
      const userId = await seedCustomer(db, 'Meera Iyer');
      await seedBooking(db, { userId, status: 'paid', total: '900.00' });

      const support = await seedAdmin(db, { subRole: 'support' });
      const auth = await adminAuthHeaderFor(app, { adminId: support.id, subRole: 'support' });

      const res = await request(app.getHttpServer())
        .get(`/v1/admin/users/${userId}/export`)
        .set('Authorization', auth)
        .expect(200);
      expectMatchesContract(adminSubjectExportResponseSchema, res.body);
      expect(res.body).toMatchObject({ subjectType: 'user', subjectId: userId });
      expect(res.body.profile).toMatchObject({ name: 'Meera Iyer' });
      expect(res.body.bookings).toHaveLength(1);
      expect(res.body.bookings[0]).toMatchObject({ status: 'paid', total: '900.00' });

      const auditRows = await db
        .select()
        .from(adminActions)
        .where(eq(adminActions.action, 'privacy.user.export'));
      expect(auditRows).toHaveLength(1);
      expect(auditRows[0]!.subjectId).toBe(userId);
    });

    it('corrects an identity, refuses a taken mobile, and audits the before/after', async () => {
      const userId = await seedCustomer(db, 'Old Name');
      // A real 10-digit mobile on another account — the mock helper's numbers
      // carry a `+91` prefix, which the contract's correction schema rejects
      // for the FIELD, so the collision has to be built with a valid one.
      await db.insert(users).values({ mobile: '9876501234', name: 'Other Person' });

      const support = await seedAdmin(db, { subRole: 'support' });
      const auth = await adminAuthHeaderFor(app, { adminId: support.id, subRole: 'support' });

      // No changed field is a 422 — "correct nothing" is not a correction.
      await request(app.getHttpServer())
        .post(`/v1/admin/users/${userId}/correct`)
        .set('Authorization', auth)
        .send({ reason: 'customer called' })
        .expect(422);

      await request(app.getHttpServer())
        .post(`/v1/admin/users/${userId}/correct`)
        .set('Authorization', auth)
        .send({ mobile: '9876501234', reason: 'customer called' })
        .expect(409);

      const res = await request(app.getHttpServer())
        .post(`/v1/admin/users/${userId}/correct`)
        .set('Authorization', auth)
        .send({ name: 'New Name', email: 'new@example.com', reason: 'customer called' })
        .expect(200);
      expect(res.body).toMatchObject({ name: 'New Name', email: 'new@example.com' });

      const auditRows = await db
        .select()
        .from(adminActions)
        .where(eq(adminActions.action, 'privacy.user.correct'));
      expect(auditRows).toHaveLength(1);
      expect(auditRows[0]!.before).toMatchObject({ name: 'Old Name' });
      expect(auditRows[0]!.after).toMatchObject({ name: 'New Name' });
    });

    it('refuses unknown retention keys and records the edit', async () => {
      const admin = await seedAdmin(db, { subRole: 'super_admin' });
      const auth = await adminAuthHeaderFor(app, { adminId: admin.id, subRole: 'super_admin' });

      await request(app.getHttpServer())
        .put('/v1/admin/privacy/retention')
        .set('Authorization', auth)
        .send({ policies: [{ policyKey: 'not_a_policy', retentionDays: 1 }] })
        .expect(422);

      const before = await request(app.getHttpServer())
        .get('/v1/admin/privacy/retention')
        .set('Authorization', auth)
        .expect(200);
      const location = before.body.items.find(
        (item: { policyKey: string }) => item.policyKey === 'location_paths',
      );
      expect(location).toMatchObject({ enforced: true, retentionDays: 180 });
      const kyc = before.body.items.find(
        (item: { policyKey: string }) => item.policyKey === 'kyc_documents',
      );
      expect(kyc).toMatchObject({ enforced: false });

      const after = await request(app.getHttpServer())
        .put('/v1/admin/privacy/retention')
        .set('Authorization', auth)
        .send({ policies: [{ policyKey: 'location_paths', retentionDays: 90 }] })
        .expect(200);
      const updated = after.body.items.find(
        (item: { policyKey: string }) => item.policyKey === 'location_paths',
      );
      expect(updated.retentionDays).toBe(90);

      const auditRows = await db
        .select()
        .from(adminActions)
        .where(eq(adminActions.action, 'privacy.retention.update'));
      expect(auditRows).toHaveLength(1);
    });
  });
});
