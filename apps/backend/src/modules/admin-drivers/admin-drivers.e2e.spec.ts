import type { INestApplication } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { adminActions, driverDocuments, drivers, refreshTokens } from '../../db/schema';
import { adminAuthHeaderFor, createTestApp, driverAuthHeaderFor } from '../../test/app';
import { seedAdmin, seedDriver, setupTestDatabase, truncateAll, type TestDatabase } from '../../test/db';
import { closeTestRedis, flushTestRedis } from '../../test/redis';
import { TokenService } from '../auth/token.service';

/**
 * The §3.1 KYC queue and per-document review (Phase 11) — built on Phase 10's
 * single `POST :id/kyc` decision route, moved here from `admin-auth`.
 *
 * The RBAC negative is still the throughline: a `support` operator holds a
 * completely valid admin session, can read the queue, and is refused by every
 * route that decides anything.
 */
describe('admin drivers (/v1/admin/drivers)', () => {
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

  async function insertDocument(driverId: string, docType: 'license' | 'selfie' = 'license') {
    const [doc] = await db
      .insert(driverDocuments)
      .values({
        driverId,
        docType,
        fileUrl: `local://driver-documents/${driverId}/${docType}.png`,
        status: 'pending',
      })
      .returning({ id: driverDocuments.id });
    return doc!.id;
  }

  describe('POST /:id/kyc — the driver-level decision', () => {
    it('an operations admin can approve KYC; the audit row records before and after', async () => {
      const admin = await seedAdmin(db, { subRole: 'operations' });
      const driverId = await seedDriver(db);
      await db.update(drivers).set({ kycStatus: 'pending' }).where(eq(drivers.id, driverId));

      const res = await request(app.getHttpServer())
        .post(`/v1/admin/drivers/${driverId}/kyc`)
        .set('Authorization', await adminAuthHeaderFor(app, { adminId: admin.id }))
        .send({ decision: 'approve' })
        .expect(200);

      expect(res.body).toMatchObject({ driverId, kycStatus: 'approved', sessionsRevoked: 0 });

      const [driver] = await db.select().from(drivers).where(eq(drivers.id, driverId));
      expect(driver!.approvedBy).toBe(admin.id);
      expect(driver!.approvedAt).not.toBeNull();

      const [action] = await db.select().from(adminActions);
      expect(action).toMatchObject({
        adminId: admin.id,
        action: 'driver.kyc.approve',
        subjectType: 'driver',
        subjectId: driverId,
      });
      expect(action!.before).toMatchObject({ kycStatus: 'pending' });
      expect(action!.after).toMatchObject({ kycStatus: 'approved' });
    });

    /**
     * The mechanism behind "a driver's name comes from their licence" (Ehsan,
     * 23 Sep). Before this, that rule held only at the driver's end — they
     * cannot edit their own name — while the value itself was whatever the
     * fleet typed at invite and nothing ever checked it against the document.
     */
    it('approving with a licence name replaces the name the fleet typed at invite', async () => {
      const admin = await seedAdmin(db, { subRole: 'operations' });
      const driverId = await seedDriver(db, { name: 'Ravi K', kycStatus: 'pending' });

      await request(app.getHttpServer())
        .post(`/v1/admin/drivers/${driverId}/kyc`)
        .set('Authorization', await adminAuthHeaderFor(app, { adminId: admin.id }))
        .send({ decision: 'approve', licenceName: 'Ravi Kumar Sharma' })
        .expect(200);

      const [driver] = await db.select().from(drivers).where(eq(drivers.id, driverId));
      expect(driver!.name).toBe('Ravi Kumar Sharma');

      // The rename is answerable later, not silent: renaming a person on the
      // strength of a document is the kind of change an audit trail is for.
      const [action] = await db.select().from(adminActions);
      expect(action!.before).toMatchObject({ name: 'Ravi K' });
      expect(action!.after).toMatchObject({ name: 'Ravi Kumar Sharma' });
    });

    it('approving WITHOUT a licence name leaves the invited name untouched', async () => {
      const admin = await seedAdmin(db, { subRole: 'operations' });
      const driverId = await seedDriver(db, { name: 'Ravi K', kycStatus: 'pending' });

      await request(app.getHttpServer())
        .post(`/v1/admin/drivers/${driverId}/kyc`)
        .set('Authorization', await adminAuthHeaderFor(app, { adminId: admin.id }))
        .send({ decision: 'approve' })
        .expect(200);

      const [driver] = await db.select().from(drivers).where(eq(drivers.id, driverId));
      expect(driver!.name).toBe('Ravi K');
    });

    /**
     * A licence is read at APPROVAL. A rejection has no approved document
     * behind it, so a name sent alongside one must not land — otherwise the
     * field becomes a general-purpose rename endpoint wearing a KYC label.
     */
    it('a licence name sent with a rejection is ignored', async () => {
      const admin = await seedAdmin(db, { subRole: 'operations' });
      const driverId = await seedDriver(db, { name: 'Ravi K', kycStatus: 'pending' });

      await request(app.getHttpServer())
        .post(`/v1/admin/drivers/${driverId}/kyc`)
        .set('Authorization', await adminAuthHeaderFor(app, { adminId: admin.id }))
        .send({ decision: 'reject', reason: 'Licence is illegible', licenceName: 'Someone Else' })
        .expect(200);

      const [driver] = await db.select().from(drivers).where(eq(drivers.id, driverId));
      expect(driver!.name).toBe('Ravi K');
    });

    it('a SUPPORT admin cannot approve KYC (§4.2 RBAC)', async () => {
      const support = await seedAdmin(db, { subRole: 'support' });
      const driverId = await seedDriver(db);

      await request(app.getHttpServer())
        .get('/v1/admin/auth/me')
        .set('Authorization', await adminAuthHeaderFor(app, { adminId: support.id, subRole: 'support' }))
        .expect(200);

      await request(app.getHttpServer())
        .post(`/v1/admin/drivers/${driverId}/kyc`)
        .set('Authorization', await adminAuthHeaderFor(app, { adminId: support.id, subRole: 'support' }))
        .send({ decision: 'approve' })
        .expect(403);

      expect(await db.select().from(adminActions)).toHaveLength(0);
    });

    it('a finance admin cannot approve KYC either', async () => {
      const finance = await seedAdmin(db, { subRole: 'finance' });
      const driverId = await seedDriver(db);

      await request(app.getHttpServer())
        .post(`/v1/admin/drivers/${driverId}/kyc`)
        .set('Authorization', await adminAuthHeaderFor(app, { adminId: finance.id, subRole: 'finance' }))
        .send({ decision: 'approve' })
        .expect(403);
    });

    it('suspending a driver revokes their live sessions immediately (§9.4.3)', async () => {
      const admin = await seedAdmin(db, { subRole: 'super_admin' });
      const driverId = await seedDriver(db);
      const tokens = app.get(TokenService);
      await tokens.issueSession({ subjectId: driverId, realm: 'driver' });

      const res = await request(app.getHttpServer())
        .post(`/v1/admin/drivers/${driverId}/kyc`)
        .set('Authorization', await adminAuthHeaderFor(app, { adminId: admin.id, subRole: 'super_admin' }))
        .send({ decision: 'suspend' })
        .expect(200);

      expect(res.body.sessionsRevoked).toBe(1);
      const [row] = await db.select().from(refreshTokens);
      expect(row!.revokedReason).toBe('kyc_suspend');
    });

    it('a rejection requires a reason', async () => {
      const admin = await seedAdmin(db, { subRole: 'operations' });
      const driverId = await seedDriver(db);

      await request(app.getHttpServer())
        .post(`/v1/admin/drivers/${driverId}/kyc`)
        .set('Authorization', await adminAuthHeaderFor(app, { adminId: admin.id }))
        .send({ decision: 'reject' })
        .expect(422);

      await request(app.getHttpServer())
        .post(`/v1/admin/drivers/${driverId}/kyc`)
        .set('Authorization', await adminAuthHeaderFor(app, { adminId: admin.id }))
        .send({ decision: 'reject', reason: 'Licence photo is unreadable' })
        .expect(200);

      const [driver] = await db.select().from(drivers).where(eq(drivers.id, driverId));
      expect(driver!.rejectionReason).toBe('Licence photo is unreadable');
      expect(driver!.approvedBy).toBeNull();
    });

    it('request_info kicks a pending driver back to incomplete with a reason (Phase 11)', async () => {
      const admin = await seedAdmin(db, { subRole: 'operations' });
      const driverId = await seedDriver(db, { kycStatus: 'pending' });

      await request(app.getHttpServer())
        .post(`/v1/admin/drivers/${driverId}/kyc`)
        .set('Authorization', await adminAuthHeaderFor(app, { adminId: admin.id }))
        .send({ decision: 'request_info' })
        .expect(422); // reason required, same as reject

      const res = await request(app.getHttpServer())
        .post(`/v1/admin/drivers/${driverId}/kyc`)
        .set('Authorization', await adminAuthHeaderFor(app, { adminId: admin.id }))
        .send({ decision: 'request_info', reason: 'Selfie does not match the licence photo' })
        .expect(200);
      expect(res.body.kycStatus).toBe('incomplete');

      const [driver] = await db.select().from(drivers).where(eq(drivers.id, driverId));
      expect(driver!.rejectionReason).toBe('Selfie does not match the licence photo');

      // Requested-info driver is no longer "awaiting a human" — it must leave the queue.
      const pending = await request(app.getHttpServer())
        .get('/v1/admin/drivers/pending')
        .set('Authorization', await adminAuthHeaderFor(app, { adminId: admin.id }))
        .expect(200);
      expect(pending.body.items.map((d: { id: string }) => d.id)).not.toContain(driverId);
    });
  });

  describe('GET /pending — the KYC queue', () => {
    it('lists only kyc_status=pending drivers, with real signed-GET thumbnail URLs, never an incomplete driver', async () => {
      const admin = await seedAdmin(db, { subRole: 'support' });
      const pendingId = await seedDriver(db, { kycStatus: 'pending', name: 'Pending Driver' });
      await seedDriver(db, { kycStatus: 'incomplete', name: 'Incomplete Driver' });
      await seedDriver(db, { kycStatus: 'approved', name: 'Approved Driver' });
      const docId = await insertDocument(pendingId);

      const res = await request(app.getHttpServer())
        .get('/v1/admin/drivers/pending')
        .set('Authorization', await adminAuthHeaderFor(app, { adminId: admin.id, subRole: 'support' }))
        .expect(200);

      expect(res.body.items).toHaveLength(1);
      expect(res.body.items[0]).toMatchObject({ id: pendingId, name: 'Pending Driver' });
      expect(res.body.items[0].documents).toHaveLength(1);
      expect(res.body.items[0].documents[0]).toMatchObject({ id: docId, docType: 'license' });
      expect(res.body.items[0].documents[0].thumbnailUrl).toMatch(/^http.+\/v1\/files\/.+sig=/);
    });

    it('support can read the queue', async () => {
      const support = await seedAdmin(db, { subRole: 'support' });
      await request(app.getHttpServer())
        .get('/v1/admin/drivers/pending')
        .set('Authorization', await adminAuthHeaderFor(app, { adminId: support.id, subRole: 'support' }))
        .expect(200);
    });

    it('finance cannot read the queue', async () => {
      const finance = await seedAdmin(db, { subRole: 'finance' });
      await request(app.getHttpServer())
        .get('/v1/admin/drivers/pending')
        .set('Authorization', await adminAuthHeaderFor(app, { adminId: finance.id, subRole: 'finance' }))
        .expect(403);
    });
  });

  describe('POST /:id/documents/:docId/review — per-document (new in Phase 11)', () => {
    it('approving a document sets verifiedBy/verifiedAt and audits driver.document.approve', async () => {
      const admin = await seedAdmin(db, { subRole: 'operations' });
      const driverId = await seedDriver(db, { kycStatus: 'pending' });
      const docId = await insertDocument(driverId);

      const res = await request(app.getHttpServer())
        .post(`/v1/admin/drivers/${driverId}/documents/${docId}/review`)
        .set('Authorization', await adminAuthHeaderFor(app, { adminId: admin.id }))
        .send({ decision: 'approve' })
        .expect(200);
      expect(res.body).toMatchObject({ documentId: docId, status: 'approved', rejectionReason: null });

      const [doc] = await db.select().from(driverDocuments).where(eq(driverDocuments.id, docId));
      expect(doc!.verifiedBy).toBe(admin.id);
      expect(doc!.verifiedAt).not.toBeNull();

      const [action] = await db.select().from(adminActions);
      expect(action!.action).toBe('driver.document.approve');
      expect(action!.subjectType).toBe('driver_document');
    });

    it('rejecting a document requires a reason and stores it per-document', async () => {
      const admin = await seedAdmin(db, { subRole: 'operations' });
      const driverId = await seedDriver(db, { kycStatus: 'pending' });
      const docId = await insertDocument(driverId);

      await request(app.getHttpServer())
        .post(`/v1/admin/drivers/${driverId}/documents/${docId}/review`)
        .set('Authorization', await adminAuthHeaderFor(app, { adminId: admin.id }))
        .send({ decision: 'reject' })
        .expect(422);

      await request(app.getHttpServer())
        .post(`/v1/admin/drivers/${driverId}/documents/${docId}/review`)
        .set('Authorization', await adminAuthHeaderFor(app, { adminId: admin.id }))
        .send({ decision: 'reject', reason: 'Blurry photo' })
        .expect(200);

      const [doc] = await db.select().from(driverDocuments).where(eq(driverDocuments.id, docId));
      expect(doc!.status).toBe('rejected');
      expect(doc!.rejectionReason).toBe('Blurry photo');
    });

    it('404s a document that belongs to a different driver (path/body consistency)', async () => {
      const admin = await seedAdmin(db, { subRole: 'operations' });
      const driverId = await seedDriver(db, { kycStatus: 'pending' });
      const otherDriverId = await seedDriver(db, { kycStatus: 'pending' });
      const docId = await insertDocument(otherDriverId);

      await request(app.getHttpServer())
        .post(`/v1/admin/drivers/${driverId}/documents/${docId}/review`)
        .set('Authorization', await adminAuthHeaderFor(app, { adminId: admin.id }))
        .send({ decision: 'approve' })
        .expect(404);
    });

    it('a support admin cannot review a document', async () => {
      const support = await seedAdmin(db, { subRole: 'support' });
      const driverId = await seedDriver(db, { kycStatus: 'pending' });
      const docId = await insertDocument(driverId);

      await request(app.getHttpServer())
        .post(`/v1/admin/drivers/${driverId}/documents/${docId}/review`)
        .set('Authorization', await adminAuthHeaderFor(app, { adminId: support.id, subRole: 'support' }))
        .send({ decision: 'approve' })
        .expect(403);
    });
  });

  describe('PUT /:id/capabilities — §3.2 Band C opt-in', () => {
    it('an admin can revoke the long-distance opt-in and it takes effect on the driver side', async () => {
      const admin = await seedAdmin(db, { subRole: 'operations' });
      const driverId = await seedDriver(db, { kycStatus: 'approved', vehicleClass: 'flatbed' });
      await db.update(drivers).set({ longDistanceEnabled: true }).where(eq(drivers.id, driverId));

      const res = await request(app.getHttpServer())
        .put(`/v1/admin/drivers/${driverId}/capabilities`)
        .set('Authorization', await adminAuthHeaderFor(app, { adminId: admin.id }))
        .send({ longDistanceEnabled: false })
        .expect(200);
      expect(res.body).toEqual({ vehicleClass: 'flatbed', longDistanceEnabled: false, services: [] });

      const driverAuth = await driverAuthHeaderFor(app, { driverId, kycStatus: 'approved' });
      const status = await request(app.getHttpServer())
        .get('/v1/driver/kyc/status')
        .set('Authorization', driverAuth)
        .expect(200);
      expect(status.body.kycStatus).toBe('approved');

      const [driver] = await db.select().from(drivers).where(eq(drivers.id, driverId));
      expect(driver!.longDistanceEnabled).toBe(false);
    });

    it('writes an admin_actions row', async () => {
      const admin = await seedAdmin(db, { subRole: 'super_admin' });
      const driverId = await seedDriver(db, { kycStatus: 'approved' });

      await request(app.getHttpServer())
        .put(`/v1/admin/drivers/${driverId}/capabilities`)
        .set('Authorization', await adminAuthHeaderFor(app, { adminId: admin.id, subRole: 'super_admin' }))
        .send({ vehicleClass: 'wheel_lift' })
        .expect(200);

      const [action] = await db.select().from(adminActions);
      expect(action!.action).toBe('driver.capabilities.update');
      expect(action!.subjectId).toBe(driverId);
    });
  });
});
