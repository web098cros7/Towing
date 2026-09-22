import type { INestApplication } from '@nestjs/common';
import {
  ADMIN_NOTE_SUBJECT_TYPES,
  adminNotesResponseSchema,
  adminNoteSchema,
} from '@towing/api-contracts';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { adminActions, adminNotes } from '../../db/schema';
import {
  adminAuthHeaderFor,
  authHeaderFor,
  createTestApp,
  customerAuthHeaderFor,
  driverAuthHeaderFor,
} from '../../test/app';
import { expectMatchesContract } from '../../test/contracts';
import {
  seedAdmin,
  seedCustomer,
  seedDriver,
  seedFleet,
  setupTestDatabase,
  truncateAll,
  type TestDatabase,
} from '../../test/db';
import { closeTestRedis, flushTestRedis } from '../../test/redis';

const DRIVER_SUBJECT = '44444444-4444-4444-8444-444444444444';
const PAYOUT_SUBJECT = '55555555-5555-4555-8555-555555555555';

/**
 * W21 (§9.4.4) — admin notes.
 *
 * Three things this spec is responsible for, in order of importance:
 *
 *  1. Every write lands an `admin_actions` row (rule 5).
 *  2. Visibility follows the SUBJECT, not the route — the same map the audit
 *     viewer uses, so a screen's notes panel and its timeline cannot disagree.
 *  3. Notes never leak: a source-text guard (the `sole-writer.spec.ts` pattern)
 *     plus runtime checks that fleet, driver and customer payloads do not
 *     carry a note body. The guard is the load-bearing half — Drizzle selects
 *     columns explicitly, so the realistic leak is a future screen SELECTing
 *     the table, which the guard catches in the same commit.
 */
