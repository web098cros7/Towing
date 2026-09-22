import type { INestApplication } from '@nestjs/common';
import {
  adminSosDetailSchema,
  adminSosResponseSchema,
  sosCreateResponseSchema,
  type AdminSosCreateBody,
} from '@towing/api-contracts';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { KillSwitchService } from '../../common/killswitch/killswitch.service';
import { RecipientResolverService } from '../../common/notifications/recipient-resolver.service';
import { TRIGGERS_BY_EVENT } from '../../common/notifications/registry/triggers';
import { PreferenceService } from '../../common/notifications/preference.service';
import { adminActions, adminUsers, notificationEvents, users } from '../../db/schema';
import { sosAlertContacts, sosAlertEvents, sosAlerts } from '../../db/schema/sos';
import { emergencyContacts } from '../../db/schema/users';
import {
  adminAuthHeaderFor,
  customerAuthHeaderFor,
  createTestApp,
  driverAuthHeaderFor,
} from '../../test/app';
import { expectMatchesContract } from '../../test/contracts';
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
import {
  PICKUP,
  seedDispatchConfig,
  seedOnlineDriver,
  seedZone,
} from '../dispatch/dispatch-fixtures';

/**
 * W14 — SOS (§13), backend.
 *
 * The phase's acceptance criterion ("an alert reaches the ops console within
 * 2 s and its whole life is reconstructable") is split: the 2-second half is
 * asserted over a real socket in `sos-realtime.e2e.spec.ts`; THIS spec owns the
 * reconstructability half — the contact SNAPSHOT, the timeline, the audits, the
 * one-open-alert rule, the cancel window, idempotent acknowledge, the ops-raised
 * path, the broadcast, and the preference rule that makes an SOS unsuppressible.
 */
