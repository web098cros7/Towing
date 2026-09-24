import type { INestApplication } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { devices } from '../../db/schema/devices';
import {
  notificationDeliveries,
  notificationEvents,
  notifications,
} from '../../db/schema/notifications';
import { drivers } from '../../db/schema/drivers';
import { fleets } from '../../db/schema/fleets';
import { createTestApp } from '../../test/app';
import {
  seedDriver,
  seedFleet,
  setupTestDatabase,
  truncateAll,
  type TestDatabase,
} from '../../test/db';
import { DeviceRegistryService } from './device-registry.service';
import { NotificationDispatcherService } from './notification-dispatcher.service';
import { NotificationService } from './notification.service';
import { LogPushAdapter, LogSmsAdapter, LogWhatsAppAdapter } from './channels/log-channel.adapter';

let app: INestApplication;
let db: TestDatabase;
let emitter: NotificationService;
let dispatcher: NotificationDispatcherService;
let registry: DeviceRegistryService;
let logPush: LogPushAdapter;
let logSms: LogSmsAdapter;
let logWhatsApp: LogWhatsAppAdapter;

/**
 * The whole spine against fakes.
 *
 * ⚠ THE SUITE RUNS WITH `QUEUE_ENABLED=false` (`src/test/setup.ts`), which is
 * not an accident to work around — it is the most important thing these tests
 * prove. `bullmq.adapter.ts` logs and DROPS every enqueue in that mode, so the
 * in-app notification rows have to already exist by the time `emit()` returns,
 * or the bell is empty in every test run and in every zero-credential demo.
 * That is invariant 74, and it is why `fanout()` is driven by hand here.
 */
beforeAll(async () => {
  db = await setupTestDatabase();
  app = await createTestApp();
  emitter = app.get(NotificationService);
  dispatcher = app.get(NotificationDispatcherService);
  registry = app.get(DeviceRegistryService);
  logPush = app.get(LogPushAdapter);
  logSms = app.get(LogSmsAdapter);
  logWhatsApp = app.get(LogWhatsAppAdapter);
});

afterAll(async () => {
  await app.close();
});

beforeEach(async () => {
  await truncateAll();
  logPush.clear();
  logSms.clear();
  logWhatsApp.clear();
});

async function registerDevice(driverId: string, installationId: string, token: string) {
  await registry.register('driver', driverId, {
    installationId,
    pushToken: token,
    platform: 'android',
  });
}

async function emitKycApproved(driverId: string, auditId = crypto.randomUUID()) {
  return emitter.emit('driver.kyc.approved', {
    driverId,
    driverName: 'Test Driver',
    reason: null,
    auditId,
  });
}

