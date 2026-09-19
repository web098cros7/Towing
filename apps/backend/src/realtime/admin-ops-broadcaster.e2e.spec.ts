import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import {
  ADMIN_NAMESPACE,
  ADMIN_REALTIME_EVENT,
  adminBookingStatusSchema,
  adminOpsBadgesEventSchema,
  adminOpsDashboardResponseSchema,
  adminOpsMetricsEventSchema,
} from '@towing/api-contracts';
import request from 'supertest';
import { io, type Socket } from 'socket.io-client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { OPS_EVENTS_CHANNEL, adminOpsActivityKey } from '../redis/redis.constants';
import { adminAuthHeaderFor, createRealtimeTestApp } from '../test/app';
import { seedAdmin, seedDriver, setupTestDatabase, truncateAll } from '../test/db';
import { closeTestRedis, flushTestRedis, testRedis } from '../test/redis';
import { WsTicketService } from './ws-ticket.service';

/**
 * W3's metrics/badge broadcaster (§3.4) — the push half of the dashboard.
 *
 * The REST endpoint's exactness is asserted in
 * `admin-ops-dashboard.e2e.spec.ts`; this file asserts the other half of the
 * contract: a domain event on `ops:events` makes the broadcaster publish valid
 * `ops_metrics`/`ops_badges` payloads that reach a connected admin socket, and
 * the bridge appends each domain event to the activity list exactly once.
 * The last test pins the property the whole design exists for: the pushed
 * payload and the REST response cannot disagree, because both come from one
 * service behind one cache.
 */
describe('admin ops broadcaster (W3)', () => {
  let app: INestApplication;
  let url: string;
  let db: Awaited<ReturnType<typeof setupTestDatabase>>;
  let adminId: string;
  let open: Socket[] = [];

  beforeAll(async () => {
    db = await setupTestDatabase();
    await truncateAll();
    await flushTestRedis();
    ({ app, url } = await createRealtimeTestApp());

    const admin = await seedAdmin(db, { subRole: 'operations' });
    adminId = admin.id;
  });

  afterEach(async () => {
    await closeAll();
  });

  afterAll(async () => {
    await app.close();
    await closeTestRedis();
  });

  function connectWith(ticket: string): Promise<Socket> {
    return new Promise((resolve, reject) => {
      const socket = io(`${url}${ADMIN_NAMESPACE}`, {
        auth: { ticket },
        transports: ['websocket'],
        reconnection: false,
        timeout: 5_000,
      });
      open.push(socket);
      socket.on('connect', () => resolve(socket));
      socket.on('connect_error', (err) => {
        socket.close();
        reject(err);
      });
    });
  }

  async function issueAdminTicket(): Promise<string> {
    return app.get(WsTicketService).issue({ realm: 'admin', subjectId: adminId, subRole: 'operations' });
  }

  /** The first well-formed frame, or a rejection — this suite never hangs. */
  function nextFrame<T>(
    socket: Socket,
    event: string,
    parse: { safeParse: (value: unknown) => { success: true; data: T } | { success: false } },
    timeoutMs = 5_000,
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`no ${event} frame within ${timeoutMs}ms`)), timeoutMs);
      socket.once(event, (payload: unknown) => {
        const parsed = parse.safeParse(payload);
        clearTimeout(timer);
        if (parsed.success) resolve(parsed.data);
        else reject(new Error(`${event} frame did not match its contract`));
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
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  /** A `booking_created` envelope exactly as the booking path publishes it. */
  function createdEnvelope(bookingId = randomUUID()): Record<string, unknown> {
    return {
      kind: 'booking_created',
      bookingId,
      zoneId: randomUUID(),
      userId: randomUUID(),
      status: 'searching',
      scheduledAt: null,
      at: new Date().toISOString(),
    };
  }

  it('pushes ops:metrics, ops:badges and the creation frame after a domain event', async () => {
    const socket = await connectWith(await issueAdminTicket());

    const creation = nextFrame(socket, ADMIN_REALTIME_EVENT.BOOKING_STATUS, adminBookingStatusSchema);
    // The payload arrives after the broadcaster's debounce window — give it
    // the debounce plus compute time, not the default frame timeout.
    const metrics = nextFrame(socket, ADMIN_REALTIME_EVENT.OPS_METRICS, adminOpsMetricsEventSchema, 12_000);
    const badges = nextFrame(socket, ADMIN_REALTIME_EVENT.OPS_BADGES, adminOpsBadgesEventSchema, 12_000);

    const event = createdEnvelope();
    await testRedis().publish(OPS_EVENTS_CHANNEL, JSON.stringify(event));

    // Creation is not a transition, but it does announce `searching` — the
    // frame the map and feed learn about a new booking from.
    const creationFrame = await creation;
    expect(creationFrame.bookingId).toBe(event.bookingId);
    expect(creationFrame.status).toBe('searching');

    const metricsFrame = await metrics;
    expect(typeof metricsFrame.kpis.pendingKyc).toBe('number');
    expect(typeof metricsFrame.at).toBe('string');

    const badgesFrame = await badges;
    expect(typeof badgesFrame.badges.pendingKyc).toBe('number');
  });

  it('appends each domain event to the activity list exactly once', async () => {
    await connectWith(await issueAdminTicket());

    const event = createdEnvelope();
    // The same message delivered to N nodes must yield ONE row — that is what
    // the NX marker is for. Two identical publishes is the same test in one
    // process.
    await testRedis().publish(OPS_EVENTS_CHANNEL, JSON.stringify(event));
    await testRedis().publish(OPS_EVENTS_CHANNEL, JSON.stringify(event));

    const moved = {
      kind: 'booking_status',
      bookingId: randomUUID(),
      from: 'searching',
      to: 'cancelled',
      zoneId: null,
      driverId: null,
      userId: randomUUID(),
      fleetId: null,
      at: new Date().toISOString(),
    };
    await testRedis().publish(OPS_EVENTS_CHANNEL, JSON.stringify(moved));

    await new Promise((resolve) => setTimeout(resolve, 600));

    const raw = await testRedis().lrange(adminOpsActivityKey, 0, -1);
    const items = raw.map((entry) => JSON.parse(entry) as Record<string, unknown>);
    const created = items.filter((item) => item.bookingId === event.bookingId);
    expect(created).toHaveLength(1);
    expect(created[0]!.kind).toBe('booking_created');
    expect(created[0]!.status).toBe('searching');
    expect(items.filter((item) => item.bookingId === moved.bookingId)).toHaveLength(1);
  });

  it('makes the pushed KPIs identical to what REST serves', async () => {
    // One pending driver so the numbers are non-trivial on both paths.
    await seedDriver(db, { kycStatus: 'pending' });

    const socket = await connectWith(await issueAdminTicket());
    const metrics = nextFrame(socket, ADMIN_REALTIME_EVENT.OPS_METRICS, adminOpsMetricsEventSchema, 12_000);

    await testRedis().publish(OPS_EVENTS_CHANNEL, JSON.stringify(createdEnvelope()));
    const frame = await metrics;

    const res = await request(app.getHttpServer())
      .get('/v1/admin/ops/dashboard')
      .set(
        'Authorization',
        await adminAuthHeaderFor(app, { adminId, subRole: 'operations' }),
      )
      .expect(200);

    const body = adminOpsDashboardResponseSchema.parse(res.body);
    expect(body.kpis).toEqual(frame.kpis);
  });
});
