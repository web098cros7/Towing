import type { INestApplication } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { DiscoveryModule, DiscoveryService } from '@nestjs/core';
import { Test, type TestingModule } from '@nestjs/testing';
import type { AdminPermission, AdminSubRole } from '@towing/api-contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../../app.module';
import { setupTestDatabase } from '../../test/db';
import { closeTestRedis } from '../../test/redis';
import { PERMISSIONS_KEY, ROLES_KEY } from './realm.decorator';

/**
 * Every `/v1/admin/*` route carries a role or permission decorator (M1 exit
 * gate).
 *
 * This walks the REAL module graph — `ModulesContainer` after `app.init()` —
 * not a hand-kept list, so a controller added without `@Roles`/`@Permissions`
 * fails here rather than shipping fail-open. (Fail-closed is still the guard's
 * default for a missing `@Realms`, but an admin controller missing BOTH would
 * 403 every operator with a confusing message instead of declaring its roles.)
 *
 * The only exemptions are the public auth endpoints, allowlisted verbatim
 * below: login must work before any role exists to check. A newly added
 * `@Public()` admin route fails until it is allowlisted here deliberately.
 */

const PUBLIC_ADMIN_ROUTES: readonly string[] = [
  'POST v1/admin/auth/login',
  'POST v1/admin/auth/verify',
  'POST v1/admin/auth/refresh',
  'POST v1/admin/auth/logout',
  'GET v1/admin/auth/dev/otp',
  // W2: no session exists yet at forced-change completion — the unconsumed
  // login challenge is the only authority. Deliberate, allowlisted verbatim.
  'POST v1/admin/auth/password/complete',
];

/** `IS_PUBLIC` in `jwt-auth.guard.ts` is module-local; this is its key. */
const PUBLIC_KEY = 'auth:public';

interface DiscoveredRoute {
  key: string;
  roles: AdminSubRole[] | undefined;
  permissions: AdminPermission[] | undefined;
  isPublic: boolean;
}

function pathParts(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.filter((part): part is string => typeof part === 'string');
  return [];
}

function normalize(...segments: string[]): string {
  return segments
    .join('/')
    .replace(/\/+/g, '/')
    .replace(/\/$/, '');
}

function discoverAdminRoutes(discovery: DiscoveryService): DiscoveredRoute[] {
  const routes: DiscoveredRoute[] = [];

  for (const wrapper of discovery.getControllers()) {
    const instance = wrapper.instance as unknown;
    if (typeof instance !== 'object' || instance === null) continue;
    const controllerClass = (instance as object).constructor;
    const controllerPaths = pathParts(Reflect.getMetadata(PATH_METADATA, controllerClass));
    if (controllerPaths.length === 0) continue;

    const prototype = Object.getPrototypeOf(instance) as Record<string, unknown>;
    for (const name of Object.getOwnPropertyNames(prototype)) {
      if (name === 'constructor') continue;
      const handler = prototype[name];
      if (typeof handler !== 'function') continue;
      if (Reflect.getMetadata(METHOD_METADATA, handler) === undefined) continue;

      for (const controllerPath of controllerPaths) {
        for (const methodPath of pathParts(Reflect.getMetadata(PATH_METADATA, handler))) {
          const method = Reflect.getMetadata(METHOD_METADATA, handler) as unknown;
          // Keep the global `v1` prefix in the key: `createTestApp` sets it in
          // `app.setGlobalPrefix('v1')`, and this spec boots the same AppModule.
          const fullPath = normalize('v1', controllerPath, methodPath);
          if (fullPath !== 'v1/admin' && !fullPath.startsWith('v1/admin/')) continue;

          const methodName =
            typeof method === 'number'
              ? (['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS', 'HEAD'][method] ?? 'UNKNOWN')
              : 'UNKNOWN';
          routes.push({
            key: `${methodName} ${fullPath}`,
            roles: (Reflect.getMetadata(ROLES_KEY, handler) ??
              Reflect.getMetadata(ROLES_KEY, controllerClass)) as AdminSubRole[] | undefined,
            permissions: (Reflect.getMetadata(PERMISSIONS_KEY, handler) ??
              Reflect.getMetadata(PERMISSIONS_KEY, controllerClass)) as
              | AdminPermission[]
              | undefined,
            isPublic:
              (Reflect.getMetadata(PUBLIC_KEY, handler) ??
                Reflect.getMetadata(PUBLIC_KEY, controllerClass)) === true,
          });
        }
      }
    }
  }

  return routes;
}

describe('admin route walk (every /v1/admin/* route is decorated)', () => {
  let moduleRef: TestingModule;
  let app: INestApplication;
  let routes: DiscoveredRoute[];

  beforeAll(async () => {
    await setupTestDatabase();
    // Own module graph (AppModule + DiscoveryModule): discovery is the public
    // API for enumerating controllers — `ModulesContainer` is container
    // internals and not resolvable through `app.get()`.
    moduleRef = await Test.createTestingModule({ imports: [AppModule, DiscoveryModule] }).compile();
    app = moduleRef.createNestApplication({ logger: false, rawBody: true });
    app.setGlobalPrefix('v1');
    await app.init();
    routes = discoverAdminRoutes(moduleRef.get(DiscoveryService));
  }, 180_000);

  afterAll(async () => {
    await app.close();
    await closeTestRedis();
  });

  it('finds the admin surface (the walk itself is wired up)', () => {
    expect(routes.length).toBeGreaterThan(0);
  });

  it('every non-public admin route carries @Roles or @Permissions', () => {
    const offending = routes.filter(
      (route) =>
        !route.isPublic && (route.roles?.length ?? 0) === 0 && (route.permissions?.length ?? 0) === 0,
    );
    expect(
      offending.map((route) => route.key),
      'admin routes without a role or permission decorator',
    ).toEqual([]);
  });

  it('the public exemption is exactly the auth allowlist — nothing more', () => {
    const publicKeys = routes
      .filter((route) => route.isPublic)
      .map((route) => route.key)
      .sort();
    expect(publicKeys).toEqual([...PUBLIC_ADMIN_ROUTES].sort());
  });
});
