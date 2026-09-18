import type { Request } from 'express';
import { z } from 'zod';

/**
 * The four auth realms (§15.2: the customer app, the driver app, the fleet
 * console and the admin console are separate auth realms). Stored on
 * `refresh_tokens.realm` and checked on every rotation, so a token minted for
 * one realm can never be exchanged for a session in another.
 */
export const REALMS = ['fleet', 'driver', 'customer', 'admin'] as const;
export type Realm = (typeof REALMS)[number];

/**
 * Alias for `Realm`, so `realm.decorator.ts` can name the type without
 * colliding with the `@Realms()` decorator value it exports.
 */
export type RealmName = Realm;

export const FLEET_REALM = 'fleet' satisfies Realm;

export type AdminSubRole = 'super_admin' | 'operations' | 'support' | 'finance';
export type KycStatus = 'pending' | 'approved' | 'rejected' | 'incomplete' | 'suspended';

/**
 * Access-token payloads, discriminated on `role`. Claim names are snake_case
 * because they are JWT claims, not TS fields.
 *
 * There is deliberately NO `realm` claim: realm is DERIVED from role by
 * `realmOf()`, so a token whose role and realm disagree is not a shape this
 * system can express. One source of truth beats two that must be kept in sync.
 */
export interface FleetAccessClaims {
  sub: string;
  role: 'fleet_owner';
  fleet_id: string;
}

export interface DriverAccessClaims {
  sub: string;
  role: 'driver';
  /**
   * §3.1 makes admin approval a precondition of going online. The claim is the
   * cheap layer; sensitive actions re-read `drivers.kyc_status` from the
   * database, because a claim minted 14 minutes ago is up to 14 minutes stale.
   * `RealmPolicy` rebuilds this on every rotation so it is never older than one
   * refresh cycle.
   */
  kyc_status: KycStatus;
  /** Absent for independent drivers — `drivers.fleet_id` is nullable. */
  fleet_id?: string;
}

export interface CustomerAccessClaims {
  sub: string;
  role: 'customer';
}

export interface AdminAccessClaims {
  sub: string;
  role: 'admin';
  /** §4.2 RBAC. Enforced server-side by `@Roles()`, never by the console. */
  sub_role: AdminSubRole;
  /**
   * A17's authorization generation, mirrored from `admin_users.authz_version`
   * at mint time. `JwtAuthGuard` 401s any token older than the row — which is
   * what pulls a demotion forward from the 900-second expiry to ~5 seconds.
   * Absent on pre-A17 tokens, which the guard treats as stale (one refresh
   * mints a versioned token and the retry succeeds).
   */
  authz_version: number;
}

export type AccessClaims =
  | FleetAccessClaims
  | DriverAccessClaims
  | CustomerAccessClaims
  | AdminAccessClaims;

export type ActorRole = AccessClaims['role'];

const ROLE_REALM = {
  fleet_owner: 'fleet',
  driver: 'driver',
  customer: 'customer',
  admin: 'admin',
} as const satisfies Record<ActorRole, Realm>;

export function realmOf(role: ActorRole): Realm {
  return ROLE_REALM[role];
}

/** Narrows an unverified JWT payload's `role` before it is treated as claims. */
export function isActorRole(value: unknown): value is ActorRole {
  return typeof value === 'string' && value in ROLE_REALM;
}

/**
 * What `JwtAuthGuard` attaches to the request. `fleetId` duplicates `fleet_id`
 * so downstream code reads the tenant key in the codebase's own casing without
 * every call site having to remember the claim spelling.
 *
 * `fleetId` is OPTIONAL as of Phase 10 — customer, driver and admin sessions
 * have no tenant. Every consumer (`FleetScopeGuard`, `@CurrentFleet()`,
 * `ProfileCompleteGuard`, `IdempotencyInterceptor`) already branched on it
 * being falsy, which is why widening this cost one narrowing edit and nothing
 * else.
 */
export interface AuthedRequest extends Request {
  auth?: AccessClaims & { realm: Realm; fleetId?: string };
}

/**
 * Refresh/logout bodies are not in `@towing/api-contracts` on purpose: the raw
 * refresh value is a server-issued opaque secret, so no client ever constructs
 * one and there is nothing for a shared contract to describe beyond "a string".
 */
export const refreshRequestSchema = z.object({
  refreshToken: z.string().min(32),
});
export type RefreshRequest = z.infer<typeof refreshRequestSchema>;

/**
 * Query for the development-only OTP echo. Not in `@towing/api-contracts` for
 * the same reason as above and one more: no shipped client may ever call it, so
 * publishing it in the shared package would advertise a route that must not
 * exist in production.
 */
export const devOtpQuerySchema = z.object({
  challengeId: z.uuid(),
});
export type DevOtpQuery = z.infer<typeof devOtpQuerySchema>;
