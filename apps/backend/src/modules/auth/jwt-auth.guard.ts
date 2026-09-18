import { type CanActivate, type ExecutionContext, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { adminCan, type AdminPermission } from '@towing/api-contracts';
import { ApiException } from '../../common/errors/api-exception';
import {
  FLEET_REALM,
  realmOf,
  type AdminSubRole,
  type AuthedRequest,
  type RealmName,
} from './auth.types';
import { PERMISSIONS_KEY, REALMS_KEY, ROLES_KEY } from './realm.decorator';
import { AdminAuthzService } from './admin-authz.service';
import { TokenService } from './token.service';

const IS_PUBLIC = 'auth:public';

/** Opts a handler out of `JwtAuthGuard` — login and refresh cannot require a session. */
export const Public = (): MethodDecorator => SetMetadata(IS_PUBLIC, true);

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
    private readonly adminAuthz: AdminAuthzService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<AuthedRequest>();
    const claims = await this.tokens.verifyAccessToken(bearer(request));
    const realm = realmOf(claims.role);

    /**
     * NO `@Realms()` METADATA MEANS FLEET-ONLY, and that default is the whole
     * safety property of this guard. Every controller written before Phase 10
     * keeps exactly the behaviour it had, and a controller added after it that
     * forgets the decorator gets a 403 for the realm it meant to serve — a
     * loud, immediate failure — instead of quietly admitting all four.
     *
     * Widening this default to "any realm when unset" would open every fleet
     * controller to drivers and customers in one character.
     */
    const allowed = this.reflector.getAllAndOverride<RealmName[]>(REALMS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]) ?? [FLEET_REALM];

    // §15.2 — the consoles are separate auth realms. A driver or admin token is
    // cryptographically valid but carries no authority here, so this is a 403
    // (authenticated, wrong realm) rather than a 401 (not authenticated).
    if (!allowed.includes(realm)) {
      throw ApiException.forbidden(
        allowed.length === 1 && allowed[0] === FLEET_REALM
          ? 'This token is not valid for the fleet console'
          : `This token is not valid for the ${allowed.join('/')} realm`,
      );
    }

    // Realm-specific shape is checked HERE rather than in `verifyAccessToken`,
    // so an off-realm token reports as 403 and not as a malformed-token 401.
    const fleetId = 'fleet_id' in claims ? claims.fleet_id : undefined;
    if (realm === FLEET_REALM && (typeof fleetId !== 'string' || fleetId.length === 0)) {
      throw ApiException.forbidden('Token carries no fleet binding');
    }

    const roles = this.reflector.getAllAndOverride<AdminSubRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (roles?.length) {
      if (claims.role !== 'admin' || !roles.includes(claims.sub_role)) {
        throw ApiException.forbidden('Your admin role does not permit this action');
      }
    }

    // W1: fine-grained permissions, checked AFTER the role check against the
    // same ROLE_PERMISSIONS table the console reads — one map, two consumers.
    // A non-admin token fails outright (permissions are admin permissions, so
    // no other realm can satisfy one), and every listed permission must hold.
    const permissions = this.reflector.getAllAndOverride<AdminPermission[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (permissions?.length) {
      if (
        claims.role !== 'admin' ||
        !permissions.every((permission) => adminCan(claims.sub_role, permission))
      ) {
        throw ApiException.forbidden('Your admin role does not permit this action');
      }
    }

    // A17: admin authorization is re-read, not trusted off the 900-second
    // token. A demotion lands within ~`ADMIN_AUTHZ_TTL_MS` as a 401 — never a
    // 403 — so the BFF's refresh-once-and-retry mints a correctly-scoped token
    // and the request succeeds with reduced scope. The family is NOT burned:
    // this 401 means "stale", not "stolen".
    //
    // The comparison is directional (row newer than token ⇒ stale), never
    // equality: the retry after a refresh carries fresh claims against a
    // possibly-stale cached row, and equality would 401 a correct token.
    if (claims.role === 'admin') {
      const row = await this.adminAuthz.read(claims.sub);
      const version = 'authz_version' in claims ? claims.authz_version : undefined;
      if (
        !row ||
        row.status !== 'active' ||
        typeof version !== 'number' ||
        row.authzVersion > version
      ) {
        throw ApiException.unauthorized('Admin session is stale — refreshing');
      }
    }

    request.auth = { ...claims, realm, fleetId };
    return true;
  }
}

function bearer(request: AuthedRequest): string {
  const header = request.headers.authorization;
  if (!header) throw ApiException.unauthorized('Missing Authorization header');

  const [scheme, token] = header.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !token) {
    throw ApiException.unauthorized('Authorization header must be a Bearer token');
  }

  return token;
}