describe('notification spine', () => {
  it('writes the event and the in-app row in one transaction, before any delivery', async () => {
    const driverId = await seedDriver(db, { name: 'Ravi' });

    const eventId = await emitKycApproved(driverId);
    expect(eventId).not.toBeNull();

    const events = await db.select().from(notificationEvents);
    expect(events).toHaveLength(1);
    // NOT yet fanned out — no worker has run.
    expect(events[0]!.fannedOutAt).toBeNull();

    const inbox = await db.select().from(notifications);
    expect(inbox).toHaveLength(1);
    expect(inbox[0]!.subjectType).toBe('driver');
    expect(inbox[0]!.subjectId).toBe(driverId);
    expect(inbox[0]!.category).toBe('transactional');
    expect(inbox[0]!.readAt).toBeNull();
    expect(inbox[0]!.body).toContain('start earning');

    // The bell exists with zero deliveries attempted. That is the point.
    expect(await db.select().from(notificationDeliveries)).toHaveLength(0);
  });

  it('carries the push discriminator both halves of the acceptance chain agree on', async () => {
    const driverId = await seedDriver(db);
    await emitKycApproved(driverId);

    const [row] = await db.select().from(notifications);

    // `event` is THE discriminator. The mobile handler switches on exactly this
    // field; if the two sides ever disagree, the push arrives, nothing
    // refetches, and the bug is invisible without a device in hand.
    expect(row!.data.event).toBe('driver.kyc.approved');
    expect(row!.data.action).toBe('refetch');
    expect(row!.data.invalidate).toBe('kyc');
    expect(row!.data.route).toBe('mitowdriver://kyc');
    // The inbox row's OWN id, so a tap marks exactly this row read.
    expect(row!.data.notificationId).toBe(row!.id);
  });

  it('fans out one push per device and one SMS per recipient', async () => {
    const driverId = await seedDriver(db);
    await registerDevice(driverId, 'install-phone', 'ExponentPushToken[phone]');
    await registerDevice(driverId, 'install-tablet', 'ExponentPushToken[tablet]');

    const eventId = await emitKycApproved(driverId);
    await dispatcher.fanout(eventId!);

    const rows = await db.select().from(notificationDeliveries);
    const push = rows.filter((r) => r.channel === 'push');
    const sms = rows.filter((r) => r.channel === 'sms');

    // Two devices, two pushes. This is the entire reason `devices` is a table
    // rather than a column on `drivers` — a single unique index without the
    // device dimension would silently drop every device after the first.
    expect(push).toHaveLength(2);
    expect(new Set(push.map((r) => r.deviceId)).size).toBe(2);
    expect(sms).toHaveLength(1);
  });

  it('masks the address at rest and hands the raw one only to the adapter', async () => {
    const driverId = await seedDriver(db);
    await registerDevice(driverId, 'install-phone', 'ExponentPushToken[abcdefghijklmnop]');

    const eventId = await emitKycApproved(driverId);
    await dispatcher.fanout(eventId!);

    const [push] = await db
      .select()
      .from(notificationDeliveries)
      .where(eq(notificationDeliveries.channel, 'push'));

    // `notification_deliveries` has no retention purge until Phase 20, and a
    // push token is a live delivery capability rather than an identifier.
    expect(push!.destination).not.toContain('abcdefghijklmnop');
    expect(push!.destination).toContain('…');
  });

  it('skips with a reason rather than failing when there is nothing to deliver to', async () => {
    // No devices registered, and `seedDriver` leaves email null.
    const driverId = await seedDriver(db);
    const eventId = await emitKycApproved(driverId);
    await dispatcher.fanout(eventId!);

    const rows = await db.select().from(notificationDeliveries);
    const push = rows.find((r) => r.channel === 'push');

    expect(push!.status).toBe('skipped');
    expect(push!.skipReason).toBe('no_push_target');
    // A skipped row has no address, which is exactly why `destination` is
    // nullable with a paired CHECK rather than NOT NULL.
    expect(push!.destination).toBeNull();
  });

  it('delivers through the log adapter and records the vendor', async () => {
    const driverId = await seedDriver(db);
    await registerDevice(driverId, 'install-phone', 'ExponentPushToken[phone]');

    const eventId = await emitKycApproved(driverId);
    await dispatcher.fanout(eventId!);

    const queued = await db
      .select()
      .from(notificationDeliveries)
      .where(eq(notificationDeliveries.status, 'queued'));

    for (const row of queued) {
      await dispatcher.deliver(row.channel, row.id);
    }

    const sent = await db
      .select()
      .from(notificationDeliveries)
      .where(eq(notificationDeliveries.status, 'sent'));

    expect(sent.length).toBe(queued.length);
    expect(sent.every((r) => r.vendor === 'log')).toBe(true);
    expect(logPush.sent).toHaveLength(1);
    expect(logSms.sent).toHaveLength(1);
    expect(logWhatsApp.sent).toHaveLength(1);
    // The adapter gets the RAW token; only the row is masked.
    expect(logPush.sent[0]!.to).toBe('ExponentPushToken[phone]');
  });

  it('never makes a second vendor call for a redelivered job', async () => {
    const driverId = await seedDriver(db);
    await registerDevice(driverId, 'install-phone', 'ExponentPushToken[phone]');

    const eventId = await emitKycApproved(driverId);
    await dispatcher.fanout(eventId!);

    const [push] = await db
      .select()
      .from(notificationDeliveries)
      .where(eq(notificationDeliveries.channel, 'push'));

    await dispatcher.deliver('push', push!.id);
    await dispatcher.deliver('push', push!.id);

    // BullMQ is at-least-once. The unique indexes protect the TABLE from
    // duplicate rows; only the compare-and-set in `deliver()` protects the
    // person's phone from a second notification.
    expect(logPush.sent).toHaveLength(1);
  });

  it('collapses a double-submitted decision by its audit id', async () => {
    const driverId = await seedDriver(db);
    const auditId = crypto.randomUUID();

    const first = await emitKycApproved(driverId, auditId);
    const second = await emitKycApproved(driverId, auditId);

    expect(first).not.toBeNull();
    // Keyed on the audit row id rather than a per-call timestamp: two rapid
    // clicks produce two distinct `new Date()`s, so a timestamp key would
    // dedupe nothing while looking like it does.
    expect(second).toBeNull();
    expect(await db.select().from(notificationEvents)).toHaveLength(1);
    expect(await db.select().from(notifications)).toHaveLength(1);
  });

  it('re-enqueues nothing twice but repairs a stranded event on sweep', async () => {
    const driverId = await seedDriver(db);
    const eventId = await emitKycApproved(driverId);

    await dispatcher.fanout(eventId!);
    const [event] = await db.select().from(notificationEvents);
    expect(event!.fannedOutAt).not.toBeNull();

    // A second fan-out is a no-op — the guard is what stops a retried job
    // duplicating every delivery row.
    const before = (await db.select().from(notificationDeliveries)).length;
    await dispatcher.fanout(eventId!);
    expect((await db.select().from(notificationDeliveries)).length).toBe(before);
  });

  it('resolves a fleet recipient through its owner, not through a raw id', async () => {
    const { fleetId, ownerId } = await seedFleet(db, 'Bengaluru Towing');

    const eventId = await emitter.emit('compliance.doc_expiring', {
      fleetId,
      docType: 'Insurance',
      plate: 'KA01AB1234',
      daysLeft: 30,
    });
    await dispatcher.fanout(eventId!);

    const rows = await db.select().from(notificationDeliveries);
    const email = rows.find((r) => r.channel === 'email');

    // Before Phase 13 this passed `target.fleetId` — a UUID — straight into a
    // field documented as an address. It printed fine against the log adapter
    // and would have 400'd on every send the moment SES bound.
    expect(email).toBeDefined();
    expect(email!.destination ?? '').not.toContain(fleetId);
    expect(ownerId).toBeTruthy();

    const [inbox] = await db.select().from(notifications);
    expect(inbox!.subjectType).toBe('fleet');
    expect(inbox!.subjectId).toBe(fleetId);
  });
});

