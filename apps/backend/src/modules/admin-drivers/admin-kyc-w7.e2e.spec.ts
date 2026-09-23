import type { INestApplication } from '@nestjs/common';
import { adminDriverDocumentVersionsResponseSchema, ErrorCodes } from '@towing/api-contracts';
import { and, eq, inArray } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { adminActions, driverDocumentVersions, driverDocuments, drivers } from '../../db/schema';
import { adminAuthHeaderFor, createTestApp, driverAuthHeaderFor } from '../../test/app';
import { expectMatchesContract } from '../../test/contracts';
import {
  seedAdmin,
  seedDriver,
  setupTestDatabase,
  truncateAll,
  type TestDatabase,
} from '../../test/db';
import { closeTestRedis, flushTestRedis } from '../../test/redis';

/**
 * W7 — finishing KYC: document versions, a paginated queue, the last known
 * location and bulk decisions.
 *
 * What each block is really pinning:
 * - **versions**: a resubmission must not orphan the previous object, and a
 *   review must complete the version of THE FILE it reviewed — not "the latest
 *   row", which a resubmission landing mid-review would mis-stamp.
 * - **pagination**: oldest-first across pages, with a real total.
 * - **last known location**: labelled as such, and `null` unless a ping
 *   timestamp backs it.
 * - **bulk**: per-item results (one bad id never rolls back the rest), the
 *   shared reject reason, the 50 cap, and the `kyc.bulk` role matrix.
 */