describe('SOS (/v1/sos + /v1/admin/sos, W14)', () => {
  let app: INestApplication;
  let db: TestDatabase;
  let killSwitch: KillSwitchService;

  let customerId: string;
  let customerAuth: string;
  let driverId: string;
  let driverAuth: string;
  let opsId: string;
  let opsAuth: string;
  let supportAuth: string;
  let financeAuth: string;

  const ALERT_POINT = { lat: 12.9716, lng: 77.5946, accuracyM: 8 };

  beforeAll(async () => {
    db = await setupTestDatabase();
    app = await createTestApp();
    killSwitch = app.get(KillSwitchService);
  });

  afterAll(async () => {
    await app.close();
    await closeTestRedis();
  });

  beforeEach(async () => {
    await truncateAll();
    await flushTestRedis();
    await killSwitch.setSosStandaloneDisabled(false);

    customerId = await seedCustomer(db, 'Meera Nair');
    customerAuth = await customerAuthHeaderFor(app, { userId: customerId });
    await db.insert(emergencyContacts).values([
      { userId: customerId, name: 'Arun (spouse)', phone: '+919845010001', relation: 'spouse' },
      { userId: customerId, name: 'Divya (sister)', phone: '+919845010002', relation: 'sister' },
    ]);

    driverId = await seedDriver(db, { name: 'Kiran' });
    driverAuth = await driverAuthHeaderFor(app, { driverId });

    const ops = await seedAdmin(db, { subRole: 'operations' });
    const support = await seedAdmin(db, { subRole: 'support' });
    const finance = await seedAdmin(db, { subRole: 'finance' });
    opsId = ops.id;
    opsAuth = await adminAuthHeaderFor(app, { adminId: ops.id, subRole: 'operations' });
    supportAuth = await adminAuthHeaderFor(app, { adminId: support.id, subRole: 'support' });
    financeAuth = await adminAuthHeaderFor(app, { adminId: finance.id, subRole: 'finance' });
  });

  const raise = (auth: string, body: Record<string, unknown> = ALERT_POINT, expected = 200) =>
    request(app.getHttpServer())
      .post('/v1/sos')
      .set('Authorization', auth)
      .send(body)
      .expect(expected);

  const raiseOk = async (auth: string, body: Record<string, unknown> = ALERT_POINT) => {
    const res = await raise(auth, body);
    return expectMatchesContract(sosCreateResponseSchema, res.body);
  };

  const queue = (auth: string, params: Record<string, unknown> = {}) =>
    request(app.getHttpServer()).get('/v1/admin/sos').set('Authorization', auth).query(params);

  const detail = (auth: string, id: string) =>
    request(app.getHttpServer()).get(`/v1/admin/sos/${id}`).set('Authorization', auth);

  // -------------------------------------------------------------------------
  // The trigger
  // -------------------------------------------------------------------------

  it('writes the alert, the contact SNAPSHOT and the opening timeline in one trigger', async () => {
    const created = await raiseOk(customerAuth);
    expect(created.replayed).toBe(false);
    expect(created.status).toBe('triggered');

    const [alert] = await db.select().from(sosAlerts).where(eq(sosAlerts.id, created.alertId));
    expect(alert!.subjectType).toBe('user');
    expect(alert!.subjectId).toBe(customerId);
    expect(alert!.source).toBe('app');

    const contacts = await db
      .select()
      .from(sosAlertContacts)
      .where(eq(sosAlertContacts.alertId, created.alertId));
    expect(contacts.map((row) => row.name).sort()).toEqual(['Arun (spouse)', 'Divya (sister)']);
    // The designed degradation, recorded where it mattered: neither channel can
    // actually send until DLT/WhatsApp registration lands, and the snapshot
    // says so per channel rather than implying the contact was reached.
    const channels = contacts[0]!.notifiedChannels as Array<{
      channel: string;
      ok: boolean;
      code: string | null;
    }>;
    expect(channels).toEqual([
      { channel: 'sms', ok: false, code: 'dlt_template_missing' },
      { channel: 'whatsapp', ok: false, code: 'wa_template_missing' },
    ]);

    const events = await db
      .select()
      .from(sosAlertEvents)
      .where(eq(sosAlertEvents.alertId, created.alertId));
    const kinds = events.map((row) => row.kind).sort();
    expect(kinds).toEqual(['contacts_notified', 'ops_alerted', 'triggered']);

    // Both fan-out events are registered and the ops alert has a real recipient
    // pool (the on-call admins), even with the queue disabled.
    const emitted = await db.select().from(notificationEvents);
    const eventNames = emitted.map((row) => row.event).sort();
    expect(eventNames).toEqual(['sos.ops_alert', 'sos.triggered']);
  });

  it('reaches the admins flagged for ops alerts, plus the mailbox (G17)', async () => {
    await db.update(adminUsers).set({ receivesOpsAlerts: true }).where(eq(adminUsers.id, opsId));

    const created = await raiseOk(customerAuth);

    const trigger = TRIGGERS_BY_EVENT.get('sos.ops_alert');
    expect(trigger).toBeDefined();
    const recipients = await trigger!.resolve(
      {
        alertId: created.alertId,
        subjectLabel: 'Meera Nair',
        lat: 12.9,
        lng: 77.5,
        opsEmail: 'ops@towing.local',
      } as never,
      { db, resolver: app.get(RecipientResolverService) },
    );

    const keys = recipients.map((recipient) => `${recipient.subjectType}:${recipient.subjectId}`);
    expect(keys).toContain(`ops:${opsId}`);
    // The synthetic mailbox never collides with a real admin id.
    expect(keys).toContain('ops:00000000-0000-0000-0000-000000000000');
  });

  it('links the live booking automatically and verifies an explicit booking id', async () => {
    const bookingId = await seedBooking(db, { userId: customerId, status: 'assigned' });

    const withoutBody = await raiseOk(customerAuth);
    const [alert] = await db.select().from(sosAlerts).where(eq(sosAlerts.id, withoutBody.alertId));
    expect(alert!.bookingId).toBe(bookingId);

    // Resolve it, then check the ownership rail on an explicit id.
    await request(app.getHttpServer())
      .post(`/v1/admin/sos/${withoutBody.alertId}/resolve`)
      .set('Authorization', opsAuth)
      .send({ resolution: 'Caller safe, emergency contact reached.' })
      .expect(200);

    const strangerId = await seedCustomer(db, 'Someone Else');
    const strangerBooking = await seedBooking(db, { userId: strangerId, status: 'assigned' });
    await raise(customerAuth, { ...ALERT_POINT, bookingId: strangerBooking }, 404);
  });

  it('folds a repeat tap into the open alert — recorded, re-published, never re-fanned-out', async () => {
    const first = await raiseOk(customerAuth);
    const second = await raiseOk(customerAuth, { ...ALERT_POINT, lat: 12.975 });

    expect(second.replayed).toBe(true);
    expect(second.alertId).toBe(first.alertId);

    const contacts = await db
      .select()
      .from(sosAlertContacts)
      .where(eq(sosAlertContacts.alertId, first.alertId));
    // The snapshot is NOT rewritten — still exactly the two original rows.
    expect(contacts).toHaveLength(2);

    const events = await db
      .select()
      .from(sosAlertEvents)
      .where(eq(sosAlertEvents.alertId, first.alertId));
    const triggered = events.filter((row) => row.kind === 'triggered');
    expect(triggered).toHaveLength(2);
    expect((triggered[1]!.data as { duplicate?: boolean }).duplicate).toBe(true);

    // One notification event per trigger — the dedupe key held.
    const emitted = await db.select().from(notificationEvents);
    expect(emitted).toHaveLength(2);
  });

  it('snapshots contacts as they were: editing them mid-incident changes nothing', async () => {
    const created = await raiseOk(customerAuth);

    await db.delete(emergencyContacts).where(eq(emergencyContacts.userId, customerId));
    await db.insert(emergencyContacts).values({
      userId: customerId,
      name: 'Someone New',
      phone: '+919845019999',
    });

    const contacts = await db
      .select()
      .from(sosAlertContacts)
      .where(eq(sosAlertContacts.alertId, created.alertId));
    expect(contacts.map((row) => row.name).sort()).toEqual(['Arun (spouse)', 'Divya (sister)']);
  });

  it('lets a driver raise an alert — ops-only, because drivers have no contact rows', async () => {
    const created = await raiseOk(driverAuth);
    const [alert] = await db.select().from(sosAlerts).where(eq(sosAlerts.id, created.alertId));
    expect(alert!.subjectType).toBe('driver');

    const contacts = await db
      .select()
      .from(sosAlertContacts)
      .where(eq(sosAlertContacts.alertId, created.alertId));
    expect(contacts).toHaveLength(0);

    const events = await db
      .select()
      .from(sosAlertEvents)
      .where(eq(sosAlertEvents.alertId, created.alertId));
    expect(events.map((row) => row.kind).sort()).toEqual(['ops_alerted', 'triggered']);
  });

  it('refuses a realm that is not a requester', async () => {
    await request(app.getHttpServer())
      .post('/v1/sos')
      .set('Authorization', opsAuth)
      .send(ALERT_POINT)
      .expect(403);
  });

  // -------------------------------------------------------------------------
  // The cancel window
  // -------------------------------------------------------------------------

  it('cancels inside the grace window, idempotently, and refuses a late cancel', async () => {
    const created = await raiseOk(customerAuth);

    await request(app.getHttpServer())
      .post(`/v1/sos/${created.alertId}/cancel`)
      .set('Authorization', customerAuth)
      .expect(200);

    const again = await request(app.getHttpServer())
      .post(`/v1/sos/${created.alertId}/cancel`)
      .set('Authorization', customerAuth)
      .expect(200);
    expect(again.body.status).toBe('cancelled');

    const events = await db
      .select()
      .from(sosAlertEvents)
      .where(eq(sosAlertEvents.alertId, created.alertId));
    expect(events.filter((row) => row.kind === 'cancelled')).toHaveLength(1);

    // A fresh alert, artificially aged past the grace window.
    const stale = await raiseOk(customerAuth);
    await db
      .update(sosAlerts)
      .set({ createdAt: new Date(Date.now() - 10 * 60_000) })
      .where(eq(sosAlerts.id, stale.alertId));

    const late = await request(app.getHttpServer())
      .post(`/v1/sos/${stale.alertId}/cancel`)
      .set('Authorization', customerAuth)
      .expect(409);
    expect(late.body.error.code).toBe('conflict');
    expect(late.body.error.details.code).toBe('sos_cancel_expired');
  });

  it('answers not-found for somebody else’s alert', async () => {
    const created = await raiseOk(customerAuth);
    const otherId = await seedCustomer(db, 'Other');
    const otherAuth = await customerAuthHeaderFor(app, { userId: otherId });

    await request(app.getHttpServer())
      .post(`/v1/sos/${created.alertId}/cancel`)
      .set('Authorization', otherAuth)
      .expect(404);
  });

  // -------------------------------------------------------------------------
  // The ops console rail
  // -------------------------------------------------------------------------

  it('queues open alerts with the ack-time KPI input and the resolved subject', async () => {
    const created = await raiseOk(customerAuth);

    const res = await queue(opsAuth, { open: true }).expect(200);
    const parsed = expectMatchesContract(adminSosResponseSchema, res.body);
    expect(parsed.total).toBe(1);
    const row = parsed.items[0]!;
    expect(row.id).toBe(created.alertId);
    expect(row.subjectName).toBe('Meera Nair');
    expect(row.ackSeconds).toBeNull();

    // Closed alerts leave the open tab but stay in the unfiltered queue.
    await request(app.getHttpServer())
      .post(`/v1/admin/sos/${created.alertId}/resolve`)
      .set('Authorization', opsAuth)
      .send({ resolution: 'False alarm — caller confirmed safe.' })
      .expect(200);

    const openAfter = await queue(opsAuth, { open: true }).expect(200);
    expect(openAfter.body.total).toBe(0);

    const all = await queue(opsAuth, { status: 'resolved' }).expect(200);
    expect(all.body.total).toBe(1);
  });

  it('acknowledges idempotently: one event, the first operator’s stamp', async () => {
    const created = await raiseOk(customerAuth);

    const first = await request(app.getHttpServer())
      .post(`/v1/admin/sos/${created.alertId}/acknowledge`)
      .set('Authorization', opsAuth)
      .expect(200);
    expect(first.body.status).toBe('acknowledged');

    const second = await request(app.getHttpServer())
      .post(`/v1/admin/sos/${created.alertId}/acknowledge`)
      .set('Authorization', supportAuth)
      .expect(200);
    expect(second.body.at).toBe(first.body.at);

    const events = await db
      .select()
      .from(sosAlertEvents)
      .where(eq(sosAlertEvents.alertId, created.alertId));
    expect(events.filter((row) => row.kind === 'acknowledged')).toHaveLength(1);

    const [alert] = await db.select().from(sosAlerts).where(eq(sosAlerts.id, created.alertId));
    expect(alert!.acknowledgedBy).toBe(opsId);
    expect(alert!.status).toBe('acknowledged');

    // Acknowledged alerts are no longer cancellable by the subject.
    await request(app.getHttpServer())
      .post(`/v1/sos/${created.alertId}/cancel`)
      .set('Authorization', customerAuth)
      .expect(409);
  });

  it('records note, contact and resolve on the timeline, each audited', async () => {
    const created = await raiseOk(customerAuth);

    await request(app.getHttpServer())
      .post(`/v1/admin/sos/${created.alertId}/note`)
      .set('Authorization', opsAuth)
      .send({ note: 'Calling the spouse now.' })
      .expect(200);

    const call = await request(app.getHttpServer())
      .post(`/v1/admin/sos/${created.alertId}/contact`)
      .set('Authorization', opsAuth)
      .send({})
      .expect(200);
    // No Exotel account exists: the fallback hands back the real number and
    // says it is not masked, which is the honest branch, not a bug.
    expect(call.body.dialNumber).toBe('+919845010001');
    expect(call.body.masked).toBe(false);

    await request(app.getHttpServer())
      .post(`/v1/admin/sos/${created.alertId}/resolve`)
      .set('Authorization', opsAuth)
      .send({ resolution: 'Reached her; police on site; closing.' })
      .expect(200);

    const res = await detail(opsAuth, created.alertId).expect(200);
    const parsed = expectMatchesContract(adminSosDetailSchema, res.body);
    expect(parsed.status).toBe('resolved');
    expect(parsed.resolution).toContain('police on site');
    expect(parsed.contacts).toHaveLength(2);
    expect(parsed.events.map((event) => event.kind)).toEqual([
      'triggered',
      'contacts_notified',
      'ops_alerted',
      'note',
      'contacted',
      'resolved',
    ]);
    // The timeline reads as people: the admin's name rides the event.
    const noted = parsed.events.find((event) => event.kind === 'note')!;
    expect(noted.actorName).toBe('Test Admin');

    const audits = await db
      .select()
      .from(adminActions)
      .where(eq(adminActions.subjectId, created.alertId));
    expect(audits.map((row) => row.action).sort()).toEqual([
      'sos.contact',
      'sos.note',
      'sos.resolve',
    ]);
  });

  it('lets an operator raise an alert from a phone call (source ops)', async () => {
    const body: AdminSosCreateBody = {
      subjectType: 'user',
      subjectId: customerId,
      lat: 12.98,
      lng: 77.6,
      note: 'Customer called — car in a ditch on Old Airport Road.',
    };

    const res = await request(app.getHttpServer())
      .post('/v1/admin/sos')
      .set('Authorization', opsAuth)
      .send(body)
      .expect(200);
    expect(res.body.replayed).toBe(false);

    const [alert] = await db.select().from(sosAlerts).where(eq(sosAlerts.id, res.body.alertId));
    expect(alert!.source).toBe('ops');

    const events = await db
      .select()
      .from(sosAlertEvents)
      .where(eq(sosAlertEvents.alertId, res.body.alertId));
    expect(events.find((row) => row.kind === 'triggered')!.actorType).toBe('admin');
    expect(events.find((row) => row.kind === 'note')!.note).toContain('ditch');

    const audits = await db
      .select()
      .from(adminActions)
      .where(eq(adminActions.action, 'sos.create'));
    expect(audits).toHaveLength(1);
  });

  it('falls back to the subject’s known position and refuses when there is none', async () => {
    await db
      .update(users)
      .set({ defaultLat: 12.955, defaultLng: 77.62 })
      .where(eq(users.id, customerId));

    const noCoords = await request(app.getHttpServer())
      .post('/v1/admin/sos')
      .set('Authorization', opsAuth)
      .send({ subjectType: 'user', subjectId: customerId })
      .expect(200);

    const [alert] = await db
      .select()
      .from(sosAlerts)
      .where(eq(sosAlerts.id, noCoords.body.alertId));
    expect(alert!.lat).toBeCloseTo(12.955);
    expect(alert!.lng).toBeCloseTo(77.62);

    // A customer with no saved pin and no explicit coordinates cannot be
    // placed, and guessing would be worse than asking.
    const bareId = await seedCustomer(db, 'No Pin');
    const refused = await request(app.getHttpServer())
      .post('/v1/admin/sos')
      .set('Authorization', opsAuth)
      .send({ subjectType: 'user', subjectId: bareId })
      .expect(422);
    expect(refused.body.error.details.code).toBe('sos_location_unknown');
  });

  it('broadcasts to the nearby online supply only when asked (G12)', async () => {
    const zoneId = await seedZone(db);
    await seedDispatchConfig(db);
    const nearOne = await seedOnlineDriver(db, { zoneId, metersAway: 300 });
    const nearTwo = await seedOnlineDriver(db, { zoneId, metersAway: 900 });
    await seedOnlineDriver(db, { zoneId, metersAway: 60_000 });

    const created = await raiseOk(customerAuth, {
      lat: PICKUP.lat,
      lng: PICKUP.lng,
      accuracyM: 5,
    });

    const res = await request(app.getHttpServer())
      .post(`/v1/admin/sos/${created.alertId}/broadcast`)
      .set('Authorization', opsAuth)
      .send({ radiusKm: 3 })
      .expect(200);
    expect(res.body.notified).toBe(2);

    const [event] = await db
      .select()
      .from(sosAlertEvents)
      .where(eq(sosAlertEvents.kind, 'broadcast'));
    const data = event!.data as { drivers: number; radiusKm: number };
    expect(data.drivers).toBe(2);
    expect(data.radiusKm).toBe(3);

    const emitted = await db
      .select()
      .from(notificationEvents)
      .where(eq(notificationEvents.event, 'sos.broadcast'));
    expect(emitted).toHaveLength(1);
    expect((emitted[0]!.payload as { driverIds: string[] }).driverIds.sort()).toEqual(
      [nearOne, nearTwo].sort(),
    );
  });

  // -------------------------------------------------------------------------
  // The two rules that make this a safety feature
  // -------------------------------------------------------------------------

  it('cannot be suppressed by notification preferences (§12.3)', async () => {
    await db
      .update(users)
      .set({ notificationPrefs: { promotions: false, weeklySummary: false } })
      .where(eq(users.id, customerId));

    const recipient = await app.get(RecipientResolverService).resolveUser(customerId);
    expect(recipient).not.toBeNull();

    const preferences = app.get(PreferenceService);
    // Both the contact fan-out and the ops alert are safety/always-on.
    expect(preferences.suppresses(recipient!, TRIGGERS_BY_EVENT.get('sos.triggered')!)).toBeNull();
    expect(preferences.suppresses(recipient!, TRIGGERS_BY_EVENT.get('sos.ops_alert')!)).toBeNull();
  });

  it('honours the standalone kill switch (G11) while leaving in-booking SOS working', async () => {
    await killSwitch.setSosStandaloneDisabled(true);

    const refused = await raise(customerAuth, ALERT_POINT, 422);
    expect(refused.body.error.details.code).toBe('sos_standalone_disabled');

    // In-booking SOS is untouched by the standalone switch — that is the point
    // of the decision, not an exception to it.
    const bookingId = await seedBooking(db, { userId: customerId, status: 'assigned' });
    await raiseOk(customerAuth, { ...ALERT_POINT, bookingId });

    // Released again: standalone works with no booking at all (the default).
    await killSwitch.setSosStandaloneDisabled(false);
    const second = await raiseOk(driverAuth);
    expect(second.replayed).toBe(false);
  });

  it('keeps finance out and lets support work the queue (§4.2)', async () => {
    await queue(financeAuth).expect(403);
    await queue(supportAuth).expect(200);
    await queue(opsAuth).expect(200);

    await request(app.getHttpServer())
      .get('/v1/admin/sos')
      .set('Authorization', customerAuth)
      .expect(403);

    const created = await raiseOk(customerAuth);
    await request(app.getHttpServer())
      .post(`/v1/admin/sos/${created.alertId}/acknowledge`)
      .set('Authorization', supportAuth)
      .expect(200);
  });
});
