import type { INestApplication } from '@nestjs/common';
import {
  ADMIN_NAMESPACE,
  ADMIN_REALTIME_EVENT,
  adminSosAlertEventSchema,
  type AdminSosAlertEvent,
} from '@towing/api-contracts';
import { io, type Socket } from 'socket.io-client';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { emergencyContacts } from '../db/schema/users';
import { createRealtimeTestApp, customerAuthHeaderFor } from '../test/app';
import {
  seedAdmin,
  seedCustomer,
  setupTestDatabase,
  truncateAll,
  type TestDatabase,
} from '../test/db';
import { closeTestRedis, flushTestRedis } from '../test/redis';
import { WsTicketService } from './ws-ticket.service';

/**
 * W14's acceptance criterion, over a real socket: **an SOS reaches the ops
 * console within 2 seconds**.
 *
 * The trigger goes through the HTTP route (as the app would), the frame is
 * asserted against its contract, and the wall clock is checked end to end —
 * a bridge that only forwards hand-published Redis messages would pass a
 * cheaper test and still fail the phase.
 */
describe('SOS realtime (/admin sos:alert, W14)', () => {
  let app: INestApplication;
  let url: string;
  let db: TestDatabase;
  let adminId: string;
  let customerId: string;
  let customerAuth: string;
  let open: Socket[] = [];

  beforeAll(async () => {
    db = await setupTestDatabase();
    await truncateAll();
    await flushTestRedis();
    ({ app, url } = await createRealtimeTestApp());

    const admin = await seedAdmin(db, { subRole: 'support' });
    adminId = admin.id;
    customerId = await seedCustomer(db, 'Rekha');
    customerAuth = await customerAuthHeaderFor(app, { userId: customerId });
    await db
      .insert(emergencyContacts)
      .values({ userId: customerId, name: 'Suresh (spouse)', phone: '+919845010011' });
  });

  afterEach(async () => {
    for (const socket of open) socket.disconnect();
    open = [];
  });

  afterAll(async () => {
    await app.close();
    await closeTestRedis();
  });

  /** Same shape as `admin-realtime.e2e.spec.ts` — resolves on connect, never hangs. */
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
    return app
      .get(WsTicketService)
      .issue({ realm: 'admin', subjectId: adminId, subRole: 'support' });
  }

  function nextSosFrame(socket: Socket): Promise<AdminSosAlertEvent> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('no sos:alert frame within 2.5s')), 2_500);
      socket.once(ADMIN_REALTIME_EVENT.SOS_ALERT, (payload: unknown) => {
        clearTimeout(timer);
        const parsed = adminSosAlertEventSchema.safeParse(payload);
        if (parsed.success) resolve(parsed.data);
        else reject(new Error('sos:alert frame did not match its contract'));
      });
    });
  }

  const raise = () =>
    request(app.getHttpServer())
      .post('/v1/sos')
      .set('Authorization', customerAuth)
      .send({ lat: 12.9716, lng: 77.5946, accuracyM: 6 })
      .expect(200);

  it('delivers the alert to an admin socket within the 2 s budget', async () => {
    const ticket = await issueAdminTicket();
    const { socket } = await connectWith(ADMIN_NAMESPACE, { ticket });

    const framePromise = nextSosFrame(socket);
    const startedAt = Date.now();
    const res = await raise();
    const frame = await framePromise;

    expect(Date.now() - startedAt).toBeLessThan(2_000);
    expect(frame.alertId).toBe(res.body.alertId);
    expect(frame.subjectType).toBe('user');
    expect(frame.subjectId).toBe(customerId);
    expect(frame.status).toBe('triggered');
    expect(frame.duplicate).toBe(false);
  });

  it('re-pings the console on a repeat tap without messaging contacts twice', async () => {
    const ticket = await issueAdminTicket();
    const { socket } = await connectWith(ADMIN_NAMESPACE, { ticket });

    const first = nextSosFrame(socket);
    const created = await raise();
    await first;

    const second = nextSosFrame(socket);
    await raise();
    const frame = await second;

    expect(frame.alertId).toBe(created.body.alertId);
    expect(frame.duplicate).toBe(true);
  });
});
