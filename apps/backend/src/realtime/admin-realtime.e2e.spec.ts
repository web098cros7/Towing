import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import {
  ADMIN_NAMESPACE,
  ADMIN_REALTIME_EVENT,
  FLEET_NAMESPACE,
  adminBookingStatusSchema,
  adminLocationUpdateSchema,
  adminReadyEventSchema,
  type AdminReadyEvent,
} from '@towing/api-contracts';
import request from 'supertest';
import { io, type Socket } from 'socket.io-client';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { adminAuthHeaderFor, authHeaderFor, createRealtimeTestApp, wsTicketFor } from '../test/app';
import { seedAdmin, seedFleet, setupTestDatabase, truncateAll } from '../test/db';
import { closeTestRedis, flushTestRedis, testRedis } from '../test/redis';
import {
  ADMIN_REVOKE_CHANNEL,
  DRIVER_LOCATION_CHANNEL,
  OPS_EVENTS_CHANNEL,
} from '../redis/redis.constants';
import { AdminGateway } from './admin.gateway';
import { WsTicketService } from './ws-ticket.service';

/**
 * W1 §3.4 — the `/admin` socket realm.
 *
 * The exit gate's two claims are asserted here as end-to-end facts: a driver
 * ping reaches an admin socket (under the 2 s §11.1 budget), and every booking
 * status change does too, regardless of fleet. Realm isolation is asserted in
 * both directions — a fleet ticket must not open `/admin`, an admin ticket must
 * not open `/fleet` — because that check is the only thing keeping four realms
 * on one socket.io server from bleeding into each other.
 */
