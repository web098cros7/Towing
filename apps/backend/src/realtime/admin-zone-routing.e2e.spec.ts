import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import {
  ADMIN_NAMESPACE,
  ADMIN_REALTIME_EVENT,
  adminLocationUpdateSchema,
} from '@towing/api-contracts';
import { io, type Socket } from 'socket.io-client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DRIVER_LOCATION_CHANNEL } from '../redis/redis.constants';
import { createRealtimeTestApp } from '../test/app';
import { seedAdmin, setupTestDatabase, truncateAll } from '../test/db';
import { closeTestRedis, flushTestRedis, testRedis } from '../test/redis';
import { WsTicketService } from './ws-ticket.service';

/**
 * W4 — the zone filter as a room join that REDUCES what the socket sends.
 *
 * The property under test is exactly-once delivery across the split: zone
 * groups go to `admin:zone:{id}` rooms only, and the full batch goes to
 * `admin:ops` minus the filtering sockets. So a filtered operator receives
 * their zones' positions once and nothing else, an unfiltered operator
 * receives everything once, and clearing the filter puts a socket back in the
 * full stream. Null-zone pings belong to no zone and reach only the broadcast.
 */
describe('admin zone-filtered location routing (W4)', () => {
  let app: INestApplication;
  let url: string;
  let adminId: string;
  let db: Awaited<ReturnType<typeof setupTestDatabase>>;
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
    await flushTestRedis();
  });

  afterAll(async () => {
    await app.close();
    await closeTestRedis();
  });

  // -------------------------------------------------------------------------
  // helpers
  // -------------------------------------------------------------------------
  async function connect(): Promise<Socket> {
    const ticket = await app
      .get(WsTicketService)
      .issue({ realm: 'admin', subjectId: adminId, subRole: 'operations' });
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

  function subscribe(socket: Socket, zoneIds: string[]): Promise<{ ok: boolean }> {
    return new Promise((resolve) => socket.emit('ops:subscribe', { zoneIds }, resolve));
  }

  function tracked(socket: Socket): { ids: string[] } {
    const ids: string[] = [];
    socket.on(ADMIN_REALTIME_EVENT.LOCATION_UPDATE, (raw: unknown) => {
      const parsed = adminLocationUpdateSchema.safeParse(raw);
      if (parsed.success) for (const position of parsed.data.positions) ids.push(position.driverId);
    });
    return { ids };
  }

  async function publishPing(driverId: string, zoneId: string | null): Promise<void> {
    await testRedis().publish(
      DRIVER_LOCATION_CHANNEL,
      JSON.stringify({
        driverId,
        zoneId,
        fleetId: null,
        lat: 12.9716,
        lng: 77.5946,
        headingDeg: 90,
        speedKph: 30,
        accuracyM: 7,
        lowAccuracy: false,
        seq: 1,
        at: new Date().toISOString(),
      }),
    );
  }

  /** Polls until `condition` holds — the flush is on a 1 s tick, not instant. */
  async function waitFor(condition: () => boolean, timeoutMs = 5_000): Promise<void> {
    const started = Date.now();
    while (!condition() && Date.now() - started < timeoutMs) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
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

  // -------------------------------------------------------------------------
  // tests
  // -------------------------------------------------------------------------
  it('gives a zone-filtered socket only its zone, exactly once; the unfiltered one gets every ping', async () => {
    const zoneA = randomUUID();
    const zoneB = randomUUID();
    const driverA = randomUUID();
    const driverB = randomUUID();

    const unfiltered = await connect();
    const filtered = await connect();
    const unfilteredTracker = tracked(unfiltered);
    const filteredTracker = tracked(filtered);

    const ack = await subscribe(filtered, [zoneA]);
    expect(ack).toEqual({ ok: true });

    await publishPing(driverA, zoneA);
    await publishPing(driverB, zoneB);

    await waitFor(
      () => unfilteredTracker.ids.length >= 2 && filteredTracker.ids.length >= 1,
    );

    expect(sorted(unfilteredTracker.ids)).toEqual(sorted([driverA, driverB]));
    // Zone B's ping is NOT pushed to a zone A filter, and zone A's ping arrives
    // exactly once despite the socket also being in `admin:ops`.
    expect(filteredTracker.ids).toEqual([driverA]);
  });

  it('delivers each zone once to a socket filtering two zones', async () => {
    const zoneA = randomUUID();
    const zoneB = randomUUID();
    const driverA = randomUUID();
    const driverB = randomUUID();

    const multi = await connect();
    const tracker = tracked(multi);
    expect(await subscribe(multi, [zoneA, zoneB])).toEqual({ ok: true });

    await publishPing(driverA, zoneA);
    await publishPing(driverB, zoneB);

    await waitFor(() => tracker.ids.length >= 2);
    expect(sorted(tracker.ids)).toEqual(sorted([driverA, driverB]));
  });

  it('puts the socket back in the full stream when the filter is cleared', async () => {
    const zoneA = randomUUID();
    const zoneB = randomUUID();
    const driverB = randomUUID();

    const socket = await connect();
    const tracker = tracked(socket);

    expect(await subscribe(socket, [zoneA])).toEqual({ ok: true });
    await publishPing(randomUUID(), zoneA);
    await waitFor(() => tracker.ids.length >= 1);
    const before = tracker.ids.length;

    // Clearing: an empty subscribe leaves the zone rooms AND the filtered set.
    expect(await subscribe(socket, [])).toEqual({ ok: true });
    await publishPing(driverB, zoneB);

    await waitFor(() => tracker.ids.includes(driverB));
    expect(tracker.ids.slice(before)).toEqual([driverB]);
  });
});

function sorted(values: string[]): string[] {
  return [...values].sort();
}
