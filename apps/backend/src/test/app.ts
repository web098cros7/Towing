import type { AddressInfo } from 'node:net';
import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { AppModule } from '../app.module';
import { RedisIoAdapter } from '../realtime/redis-io.adapter';
import { WsTicketService } from '../realtime/ws-ticket.service';

/**
 * Boots the FULL AppModule against the throwaway stack (setup.ts repoints
 * DATABASE_URL/REDIS_URL before anything loads env). Full-app on purpose: the
 * seams e2e suites care about — global prefix, error envelope, throttler,
 * idempotency, guards — only exist when the real module graph is assembled.
 */
export async function createTestApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

  // `rawBody` must match main.ts. Without it `req.rawBody` is undefined and the
  // webhook route cannot verify a signature — which surfaces as a baffling 401
  // in a spec that is sending a perfectly valid one.
  const app = moduleRef.createNestApplication({ logger: false, rawBody: true });
  // Lives in main.ts's bootstrap, not AppModule — easy to forget, and every
  // route silently 404s without it.
  app.setGlobalPrefix('v1');
  await app.init();
  return app;
}

export interface RealtimeTestApp {
  app: INestApplication;
  /** `http://127.0.0.1:<port>` — feed straight to `io(url + '/fleet')`. */
  url: string;
}

/**
 * Same full AppModule, but with the Socket.io transport installed and actually
 * LISTENING.
 *
 * `createTestApp()` calls only `init()`, so its io server is attached to a
 * server that never binds a port and no client can connect. Port 0 (not a fixed
 * one) because a crashed vitest run on Windows holds a fixed port for minutes,
 * and because the multi-instance spec boots two of these at once.
 */
export async function createRealtimeTestApp(): Promise<RealtimeTestApp> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

  const app = moduleRef.createNestApplication({ logger: false, rawBody: true });
  app.setGlobalPrefix('v1');
  // Order matters exactly as in main.ts: the adapter must be installed before
  // anything calls init().
  app.useWebSocketAdapter(new RedisIoAdapter(app));
  await app.listen(0, '127.0.0.1');

  const address = app.getHttpServer().address() as AddressInfo | string | null;
  if (address === null || typeof address === 'string') {
    throw new Error('realtime test app did not bind a TCP port');
  }

  return { app, url: `http://127.0.0.1:${address.port}` };
}

/**
 * Mints a handshake ticket without going through the HTTP route (and its
 * throttle bucket) — the socket equivalent of `authHeaderFor`.
 */
export async function wsTicketFor(
  app: INestApplication,
  params: { userId: string; fleetId: string },
): Promise<string> {
  return app.get(WsTicketService).issue({
    realm: 'fleet',
    subjectId: params.userId,
    fleetId: params.fleetId as never,
  });
}

/**
 * The `/driver` namespace's equivalent (Phase 16). A SIBLING, not a parameter on
 * the helper above, for the same reason `driverAuthHeaderFor` is a sibling of
 * `authHeaderFor`: the two realms carry different claims and collapsing them
 * into one signature makes it possible to mint a ticket with a tenant on the
 * driver side by accident.
 */
export async function driverWsTicketFor(
  app: INestApplication,
  driverId: string,
): Promise<string> {
  return app.get(WsTicketService).issue({ realm: 'driver', subjectId: driverId });
}

/**
 * A signed fleet access token, bypassing the login flow (and its 5/min auth
 * throttle bucket). Same JwtService + secret the guard verifies with.
 */
export async function authHeaderFor(
  app: INestApplication,
  params: { userId: string; fleetId: string },
): Promise<string> {
  const jwt = app.get(JwtService);
  const token = await jwt.signAsync({
    sub: params.userId,
    role: 'fleet_owner',
    fleet_id: params.fleetId,
  });
  return `Bearer ${token}`;
}

/**
 * The other three realms (Phase 10), deliberately as SIBLINGS of the helper
 * above rather than parameters on it: `authHeaderFor` has 74 call sites across
 * 20 spec files, and none of them should have had to change for this phase.
 *
 * Each mints exactly what `TokenService` mints for that realm, so a spec using
 * one is exercising the same claim shape a real login produces.
 */
export async function driverAuthHeaderFor(
  app: INestApplication,
  params: { driverId: string; kycStatus?: string; fleetId?: string },
): Promise<string> {
  const jwt = app.get(JwtService);
  const token = await jwt.signAsync({
    sub: params.driverId,
    role: 'driver',
    // Approved by default: a spec that does not care about the gate wants a
    // driver who can act, and one that does care sets it explicitly.
    kyc_status: params.kycStatus ?? 'approved',
    ...(params.fleetId ? { fleet_id: params.fleetId } : {}),
  });
  return `Bearer ${token}`;
}

export async function customerAuthHeaderFor(
  app: INestApplication,
  params: { userId: string },
): Promise<string> {
  const jwt = app.get(JwtService);
  const token = await jwt.signAsync({ sub: params.userId, role: 'customer' });
  return `Bearer ${token}`;
}

export async function adminAuthHeaderFor(
  app: INestApplication,
  params: {
    adminId: string;
    subRole?: 'super_admin' | 'operations' | 'support' | 'finance';
    authzVersion?: number;
  },
): Promise<string> {
  const jwt = app.get(JwtService);
  const token = await jwt.signAsync({
    sub: params.adminId,
    role: 'admin',
    sub_role: params.subRole ?? 'operations',
    // Matches the `DEFAULT 1` on `admin_users.authz_version` (migration
    // 0018): seeded rows read as version one unless a spec bumps them.
    authz_version: params.authzVersion ?? 1,
  });
  return `Bearer ${token}`;
}
