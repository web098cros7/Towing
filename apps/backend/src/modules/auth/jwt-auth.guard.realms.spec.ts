import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { beforeAll, describe, expect, it } from 'vitest';
import { ApiException } from '../../common/errors/api-exception';
import { loadEnv, type Env } from '../../config/env';
import type { Database } from '../../db/db.module';
import type { AuthedRequest } from './auth.types';
import { JwtAuthGuard } from './jwt-auth.guard';
import { REALMS_KEY, ROLES_KEY } from './realm.decorator';
import type { RealmPolicyRegistry } from './realm.policy';
import type { RefreshGraceService } from './refresh-grace.service';
import { TokenService } from './token.service';

const FLEET_ID = '33333333-3333-4333-8333-333333333333';

/**
 * The realm and RBAC behaviour of the generic guard.
 *
 * The first test is the one that matters most: no `@Realms()` metadata means
 * FLEET-ONLY. That default is what let all eleven pre-Phase-10 controllers keep
 * byte-identical behaviour with zero edits, and — more importantly — it means a
 * controller added later that forgets the decorator fails CLOSED. Widen it to
 * "any realm when unset" and every fleet route silently opens to drivers and
 * customers.
 */
describe('JwtAuthGuard realms and roles', () => {
  let env: Env;
  let jwt: JwtService;
  let guard: JwtAuthGuard;

  // A17's re-check reads through this stub — no database in a unit spec.
  // Versions deliberately lag the tokens below unless a test says otherwise.
  const authzRows: Record<string, { status: string; subRole: string; authzVersion: number }> = {
    a1: { status: 'active', subRole: 'support', authzVersion: 1 },
    a2: { status: 'active', subRole: 'operations', authzVersion: 1 },
  };
  const authz = {
    read: async (adminId: string) => authzRows[adminId] ?? null,
    // ADM-16's enrolment rule is off here: these rows are Support and
    // Operations, which it never covers, and the rule itself is proven against
    // a real database in `admin-totp-required.e2e.spec.ts`.
    totpEnrolmentRequired: () => false,
  };

  beforeAll(() => {
    env = loadEnv();
    jwt = new JwtService({
      secret: env.JWT_ACCESS_SECRET,
      signOptions: { expiresIn: env.JWT_ACCESS_TTL_SECONDS },
    });
    const tokens = new TokenService(
      null as unknown as Database,
      env,
      jwt,
      null as unknown as RefreshGraceService,
      null as unknown as RealmPolicyRegistry,
    );
    guard = new JwtAuthGuard(new Reflector(), tokens, authz as never);
  });

  function contextFor(
    request: Partial<AuthedRequest>,
    metadata: { realms?: string[]; roles?: string[] } = {},
  ): ExecutionContext {
    const handler = () => undefined;
    if (metadata.realms) Reflect.defineMetadata(REALMS_KEY, metadata.realms, handler);
    if (metadata.roles) Reflect.defineMetadata(ROLES_KEY, metadata.roles, handler);

    return {
      switchToHttp: () => ({ getRequest: () => request }),
      getHandler: () => handler,
      getClass: () => class {},
    } as unknown as ExecutionContext;
  }

  const bearer = async (claims: Record<string, unknown>) => ({
    headers: { authorization: `Bearer ${await jwt.signAsync(claims)}` },
  });

  async function statusFor(
    request: Partial<AuthedRequest>,
    metadata?: { realms?: string[]; roles?: string[] },
  ): Promise<number> {
    try {
      await guard.canActivate(contextFor(request, metadata));
      return 200;
    } catch (error) {
      return error instanceof ApiException ? error.getStatus() : 500;
    }
  }

  it('DEFAULTS TO FLEET-ONLY when a controller declares no realms', async () => {
    // Fails closed. A driver, customer or admin token is cryptographically
    // valid and carries no authority here, so 403 rather than 401.
    expect(await statusFor(await bearer({ sub: 'd1', role: 'driver', kyc_status: 'approved' }))).toBe(403);
    expect(await statusFor(await bearer({ sub: 'c1', role: 'customer' }))).toBe(403);
    expect(await statusFor(await bearer({ sub: 'a1', role: 'admin', sub_role: 'operations' }))).toBe(403);

    expect(
      await statusFor(await bearer({ sub: 'u1', role: 'fleet_owner', fleet_id: FLEET_ID })),
    ).toBe(200);
  });

  it('accepts the declared realm and refuses the others', async () => {
    const driver = await bearer({ sub: 'd1', role: 'driver', kyc_status: 'approved' });
    const fleet = await bearer({ sub: 'u1', role: 'fleet_owner', fleet_id: FLEET_ID });

    expect(await statusFor(driver, { realms: ['driver'] })).toBe(200);
    expect(await statusFor(fleet, { realms: ['driver'] })).toBe(403);
  });

  it('accepts either realm when two are declared (the public refresh route)', async () => {
    expect(
      await statusFor(await bearer({ sub: 'c1', role: 'customer' }), {
        realms: ['customer', 'driver'],
      }),
    ).toBe(200);
    expect(
      await statusFor(await bearer({ sub: 'd1', role: 'driver', kyc_status: 'incomplete' }), {
        realms: ['customer', 'driver'],
      }),
    ).toBe(200);
  });

  it('enforces admin sub-roles server-side (§4.2)', async () => {
    const support = await bearer({ sub: 'a1', role: 'admin', sub_role: 'support' });
    const ops = await bearer({ sub: 'a2', role: 'admin', sub_role: 'operations', authz_version: 1 });
    const metadata = { realms: ['admin'], roles: ['super_admin', 'operations'] };

    expect(await statusFor(support, metadata)).toBe(403);
    expect(await statusFor(ops, metadata)).toBe(200);
  });

  it('401s an admin token older than its row (A17), without burning anything', async () => {
    // The row advanced past the token (a demotion bumped the version). 401,
    // not 403: the BFF refreshes once and retries with a correctly-scoped
    // token instead of logging the admin out.
    authzRows.a2!.authzVersion = 2;
    try {
      const stale = await bearer({ sub: 'a2', role: 'admin', sub_role: 'operations', authz_version: 1 });
      expect(
        await statusFor(stale, { realms: ['admin'], roles: ['super_admin', 'operations'] }),
      ).toBe(401);
    } finally {
      authzRows.a2!.authzVersion = 1;
    }
  });

  it('401s a versionless pre-A17 admin token so one refresh heals it', async () => {
    const legacy = await bearer({ sub: 'a2', role: 'admin', sub_role: 'operations' });
    expect(
      await statusFor(legacy, { realms: ['admin'], roles: ['super_admin', 'operations'] }),
    ).toBe(401);
  });

  it('refuses a non-admin token on a role-gated route', async () => {
    // The roles ARE admin sub-roles, so there is no sensible way for a driver or
    // fleet token to satisfy one — and silently ignoring the decorator for them
    // would be the worst possible reading.
    const driver = await bearer({ sub: 'd1', role: 'driver', kyc_status: 'approved' });

    expect(await statusFor(driver, { realms: ['admin', 'driver'], roles: ['operations'] })).toBe(403);
  });

  it('still requires a fleet binding on the fleet realm', async () => {
    expect(await statusFor(await bearer({ sub: 'u1', role: 'fleet_owner' }))).toBe(403);
  });

  it('attaches the derived realm to the request', async () => {
    const request = (await bearer({
      sub: 'd1',
      role: 'driver',
      kyc_status: 'approved',
      fleet_id: FLEET_ID,
    })) as AuthedRequest;

    await guard.canActivate(contextFor(request, { realms: ['driver'] }));

    // `realm` is DERIVED from `role`, never carried as its own claim — so a
    // token whose role and realm disagree is not a shape this system can express.
    expect(request.auth).toMatchObject({ sub: 'd1', realm: 'driver', fleetId: FLEET_ID });
  });
});