describe('admin notes (/v1/admin/notes, W21)', () => {
  let app: INestApplication;
  let db: TestDatabase;
  let superAuth: string;
  let opsAuth: string;
  let supportAuth: string;
  let financeAuth: string;
  let opsId: string;

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

    const superAdmin = await seedAdmin(db, { subRole: 'super_admin' });
    const ops = await seedAdmin(db, { subRole: 'operations' });
    const support = await seedAdmin(db, { subRole: 'support' });
    const finance = await seedAdmin(db, { subRole: 'finance' });
    opsId = ops.id;

    superAuth = await adminAuthHeaderFor(app, { adminId: superAdmin.id, subRole: 'super_admin' });
    opsAuth = await adminAuthHeaderFor(app, { adminId: ops.id, subRole: 'operations' });
    supportAuth = await adminAuthHeaderFor(app, { adminId: support.id, subRole: 'support' });
    financeAuth = await adminAuthHeaderFor(app, { adminId: finance.id, subRole: 'finance' });
  });

  async function createNote(auth: string, body: object, expected = 200) {
    const res = await request(app.getHttpServer())
      .post('/v1/admin/notes')
      .set('Authorization', auth)
      .send(body)
      .expect(expected);
    return res.body;
  }

  it('creates a note, lists it back, and audits the write', async () => {
    const created = await createNote(opsAuth, {
      subjectType: 'driver',
      subjectId: DRIVER_SUBJECT,
      body: 'Called the driver — licence photo is being retaken.',
      pinned: true,
    });

    expectMatchesContract(adminNoteSchema, created);
    expect(created.pinned).toBe(true);

    const list = await request(app.getHttpServer())
      .get('/v1/admin/notes')
      .query({ subjectType: 'driver', subjectId: DRIVER_SUBJECT })
      .set('Authorization', opsAuth)
      .expect(200);

    const parsed = expectMatchesContract(adminNotesResponseSchema, list.body);
    expect(parsed.notes).toHaveLength(1);
    expect(parsed.notes[0]!.id).toBe(created.id);

    const audits = await db
      .select()
      .from(adminActions)
      .where(eq(adminActions.action, 'admin.note.create'));
    expect(audits).toHaveLength(1);
    expect(audits[0]!.adminId).toBe(opsId);
    expect(audits[0]!.subjectType).toBe('driver');
    expect(audits[0]!.subjectId).toBe(DRIVER_SUBJECT);
    expect(audits[0]!.after).toMatchObject({ body: created.body, pinned: true });
    // The audit row must not pretend the note itself is the subject's payload.
    expect(audits[0]!.before).toBeNull();
  });

  it('sorts pinned notes first, then newest', async () => {
    await createNote(opsAuth, { subjectType: 'driver', subjectId: DRIVER_SUBJECT, body: 'first' });
    await createNote(opsAuth, { subjectType: 'driver', subjectId: DRIVER_SUBJECT, body: 'second' });
    await createNote(opsAuth, {
      subjectType: 'driver',
      subjectId: DRIVER_SUBJECT,
      body: 'pinned last',
      pinned: true,
    });

    const list = await request(app.getHttpServer())
      .get('/v1/admin/notes')
      .query({ subjectType: 'driver', subjectId: DRIVER_SUBJECT })
      .set('Authorization', opsAuth)
      .expect(200);

    expect(list.body.notes.map((note: { body: string }) => note.body)).toEqual([
      'pinned last',
      'second',
      'first',
    ]);
  });

  it('lets the author edit and delete; anyone who may read can read', async () => {
    const created = await createNote(opsAuth, {
      subjectType: 'driver',
      subjectId: DRIVER_SUBJECT,
      body: 'original',
    });

    // Support reads it — same subject map as the audit viewer (`user.read`).
    const supportList = await request(app.getHttpServer())
      .get('/v1/admin/notes')
      .query({ subjectType: 'driver', subjectId: DRIVER_SUBJECT })
      .set('Authorization', supportAuth)
      .expect(200);
    expect(supportList.body.notes).toHaveLength(1);

    // …but support cannot EDIT someone else's note.
    await request(app.getHttpServer())
      .put(`/v1/admin/notes/${created.id}`)
      .set('Authorization', supportAuth)
      .send({ body: 'hijacked' })
      .expect(403);

    // The author can.
    const updated = await request(app.getHttpServer())
      .put(`/v1/admin/notes/${created.id}`)
      .set('Authorization', opsAuth)
      .send({ body: 'edited', pinned: true })
      .expect(200);
    expect(updated.body.body).toBe('edited');
    expect(updated.body.pinned).toBe(true);

    const audits = await db
      .select()
      .from(adminActions)
      .where(eq(adminActions.action, 'admin.note.update'));
    expect(audits).toHaveLength(1);
    expect(audits[0]!.before).toMatchObject({ body: 'original' });
    expect(audits[0]!.after).toMatchObject({ body: 'edited' });

    // Super admin may edit anyone's note.
    await request(app.getHttpServer())
      .put(`/v1/admin/notes/${created.id}`)
      .set('Authorization', superAuth)
      .send({ body: 'superadmin edit' })
      .expect(200);

    // Delete is SOFT: the row survives for the trail, the list stops showing it.
    await request(app.getHttpServer())
      .delete(`/v1/admin/notes/${created.id}`)
      .set('Authorization', opsAuth)
      .expect(204);

    const [row] = await db.select().from(adminNotes).where(eq(adminNotes.id, created.id));
    expect(row!.deletedAt).not.toBeNull();

    // Every write leaves a trace — the delete included, with the body it
    // retired and no pretend success payload after it.
    const deleteAudits = await db
      .select()
      .from(adminActions)
      .where(eq(adminActions.action, 'admin.note.delete'));
    expect(deleteAudits).toHaveLength(1);
    expect(deleteAudits[0]!.adminId).toBe(opsId);
    expect(deleteAudits[0]!.subjectType).toBe('driver');
    expect(deleteAudits[0]!.subjectId).toBe(DRIVER_SUBJECT);
    expect(deleteAudits[0]!.before).toMatchObject({ noteId: created.id, body: 'superadmin edit' });
    expect(deleteAudits[0]!.after).toBeNull();

    const after = await request(app.getHttpServer())
      .get('/v1/admin/notes')
      .query({ subjectType: 'driver', subjectId: DRIVER_SUBJECT })
      .set('Authorization', opsAuth)
      .expect(200);
    expect(after.body.notes).toEqual([]);

    // Editing a deleted note is a 404, not an edit of a ghost.
    await request(app.getHttpServer())
      .put(`/v1/admin/notes/${created.id}`)
      .set('Authorization', opsAuth)
      .send({ body: 'zombie' })
      .expect(404);
  });

  it('gates notes by the subject’s read permission, not the route', async () => {
    // Ops holds no `finance.read`: payout notes are closed to it.
    await createNote(
      opsAuth,
      { subjectType: 'payout', subjectId: PAYOUT_SUBJECT, body: 'nope' },
      403,
    );

    // Finance holds it.
    await createNote(financeAuth, {
      subjectType: 'payout',
      subjectId: PAYOUT_SUBJECT,
      body: 'Payout held pending bank verification.',
    });

    // Support holds no `finance.read`, so it cannot even READ them.
    await request(app.getHttpServer())
      .get('/v1/admin/notes')
      .query({ subjectType: 'payout', subjectId: PAYOUT_SUBJECT })
      .set('Authorization', supportAuth)
      .expect(403);

    // Super admin sees everything.
    const superList = await request(app.getHttpServer())
      .get('/v1/admin/notes')
      .query({ subjectType: 'payout', subjectId: PAYOUT_SUBJECT })
      .set('Authorization', superAuth)
      .expect(200);
    expect(superList.body.notes).toHaveLength(1);
  });

  it('attaches to every subject type the union admits', async () => {
    const subjectIds = new Map(ADMIN_NOTE_SUBJECT_TYPES.map((type) => [type, randomUUID()]));

    for (const subjectType of ADMIN_NOTE_SUBJECT_TYPES) {
      const created = await createNote(superAuth, {
        subjectType,
        subjectId: subjectIds.get(subjectType),
        body: `note on ${subjectType}`,
      });
      const parsed = expectMatchesContract(adminNoteSchema, created);
      expect(parsed.subjectType).toBe(subjectType);
    }

    const audits = await db
      .select()
      .from(adminActions)
      .where(eq(adminActions.action, 'admin.note.create'));
    expect(audits).toHaveLength(ADMIN_NOTE_SUBJECT_TYPES.length);

    // Each subject reads back on its own: one note each, nothing bleeding
    // into a neighbouring subject's panel.
    for (const subjectType of ADMIN_NOTE_SUBJECT_TYPES) {
      const list = await request(app.getHttpServer())
        .get('/v1/admin/notes')
        .query({ subjectType, subjectId: subjectIds.get(subjectType) })
        .set('Authorization', superAuth)
        .expect(200);
      const parsed = expectMatchesContract(adminNotesResponseSchema, list.body);
      expect(parsed.notes).toHaveLength(1);
      expect(parsed.notes[0]!.subjectId).toBe(subjectIds.get(subjectType));
    }
  });

  it('never leaks a note into a fleet, driver or customer payload', async () => {
    const fleet = await seedFleet(db, 'Notes Fleet');
    const driverId = await seedDriver(db, { fleetId: fleet.fleetId, name: 'Note Subject' });
    const customerId = await seedCustomer(db);

    const driverSecret = 'internal-only-driver-marker';
    const customerSecret = 'internal-only-customer-marker';
    await createNote(opsAuth, {
      subjectType: 'driver',
      subjectId: driverId,
      body: `${driverSecret} — do not show this to the fleet owner`,
    });
    await createNote(opsAuth, {
      subjectType: 'user',
      subjectId: customerId,
      body: `${customerSecret} — internal only`,
    });

    // Fleet payload: the fleet owner's view of the driver.
    const fleetAuth = await authHeaderFor(app, {
      userId: fleet.ownerId,
      fleetId: fleet.fleetId,
    });
    const fleetRes = await request(app.getHttpServer())
      .get('/v1/fleet/drivers')
      .set('Authorization', fleetAuth)
      .expect(200);
    expect(JSON.stringify(fleetRes.body)).not.toContain(driverSecret);

    // Driver payload: the driver's own KYC view.
    const driverRes = await request(app.getHttpServer())
      .get('/v1/driver/kyc/status')
      .set('Authorization', await driverAuthHeaderFor(app, { driverId }))
      .expect(200);
    expect(JSON.stringify(driverRes.body)).not.toContain(driverSecret);

    // Customer payload: the customer's own profile.
    const meRes = await request(app.getHttpServer())
      .get('/v1/me')
      .set('Authorization', await customerAuthHeaderFor(app, { userId: customerId }))
      .expect(200);
    expect(JSON.stringify(meRes.body)).not.toContain(customerSecret);
  });

  it('is reachable only by admin-realm tokens', async () => {
    const fleet = await seedFleet(db, 'Notes Fleet');
    const fleetAuth = await authHeaderFor(app, {
      userId: fleet.ownerId,
      fleetId: fleet.fleetId,
    });

    await request(app.getHttpServer())
      .get('/v1/admin/notes')
      .query({ subjectType: 'driver', subjectId: DRIVER_SUBJECT })
      .set('Authorization', fleetAuth)
      .expect(403);

    await request(app.getHttpServer())
      .get('/v1/admin/notes')
      .query({ subjectType: 'driver', subjectId: DRIVER_SUBJECT })
      .expect(401);
  });
  describe('source guard: notes are read and written only by the notes module', () => {
    const SRC = resolve(__dirname, '../..');
    // Specs are excluded for the same reason `sole-writer.spec.ts` excludes
    // them: this file must build starting states the runtime would not.
    const ALLOWED = ['db/schema/admin.ts', 'modules/admin-notes/admin-notes.service.ts'];

    function sourceFiles(): string[] {
      const out: string[] = [];
      const walk = (dir: string): void => {
        for (const entry of readdirSync(dir)) {
          const full = join(dir, entry);
          if (statSync(full).isDirectory()) {
            if (entry === 'node_modules' || entry === 'dist') continue;
            walk(full);
            continue;
          }
          if (entry.endsWith('.ts') && !entry.endsWith('.spec.ts')) out.push(full);
        }
      };
      walk(SRC);
      return out;
    }

    it('no other runtime file references the admin_notes table', () => {
      const rel = (file: string) => relative(SRC, file).split(sep).join('/');
      const offenders = sourceFiles()
        .filter((file) => !ALLOWED.includes(rel(file)))
        // `\b` on both sides: `adminNotesQuerySchema` and `AdminNotesService`
        // are contract/DI names, not the table binding — only the bare
        // identifier `adminNotes` (the drizzle export) can SELECT or write it.
        .filter((file) => /\badminNotes\b/.test(readFileSync(file, 'utf8')))
        .map(rel);

      expect(
        offenders,
        'Notes are internal-only (W21): touching `admin_notes` outside the notes module is how a note ' +
          'ends up in a customer, driver or fleet payload. Route the read through AdminNotesService.',
      ).toEqual([]);
    });

    it('the allowlist has no stale entries', () => {
      const rel = (file: string) => relative(SRC, file).split(sep).join('/');
      const existing = new Set(sourceFiles().map(rel));
      expect(ALLOWED.filter((entry) => !existing.has(entry))).toEqual([]);
    });
  });
});