describe('W7 — KYC finish (/v1/admin/drivers)', () => {
  let app: INestApplication;
  let db: TestDatabase;

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
  });

  async function headerFor(subRole: 'super_admin' | 'operations' | 'support' | 'finance') {
    const admin = await seedAdmin(db, { subRole });
    return {
      adminId: admin.id,
      header: await adminAuthHeaderFor(app, { adminId: admin.id, subRole }),
    };
  }

  /** PUTs bytes to a presigned URL — the same hop `driver-kyc.e2e.spec.ts` makes. */
  async function uploadTo(uploadUrl: string, body: Buffer) {
    const { pathname, search } = new URL(uploadUrl);
    return request(app.getHttpServer())
      .put(`${pathname}${search}`)
      .set('Content-Type', 'application/octet-stream')
      .send(body)
      .expect(204);
  }

  /** presign → upload → confirm, returning the confirmed key. */
  async function confirmDocument(
    auth: string,
    docType: 'license' | 'rc' | 'gov_id' | 'inspection' | 'selfie',
    bytes = 'v1',
  ): Promise<string> {
    const presign = await request(app.getHttpServer())
      .post('/v1/driver/kyc/documents/presign')
      .set('Authorization', auth)
      .send({ docType })
      .expect(201);
    await uploadTo(presign.body.uploadUrl, Buffer.from(bytes));
    await request(app.getHttpServer())
      .post('/v1/driver/kyc/documents/confirm')
      .set('Authorization', auth)
      .send({ docType, key: presign.body.key })
      .expect(204);
    return presign.body.key as string;
  }

  async function versionsOf(driverId: string) {
    return db
      .select()
      .from(driverDocumentVersions)
      .where(eq(driverDocumentVersions.driverId, driverId))
      .orderBy(driverDocumentVersions.createdAt);
  }

  describe('driver_document_versions — the history a resubmission used to destroy', () => {
    it('writes one version per confirm, and a resubmission supersedes the version before it', async () => {
      const driverId = await seedDriver(db, { kycStatus: 'incomplete', vehicleClass: null });
      const auth = await driverAuthHeaderFor(app, { driverId, kycStatus: 'incomplete' });

      const firstKey = await confirmDocument(auth, 'license', 'first');
      const secondKey = await confirmDocument(auth, 'license', 'second');

      const rows = await versionsOf(driverId);
      expect(rows).toHaveLength(2);
      expect(rows[0]).toMatchObject({
        docType: 'license',
        fileUrl: `local://${firstKey}`,
        status: 'pending',
      });
      expect(rows[0]!.supersededAt).not.toBeNull();
      expect(rows[1]).toMatchObject({
        docType: 'license',
        fileUrl: `local://${secondKey}`,
        status: 'pending',
        rejectionReason: null,
      });
      expect(rows[1]!.supersededAt).toBeNull();

      // The current row still points at the newest file — the history is
      // additive, not a second source of truth.
      const [doc] = await db
        .select()
        .from(driverDocuments)
        .where(and(eq(driverDocuments.driverId, driverId), eq(driverDocuments.docType, 'license')));
      expect(doc!.fileUrl).toBe(`local://${secondKey}`);
    });

    it('a review completes the version of the file it reviewed, and leaves a replaced version untouched', async () => {
      const { header } = await headerFor('operations');
      const driverId = await seedDriver(db, { kycStatus: 'pending' });
      const auth = await driverAuthHeaderFor(app, { driverId, kycStatus: 'pending' });

      await confirmDocument(auth, 'license', 'first');
      await confirmDocument(auth, 'license', 'second');

      const [doc] = await db
        .select({ id: driverDocuments.id })
        .from(driverDocuments)
        .where(and(eq(driverDocuments.driverId, driverId), eq(driverDocuments.docType, 'license')));

      await request(app.getHttpServer())
        .post(`/v1/admin/drivers/${driverId}/documents/${doc!.id}/review`)
        .set('Authorization', header)
        .send({ decision: 'approve' })
        .expect(200);

      const rows = await versionsOf(driverId);
      // Newest (the reviewed file) is complete.
      expect(rows[1]).toMatchObject({ status: 'approved', rejectionReason: null });
      expect(rows[1]!.verifiedAt).not.toBeNull();
      // The superseded one is NOT stamped: it was replaced before any human
      // saw it, and this update is matched on the file, not on "the latest".
      expect(rows[0]).toMatchObject({ status: 'pending', verifiedBy: null, verifiedAt: null });
      expect(rows[0]!.supersededAt).not.toBeNull();
    });

    it('GET /:id/document-versions returns every upload newest-first with a presigned URL for each', async () => {
      const { header } = await headerFor('operations');
      const driverId = await seedDriver(db, { kycStatus: 'pending' });
      const auth = await driverAuthHeaderFor(app, { driverId, kycStatus: 'pending' });

      await confirmDocument(auth, 'license', 'first');
      const secondKey = await confirmDocument(auth, 'license', 'second');
      await confirmDocument(auth, 'selfie', 'selfie');

      const res = await request(app.getHttpServer())
        .get(`/v1/admin/drivers/${driverId}/document-versions`)
        .set('Authorization', header)
        .expect(200);

      // The route is parameterised, so it sits in the contracts suite's
      // EXCLUDED list with this assertion as its reason.
      expectMatchesContract(adminDriverDocumentVersionsResponseSchema, res.body);

      expect(res.body.items).toHaveLength(3);
      // Newest first.
      expect(res.body.items[0]).toMatchObject({
        docType: 'selfie',
        status: 'pending',
        supersededAt: null,
      });
      expect(res.body.items[1]).toMatchObject({
        docType: 'license',
        supersededAt: null,
      });
      expect(res.body.items[2]).toMatchObject({ docType: 'license' });
      expect(res.body.items[2].supersededAt).not.toBeNull();
      // Each version keeps its OWN object alive — superseded files included.
      expect(
        res.body.items.every((v: { thumbnailUrl: string }) =>
          /^http.+\/v1\/files\/.+sig=/.test(v.thumbnailUrl),
        ),
      ).toBe(true);
      expect(res.body.items[1].thumbnailUrl).toMatch(/^http.+\/v1\/files\/.+sig=/);
      expect(secondKey).toBeTruthy();

      // The fallback shape: a driver whose only document predates the versions
      // table still shows that file as its single history entry.
      const legacyId = await seedDriver(db, { kycStatus: 'pending' });
      await db.insert(driverDocuments).values({
        driverId: legacyId,
        docType: 'rc',
        fileUrl: `local://driver-documents/${legacyId}/rc.jpg`,
        status: 'approved',
      });

      const legacy = await request(app.getHttpServer())
        .get(`/v1/admin/drivers/${legacyId}/document-versions`)
        .set('Authorization', header)
        .expect(200);
      expect(legacy.body.items).toHaveLength(1);
      expect(legacy.body.items[0]).toMatchObject({ docType: 'rc', status: 'approved' });

      await request(app.getHttpServer())
        .get(`/v1/admin/drivers/${randomUUID()}/document-versions`)
        .set('Authorization', header)
        .expect(404);
    });

    it('a support admin can read the history (kyc.read) but cannot review', async () => {
      const support = await headerFor('support');
      const driverId = await seedDriver(db, { kycStatus: 'pending' });

      await request(app.getHttpServer())
        .get(`/v1/admin/drivers/${driverId}/document-versions`)
        .set('Authorization', support.header)
        .expect(200);

      await db.insert(driverDocuments).values({
        driverId,
        docType: 'license',
        fileUrl: `local://driver-documents/${driverId}/license.jpg`,
        status: 'pending',
      });
      const [doc] = await db.select().from(driverDocuments).where(eq(driverDocuments.driverId, driverId));

      await request(app.getHttpServer())
        .post(`/v1/admin/drivers/${driverId}/documents/${doc!.id}/review`)
        .set('Authorization', support.header)
        .send({ decision: 'approve' })
        .expect(403);
    });

    it('a document review is readable subject-scoped by another kyc.read admin', async () => {
      const reviewer = await headerFor('operations');
      const support = await headerFor('support');
      const finance = await headerFor('finance');
      const driverId = await seedDriver(db, { kycStatus: 'pending' });

      await db.insert(driverDocuments).values({
        driverId,
        docType: 'license',
        fileUrl: `local://driver-documents/${driverId}/license.jpg`,
        status: 'pending',
      });
      const [doc] = await db.select().from(driverDocuments).where(eq(driverDocuments.driverId, driverId));

      await request(app.getHttpServer())
        .post(`/v1/admin/drivers/${driverId}/documents/${doc!.id}/review`)
        .set('Authorization', reviewer.header)
        .send({ decision: 'approve' })
        .expect(200);

      const scoped = `/v1/admin/audit?subjectType=driver_document&subjectId=${doc!.id}`;

      const asSupport = await request(app.getHttpServer())
        .get(scoped)
        .set('Authorization', support.header)
        .expect(200);
      expect(asSupport.body.entries.map((e: { action: string }) => e.action)).toContain(
        'driver.document.approve',
      );

      // Finance holds no `kyc.read`, so the subject-scoped feed falls back to
      // the viewer's own rows — and this admin reviewed nothing.
      const asFinance = await request(app.getHttpServer())
        .get(scoped)
        .set('Authorization', finance.header)
        .expect(200);
      expect(asFinance.body.entries).toHaveLength(0);
    });
  });

  describe('GET /pending — paginated', () => {
    it('pages oldest-first and reports the total', async () => {
      const { header } = await headerFor('support');
      const oldest = await seedDriver(db, { kycStatus: 'pending', name: 'Oldest' });
      const middle = await seedDriver(db, { kycStatus: 'pending', name: 'Middle' });
      const newest = await seedDriver(db, { kycStatus: 'pending', name: 'Newest' });
      const base = Date.now();
      await db
        .update(drivers)
        .set({ kycSubmittedAt: new Date(base - 3 * 60_000) })
        .where(eq(drivers.id, oldest));
      await db
        .update(drivers)
        .set({ kycSubmittedAt: new Date(base - 2 * 60_000) })
        .where(eq(drivers.id, middle));
      await db
        .update(drivers)
        .set({ kycSubmittedAt: new Date(base - 60_000) })
        .where(eq(drivers.id, newest));

      const firstPage = await request(app.getHttpServer())
        .get('/v1/admin/drivers/pending?page=1&limit=2')
        .set('Authorization', header)
        .expect(200);
      expect(firstPage.body).toMatchObject({ page: 1, limit: 2, total: 3 });
      expect(firstPage.body.items.map((d: { id: string }) => d.id)).toEqual([oldest, middle]);

      const secondPage = await request(app.getHttpServer())
        .get('/v1/admin/drivers/pending?page=2&limit=2')
        .set('Authorization', header)
        .expect(200);
      expect(secondPage.body.items.map((d: { id: string }) => d.id)).toEqual([newest]);
      expect(secondPage.body.total).toBe(3);
    });

    it('carries the last known location only when a ping timestamp backs it', async () => {
      const { header } = await headerFor('operations');
      const located = await seedDriver(db, { kycStatus: 'pending', name: 'Located' });
      const ping = new Date();
      await db
        .update(drivers)
        .set({ currentLocation: { lat: 12.9716, lng: 77.5946 }, lastPingAt: ping })
        .where(eq(drivers.id, located));

      // A position with no `last_ping_at` cannot be dated, and an undated
      // position is not something the console should draw as if it were current.
      const undated = await seedDriver(db, { kycStatus: 'pending', name: 'Undated' });
      await db
        .update(drivers)
        .set({ currentLocation: { lat: 13.0827, lng: 80.2707 } })
        .where(eq(drivers.id, undated));

      await seedDriver(db, { kycStatus: 'pending', name: 'Never pinged' });

      const res = await request(app.getHttpServer())
        .get('/v1/admin/drivers/pending?limit=10')
        .set('Authorization', header)
        .expect(200);

      const byName = new Map(
        res.body.items.map((d: { name: string; lastKnownLocation: unknown }) => [d.name, d]),
      );
      expect(byName.get('Located')).toMatchObject({
        lastKnownLocation: { lat: 12.9716, lng: 77.5946, at: ping.toISOString() },
      });
      expect((byName.get('Undated') as { lastKnownLocation: unknown }).lastKnownLocation).toBeNull();
      expect(
        (byName.get('Never pinged') as { lastKnownLocation: unknown }).lastKnownLocation,
      ).toBeNull();
    });
  });

  describe('POST /kyc/bulk — bulk approve/reject', () => {
    /** A driver whose name an admin has already read off their licence (0043). */
    async function confirmName(...driverIds: string[]) {
      await db
        .update(drivers)
        .set({ nameVerifiedAt: new Date() })
        .where(inArray(drivers.id, driverIds));
    }

    it("refuses to bulk-approve a driver whose name nobody has confirmed, and approves the rest", async () => {
      // A bulk run cannot read a name off each licence, so a driver approved in
      // bulk used to keep the name the fleet typed at invite, unverified (0043).
      const admin = await headerFor('operations');
      const confirmed = await seedDriver(db, { kycStatus: 'pending' });
      const unconfirmed = await seedDriver(db, { kycStatus: 'pending' });
      await confirmName(confirmed);

      const res = await request(app.getHttpServer())
        .post('/v1/admin/drivers/kyc/bulk')
        .set('Authorization', admin.header)
        .send({ decision: 'approve', driverIds: [confirmed, unconfirmed] })
        .expect(200);

      expect(res.body).toMatchObject({ succeeded: 1, failed: 1 });
      expect(res.body.results[1]).toMatchObject({
        driverId: unconfirmed,
        ok: false,
        error: { code: ErrorCodes.KYC_NAME_UNCONFIRMED },
      });
      const [left] = await db.select().from(drivers).where(eq(drivers.id, unconfirmed));
      expect(left!.kycStatus).toBe('pending');
    });

    it('does not check names on a bulk rejection, which approves no name', async () => {
      const admin = await headerFor('operations');
      const driverId = await seedDriver(db, { kycStatus: 'pending' });

      const res = await request(app.getHttpServer())
        .post('/v1/admin/drivers/kyc/bulk')
        .set('Authorization', admin.header)
        .send({ decision: 'reject', driverIds: [driverId], reason: 'Documents are unreadable' })
        .expect(200);

      expect(res.body).toMatchObject({ succeeded: 1, failed: 0 });
    });

    it('approves every driver, one audit row each plus a summary row', async () => {
      const admin = await headerFor('operations');
      const first = await seedDriver(db, { kycStatus: 'pending' });
      const second = await seedDriver(db, { kycStatus: 'pending' });
      await confirmName(first, second);

      const res = await request(app.getHttpServer())
        .post('/v1/admin/drivers/kyc/bulk')
        .set('Authorization', admin.header)
        .send({ decision: 'approve', driverIds: [first, second] })
        .expect(200);

      expect(res.body).toMatchObject({ decision: 'approve', succeeded: 2, failed: 0 });
      expect(res.body.results).toHaveLength(2);
      expect(res.body.results.every((r: { ok: boolean }) => r.ok)).toBe(true);

      const rows = await db.select().from(drivers).where(eq(drivers.kycStatus, 'approved'));
      expect(rows.map((r) => r.id).sort()).toEqual([first, second].sort());

      const actions = await db
        .select()
        .from(adminActions)
        .where(eq(adminActions.adminId, admin.adminId));
      const perDriver = actions.filter((a) => a.action === 'driver.kyc.approve');
      expect(perDriver.map((a) => a.subjectId).sort()).toEqual([first, second].sort());

      const summary = actions.find((a) => a.action === 'driver.kyc.bulk_approve');
      expect(summary).toBeDefined();
      expect(summary!.subjectType).toBe('driver_kyc_bulk');
      expect(summary!.subjectId).toBeNull();
      expect(summary!.after).toMatchObject({
        decision: 'approve',
        requested: 2,
        succeeded: 2,
        failed: 0,
      });
    });

    it('reports a bad id as that driver’s failure and still decides the rest', async () => {
      const admin = await headerFor('operations');
      const good = await seedDriver(db, { kycStatus: 'pending' });
      const missing = randomUUID();
      await confirmName(good);

      const res = await request(app.getHttpServer())
        .post('/v1/admin/drivers/kyc/bulk')
        .set('Authorization', admin.header)
        .send({ decision: 'approve', driverIds: [good, missing] })
        .expect(200);

      expect(res.body).toMatchObject({ succeeded: 1, failed: 1 });
      expect(res.body.results[0]).toMatchObject({ driverId: good, ok: true, kycStatus: 'approved' });
      expect(res.body.results[1]).toMatchObject({
        driverId: missing,
        ok: false,
        kycStatus: null,
        error: { code: 'not_found' },
      });

      // The good driver is decided, and the failure is not a 500.
      const [row] = await db.select().from(drivers).where(eq(drivers.id, good));
      expect(row!.kycStatus).toBe('approved');
    });

    it('bulk reject applies one shared reason to every driver, and requires one', async () => {
      const admin = await headerFor('operations');
      const first = await seedDriver(db, { kycStatus: 'pending' });
      const second = await seedDriver(db, { kycStatus: 'pending' });

      await request(app.getHttpServer())
        .post('/v1/admin/drivers/kyc/bulk')
        .set('Authorization', admin.header)
        .send({ decision: 'reject', driverIds: [first, second] })
        .expect(422);

      const res = await request(app.getHttpServer())
        .post('/v1/admin/drivers/kyc/bulk')
        .set('Authorization', admin.header)
        .send({ decision: 'reject', driverIds: [first, second], reason: 'Blurred documents' })
        .expect(200);
      expect(res.body).toMatchObject({ decision: 'reject', succeeded: 2, failed: 0 });

      const rows = await db
        .select({ id: drivers.id, status: drivers.kycStatus, reason: drivers.rejectionReason })
        .from(drivers);
      for (const row of rows) {
        expect(row.status).toBe('rejected');
        expect(row.reason).toBe('Blurred documents');
      }
    });

    it('caps the batch at 50 — the guide wants a human on a bulk approval', async () => {
      const admin = await headerFor('operations');
      const ids = Array.from({ length: 51 }, () => randomUUID());

      await request(app.getHttpServer())
        .post('/v1/admin/drivers/kyc/bulk')
        .set('Authorization', admin.header)
        .send({ decision: 'approve', driverIds: ids })
        .expect(422);
    });

    it('is gated on kyc.bulk: support and finance are refused, operations may', async () => {
      const support = await headerFor('support');
      const finance = await headerFor('finance');
      const operations = await headerFor('operations');
      const driverId = await seedDriver(db, { kycStatus: 'pending' });

      for (const caller of [support, finance]) {
        await request(app.getHttpServer())
          .post('/v1/admin/drivers/kyc/bulk')
          .set('Authorization', caller.header)
          .send({ decision: 'approve', driverIds: [driverId] })
          .expect(403);
      }

      await request(app.getHttpServer())
        .post('/v1/admin/drivers/kyc/bulk')
        .set('Authorization', operations.header)
        .send({ decision: 'approve', driverIds: [driverId] })
        .expect(200);

      // A refused bulk writes nothing at all — not even the summary row.
      const refusals = await db
        .select()
        .from(adminActions)
        .where(eq(adminActions.adminId, support.adminId));
      expect(refusals).toHaveLength(0);
    });
  });
});