describe('admin realtime (/v1/admin/realtime/ticket, §3.4)', () => {
  let app: INestApplication;
  let url: string;
  let db: Awaited<ReturnType<typeof setupTestDatabase>>;
  let open: Socket[] = [];
  let adminId: string;

  beforeAll(async () => {
    db = await setupTestDatabase();
    await truncateAll();
    await flushTestRedis();
    ({ app, url } = await createRealtimeTestApp());

    const admin = await seedAdmin(db, { subRole: 'support' });
    adminId = admin.id;
  });

  afterEach(async () => {
    await closeAll();
  });

  afterAll(async () => {
    await app.close();
    await closeTestRedis();
  });

  /**
   * Resolves on `connect`, rejects on `connect_error` — never hangs the suite.
   * The ready listener is attached BEFORE connecting: the server emits it from
   * `handleConnection`, so a listener added after `connect` races the packet.
   */
  function connectWith(
    namespace: string,
    auth: Record<string, unknown>,
  ): Promise<{ socket: Socket; ready: Promise<unknown> }> {
    return new Promise((resolve, reject) => {
      const socket = io(`${url}${namespace}`, {
        auth,
        transports: ['websocket'],
        reconnection: false,
        timeout: 5_000,
      });
      open.push(socket);

      const ready = new Promise((resolveReady) => {
        socket.on(ADMIN_REALTIME_EVENT.READY, resolveReady);
      });

      socket.on('connect', () => resolve({ socket, ready }));
      socket.on('connect_error', (err) => {
        socket.close();
        reject(err);
      });
    });
  }

  async function issueAdminTicket(): Promise<string> {
    return app.get(WsTicketService).issue({ realm: 'admin', subjectId: adminId, subRole: 'support' });
  }

  /** The first well-formed frame, or a rejection — this suite never hangs. */
  function nextFrame<T>(
    socket: Socket,
    event: string,
    parse: { safeParse: (value: unknown) => { success: true; data: T } | { success: false } },
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`no ${event} frame within 2.5s`)), 2_500);
      socket.once(event, (payload: unknown) => {
        const parsed = parse.safeParse(payload);
        clearTimeout(timer);
        if (parsed.success) resolve(parsed.data);
        else reject(new Error(`${event} frame did not match its contract`));
      });
    });
  }

  async function waitDisconnect(socket: Socket): Promise<void> {
    if (!socket.connected) return;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('socket did not disconnect within 2.5s')), 2_500);
      socket.on('disconnect', () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  async function closeAll(): Promise<void> {
    const sockets = open;
    open = [];
    await Promise.all(
      sockets.map(
        (socket) =>
          new Promise<void>((resolve) => {
            if (!socket.connected) {
              socket.close();
              resolve();
              return;
            }
            socket.on('disconnect', () => resolve());
            socket.close();
          }),
      ),
    );
    // The server observes a close on its own tick; room-size assertions in the
    // next test would otherwise read a count that is about to change.
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  it('mints a ticket for every admin sub-role, and closes to other realms', async () => {
    const adminAuth = await adminAuthHeaderFor(app, { adminId, subRole: 'support' });
    const res = await request(app.getHttpServer())
      .post('/v1/admin/realtime/ticket')
      .set('Authorization', adminAuth)
      .expect(200);
    expect(res.body.namespace).toBe(ADMIN_NAMESPACE);
    expect(typeof res.body.ticket).toBe('string');

    const fleet = await seedFleet(db, 'Realtime Fleet');
    const fleetAuth = await authHeaderFor(app, { userId: fleet.ownerId, fleetId: fleet.fleetId });
    await request(app.getHttpServer())
      .post('/v1/admin/realtime/ticket')
      .set('Authorization', fleetAuth)
      .expect(403);

    await request(app.getHttpServer()).post('/v1/admin/realtime/ticket').expect(401);
  });

  it('refuses a fleet ticket on /admin — and an admin ticket on /fleet', async () => {
    // Tickets are SINGLE-USE (GETDEL): the refused attempt redeems the value,
    // so proving "it still works in its own realm" needs a second ticket.
    const fleetTicket = await wsTicketFor(app, { userId: randomUUID(), fleetId: randomUUID() });
    const fleetTicketAgain = await wsTicketFor(app, { userId: randomUUID(), fleetId: randomUUID() });

    await expect(connectWith(ADMIN_NAMESPACE, { ticket: fleetTicket })).rejects.toThrow();
    await connectWith(FLEET_NAMESPACE, { ticket: fleetTicketAgain });

    const adminTicket = await issueAdminTicket();
    await expect(connectWith(FLEET_NAMESPACE, { ticket: adminTicket })).rejects.toThrow();
  });

  it('accepts an admin ticket, joins admin:ops, and announces readiness', async () => {
    const ticket = await issueAdminTicket();
    const { ready } = await connectWith(ADMIN_NAMESPACE, { ticket });

    const parsed = adminReadyEventSchema.parse(await ready) as AdminReadyEvent;
    expect(parsed.adminId).toBe(adminId);
    expect(parsed.subRole).toBe('support');

    const gateway = app.get(AdminGateway);
    expect(gateway.localOpsSize()).toBeGreaterThanOrEqual(1);
  });

  it('delivers a driver ping to an admin socket within the 2 s budget (§11.1)', async () => {
    const ticket = await issueAdminTicket();
    const { socket } = await connectWith(ADMIN_NAMESPACE, { ticket });

    const driverId = randomUUID();
    const framePromise = nextFrame(socket, ADMIN_REALTIME_EVENT.LOCATION_UPDATE, adminLocationUpdateSchema);

    const startedAt = Date.now();
    await testRedis().publish(
      DRIVER_LOCATION_CHANNEL,
      JSON.stringify({
        driverId,
        zoneId: randomUUID(),
        fleetId: null,
        lat: 12.9716,
        lng: 77.5946,
        headingDeg: 92,
        speedKph: 31,
        accuracyM: 7,
        lowAccuracy: false,
        seq: 1,
        at: new Date().toISOString(),
      }),
    );

    const frame = await framePromise;
    const position = frame.positions.find((entry) => entry.driverId === driverId);
    expect(position).toBeDefined();
    expect(Date.now() - startedAt).toBeLessThan(2_000);
  });

  it('delivers every booking status change regardless of fleet', async () => {
    const ticket = await issueAdminTicket();
    const { socket } = await connectWith(ADMIN_NAMESPACE, { ticket });

    const bookingId = randomUUID();
    const framePromise = nextFrame(socket, ADMIN_REALTIME_EVENT.BOOKING_STATUS, adminBookingStatusSchema);

    await testRedis().publish(
      OPS_EVENTS_CHANNEL,
      JSON.stringify({
        kind: 'booking_status',
        bookingId,
        from: 'searching',
        to: 'assigned',
        zoneId: randomUUID(),
        driverId: null,
        userId: randomUUID(),
        // A real fleet id: the platform feed is the point — the tenant-scoped
        // channel could not carry this.
        fleetId: randomUUID(),
        at: new Date().toISOString(),
      }),
    );

    const frame = await framePromise;
    expect(frame.bookingId).toBe(bookingId);
    expect(frame.status).toBe('assigned');
  });

  it('drops an admin’s sockets when admin:revoke fires — W2’s demote/deactivate hook', async () => {
    const ticket = await issueAdminTicket();
    const { socket } = await connectWith(ADMIN_NAMESPACE, { ticket });
    expect(socket.connected).toBe(true);

    await testRedis().publish(
      ADMIN_REVOKE_CHANNEL,
      JSON.stringify({ adminId, reason: 'deactivated', at: new Date().toISOString() }),
    );

    await waitDisconnect(socket);
    expect(socket.connected).toBe(false);
  });

  it('joins filter rooms via ops:subscribe, delivers ONE copy via the union, and acks a bad payload', async () => {
    const ticket = await issueAdminTicket();
    const { socket } = await connectWith(ADMIN_NAMESPACE, { ticket });

    const zoneId = randomUUID();
    const ack = await new Promise<{ ok: boolean }>((resolve) => {
      socket.emit('ops:subscribe', { zoneIds: [zoneId] }, resolve);
    });
    expect(ack).toEqual({ ok: true });

    let received = 0;
    socket.on(ADMIN_REALTIME_EVENT.BOOKING_STATUS, () => {
      received += 1;
    });

    await testRedis().publish(
      OPS_EVENTS_CHANNEL,
      JSON.stringify({
        kind: 'booking_status',
        bookingId: randomUUID(),
        from: 'assigned',
        to: 'en_route',
        zoneId,
        driverId: randomUUID(),
        userId: randomUUID(),
        fleetId: null,
        at: new Date().toISOString(),
      }),
    );

    // The socket is in `admin:ops` AND `admin:zone:{zoneId}`; chained `.to()` is
    // a union, so the correct count is exactly one.
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(received).toBe(1);

    const badAck = await new Promise<{ ok: boolean }>((resolve) => {
      socket.emit('ops:subscribe', { zoneIds: ['not-a-uuid'] }, resolve);
    });
    expect(badAck).toEqual({ ok: false });
  });
});