describe('notification preferences', () => {
  it('cannot suppress an always-on transactional row', async () => {
    const driverId = await seedDriver(db);
    await db
      .update(drivers)
      .set({ notificationPrefs: { promotions: false, weeklySummary: false } })
      .where(eq(drivers.id, driverId));

    const eventId = await emitKycApproved(driverId);
    await dispatcher.fanout(eventId!);

    const rows = await db.select().from(notificationDeliveries);
    // §12.3: a user opt-out must never be able to suppress a KYC decision, a
    // payout failure or (from Phase 20) an SOS.
    expect(rows.some((r) => r.skipReason === 'suppressed_by_pref')).toBe(false);
  });

  it("honours the fleet console's shipped payouts toggle", async () => {
    const { fleetId } = await seedFleet(db, 'Opted Out Towing');
    await db
      .update(fleets)
      .set({ notificationPrefs: { payouts: false } })
      .where(eq(fleets.id, fleetId));

    const eventId = await emitter.emit('payout.processed', {
      payoutId: crypto.randomUUID(),
      ownerType: 'fleet',
      ownerId: fleetId,
      amount: '1000.00',
      reference: 'pout_test',
      reason: null,
    });
    await dispatcher.fanout(eventId!);

    const rows = await db.select().from(notificationDeliveries);
    // That switch has been visible and flippable in the console since Phase 7.
    // Declaring the payout row always-on would have left it wired to nothing.
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.skipReason === 'suppressed_by_pref')).toBe(true);
  });

  it('still writes the inbox row for a suppressed notification', async () => {
    const { fleetId } = await seedFleet(db, 'Silent Towing');
    await db
      .update(fleets)
      .set({ notificationPrefs: { payouts: false } })
      .where(eq(fleets.id, fleetId));

    const eventId = await emitter.emit('payout.failed', {
      payoutId: crypto.randomUUID(),
      ownerType: 'fleet',
      ownerId: fleetId,
      amount: '1000.00',
      reference: null,
      reason: 'Bank rejected',
    });
    await dispatcher.fanout(eventId!);

    // Opting out of being *pushed at* is not opting out of being able to read
    // what happened. Invariant 74 again: the bell is not a delivery receipt.
    expect(await db.select().from(notifications)).toHaveLength(1);
  });
});

describe('the §9.4.3 acceptance chain, server half', () => {
  it('an approval emits a push job aimed at the driver’s registered device', async () => {
    const driverId = await seedDriver(db, { kycStatus: 'pending', name: 'Asha' });
    // Registered while still PENDING — which is the whole point: the approval
    // push has to arrive on a handset that registered before approval.
    await registerDevice(driverId, 'install-phone', 'ExponentPushToken[asha]');

    const eventId = await emitKycApproved(driverId);
    await dispatcher.fanout(eventId!);

    const [push] = await db
      .select()
      .from(notificationDeliveries)
      .where(
        and(
          eq(notificationDeliveries.channel, 'push'),
          eq(notificationDeliveries.status, 'queued'),
        ),
      );

    expect(push).toBeDefined();

    await dispatcher.deliver('push', push!.id);

    const sentPush = logPush.sent[0]!;
    expect(sentPush.to).toBe('ExponentPushToken[asha]');
    // What the driver app switches on to invalidate its KYC query and flip the
    // online toggle without a manual refetch.
    expect(sentPush.data.event).toBe('driver.kyc.approved');
    expect(sentPush.data.action).toBe('refetch');
    expect(sentPush.data.invalidate).toBe('kyc');

    const [device] = await db.select().from(devices).where(eq(devices.subjectId, driverId));
    // Approval does NOT revoke the session or the device — `revokesAuthority`
    // in `admin-drivers.service.ts` covers only `suspended` and `rejected`, so
    // the driver is still signed in and can act on the push in place.
    expect(device!.revokedAt).toBeNull();
  });
});
