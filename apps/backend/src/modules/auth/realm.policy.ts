import { Injectable } from '@nestjs/common';
import type { AccessClaims, Realm } from './auth.types';

export interface ResolvedSubject {
  /** Rebuilt from CURRENT database state — never copied off the token row. */
  claims: AccessClaims;
  /** Written to `refresh_tokens.fleet_id`. Null for realms with no tenant. */
  fleetId: string | null;
}

/**
 * Per-realm session limits (§3.6, G15). Both windows are enforced in
 * `TokenService.rotate` — the idle window as a predicate on the conditional
 * claim, the absolute window when the claim fails — and each revokes the whole
 * family, so an expired session cannot be resurrected by racing a refresh.
 */
export interface RealmSessionLimits {
  /** A token unused for this long is dead. Measured from the previous rotation. */
  readonly idleMs: number;
  /** No family outlives this from its first mint, however active. */
  readonly absoluteMs: number;
}

/**
 * Everything that differs between the four auth realms, in one seam.
 *
 * The load-bearing method is `resolve`, and the reason it exists is staleness:
 * a driver approved five minutes ago must carry `kyc_status: 'approved'` on
 * their very next refresh. Copying claims off the refresh-token row would leave
 * that claim wrong for up to the 30-day family lifetime, and would make
 * suspension take effect only when a token happened to expire.
 *
 * Returning `null` therefore means "this subject may no longer hold a session";
 * `TokenService` revokes the whole family on it, so revoking authority is
 * immediate rather than eventual.
 */
export interface RealmPolicy {
  readonly realm: Realm;
  /**
   * `true` ⇒ a claimed refresh row with a null `fleet_id` is a corrupt session
   * and the family is burned. Only the fleet realm sets this: customer, driver
   * and admin tokens legitimately have no tenant, and treating that as
   * corruption is precisely the bug this phase fixes.
   */
  readonly requiresFleet: boolean;
  /**
   * Session windows for this realm, or absent for "no limits" — today's
   * behaviour for fleet, driver and customer, whose sessions still live on
   * the refresh TTL alone. Only the admin realm (G15) sets this. Optional so
   * every existing policy and test double compiles unchanged.
   */
  readonly sessionLimits?: RealmSessionLimits | null;

  resolve(subjectId: string, tokenFleetId: string | null): Promise<ResolvedSubject | null>;
}

@Injectable()
export class RealmPolicyRegistry {
  private readonly byRealm: ReadonlyMap<Realm, RealmPolicy>;

  constructor(policies: readonly RealmPolicy[]) {
    this.byRealm = new Map(policies.map((policy) => [policy.realm, policy]));
  }

  /**
   * Throws rather than returning undefined: the realm always comes from a row
   * this service itself wrote, so an unknown one is a programming error and
   * should not be recoverable into a half-authenticated request.
   */
  for(realm: Realm): RealmPolicy {
    const policy = this.byRealm.get(realm);
    if (!policy) throw new Error(`No RealmPolicy is registered for realm '${realm}'`);
    return policy;
  }

  has(realm: string): realm is Realm {
    return this.byRealm.has(realm as Realm);
  }

  /**
   * Session windows for a realm, `null` when it declares none. The realm always
   * comes from a row this service wrote, so an unknown realm is a programming
   * error and throws through `for()` rather than being silently unlimited.
   */
  limitsFor(realm: Realm): RealmSessionLimits | null {
    return this.for(realm).sessionLimits ?? null;
  }
}
