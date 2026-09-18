import { SetMetadata } from '@nestjs/common';
import type { AdminPermission } from '@towing/api-contracts';
import type { AdminSubRole, RealmName } from './auth.types';

export const REALMS_KEY = 'auth:realms';
export const ROLES_KEY = 'auth:roles';
export const PERMISSIONS_KEY = 'auth:permissions';

/**
 * Which auth realms a controller or handler accepts (§15.2).
 *
 * OMITTING THIS MEANS FLEET-ONLY. `JwtAuthGuard` defaults to `['fleet']` when
 * no metadata is present, which is what let all eleven pre-Phase-10 controllers
 * keep byte-identical behaviour with zero edits — and, more importantly, means
 * a new controller that forgets the decorator fails CLOSED with a 403 rather
 * than silently accepting every realm.
 *
 * Resolved with `getAllAndOverride([handler, class])`, so a handler may narrow
 * or widen its class's realms, the same way `@ThrottleBucket` works.
 */
export const Realms = (...realms: RealmName[]): MethodDecorator & ClassDecorator =>
  SetMetadata(REALMS_KEY, realms);

/**
 * Admin sub-roles permitted on a route (§4.2 RBAC).
 *
 * Enforced server-side on every admin route, never by the console: §9.4 has a
 * `support` operator who can read the KYC queue but must not approve from it,
 * and a hidden button is not an authorisation control.
 *
 * A non-admin token fails this outright — the roles are admin sub-roles, so
 * there is no sensible way for a driver or fleet token to satisfy one.
 */
export const Roles = (...subRoles: AdminSubRole[]): MethodDecorator & ClassDecorator =>
  SetMetadata(ROLES_KEY, subRoles);

/**
 * Fine-grained admin permissions (W1, guide §3.1).
 *
 * Enforced in `JwtAuthGuard` immediately after the role check, against the
 * SAME `ROLE_PERMISSIONS` table the console reads through `useAdminIdentity`
 * + `<Can>` — one map, two consumers. New admin routes use this;
 * **existing routes stay on `@Roles`** — no rewrite, and the route-walk spec
 * accepts either decorator.
 */
export const Permissions = (...permissions: AdminPermission[]): MethodDecorator & ClassDecorator =>
  SetMetadata(PERMISSIONS_KEY, permissions);
