import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { beforeAll, describe, expect, it } from 'vitest';
import { ApiException } from '../../common/errors/api-exception';
import { loadEnv, type Env } from '../../config/env';
import type { Database } from '../../db/db.module';
import type { AuthedRequest } from './auth.types';
import { JwtAuthGuard } from './jwt-auth.guard';
import type { RealmPolicyRegistry } from './realm.policy';
import type { RefreshGraceService } from './refresh-grace.service';
import { TokenService } from './token.service';

const FLEET_ID = '33333333-3333-4333-8333-333333333333';

describe('JwtAuthGuard (fleet realm)', () => {
  let env: Env;
  let jwt: JwtService;
  let guard: JwtAuthGuard;

  function contextFor(
    request: Partial<AuthedRequest>,
    handler: () => void = () => {},
  ): ExecutionContext {
    return {
      getHandler: () => handler,
      getClass: () => class {},
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;
  }

  beforeAll(() => {
    env = loadEnv();
    jwt = new JwtService({
      secret: env.JWT_ACCESS_SECRET,
      signOptions: { expiresIn: env.JWT_ACCESS_TTL_SECONDS },
    });
    // verifyAccessToken never touches the database, Redis or the realm
    // policies, so the guard can be exercised without the test stack. The
    // admin authz re-check (A17) must not run for non-admin realms — a stub
    // that fails loudly proves it.
    const tokens = new TokenService(
      null as unknown as Database,
      env,
      jwt,
      null as unknown as RefreshGraceService,
      null as unknown as RealmPolicyRegistry,
    );
    const authz = {
      read: async (): Promise<never> => {
        throw new Error('admin authz re-check must not run outside the admin realm');
      },
    };
    guard = new JwtAuthGuard(new Reflector(), tokens, authz as never);
  });

  it('rejects a missing Authorization header', async () => {
    await expect(guard.canActivate(contextFor({ headers: {} } as Partial<AuthedRequest>)))
      .rejects.toMatchObject({ code: 'unauthorized' });
  });

  it('rejects a non-Bearer scheme', async () => {
    const request = { headers: { authorization: 'Basic dXNlcjpwdw==' } };
    await expect(guard.canActivate(contextFor(request as Partial<AuthedRequest>)))
      .rejects.toMatchObject({ code: 'unauthorized' });
  });

  it('rejects a garbage token', async () => {
    const request = { headers: { authorization: 'Bearer not-a-jwt' } };
    await expect(guard.canActivate(contextFor(request as Partial<AuthedRequest>)))
      .rejects.toMatchObject({ code: 'unauthorized' });
  });

  it('accepts a fleet-owner token and attaches auth with the tenant key', async () => {
    const token = await jwt.signAsync({ sub: 'user-1', role: 'fleet_owner', fleet_id: FLEET_ID });
    const request = { headers: { authorization: `Bearer ${token}` } } as AuthedRequest;

    await expect(guard.canActivate(contextFor(request))).resolves.toBe(true);
    expect(request.auth).toMatchObject({ sub: 'user-1', fleetId: FLEET_ID });
  });

  it('rejects a signature-valid token from another realm with 403, not 401 (§15.2)', async () => {
    const token = await jwt.signAsync({ sub: 'admin-1', role: 'admin' });
    const request = { headers: { authorization: `Bearer ${token}` } };

    let thrown: unknown;
    try {
      await guard.canActivate(contextFor(request as Partial<AuthedRequest>));
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(ApiException);
    expect((thrown as ApiException).getStatus()).toBe(403);
  });

  it('rejects a fleet-owner token with no fleet binding', async () => {
    const token = await jwt.signAsync({ sub: 'user-1', role: 'fleet_owner' });
    const request = { headers: { authorization: `Bearer ${token}` } };
    await expect(guard.canActivate(contextFor(request as Partial<AuthedRequest>)))
      .rejects.toMatchObject({ code: 'forbidden' });
  });

  it('lets @Public() handlers through without any token', async () => {
    const handler = () => {};
    Reflect.defineMetadata('auth:public', true, handler);
    await expect(
      guard.canActivate(contextFor({ headers: {} } as Partial<AuthedRequest>, handler)),
    ).resolves.toBe(true);
  });
});
