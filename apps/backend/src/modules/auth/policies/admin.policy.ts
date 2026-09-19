import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DB, type Database } from '../../../db/db.module';
import { adminUsers } from '../../../db/schema';
import type { Realm } from '../auth.types';
import type { RealmPolicy, RealmSessionLimits, ResolvedSubject } from '../realm.policy';

/**
 * G15: 30-minute idle, 12-hour absolute — the ADMIN realm only, and the one
 * source of truth for both. `AdminAuthService.listSessions` filters by the same
 * windows (a session the list renders must be one that can still rotate), and
 * the web BFF's cookie max-age mirrors `absoluteMs`; the backend wins wherever
 * they could disagree, because only `TokenService.rotate` refuses a token.
 */
export const ADMIN_SESSION_LIMITS = {
  idleMs: 30 * 60 * 1000,
  absoluteMs: 12 * 60 * 60 * 1000,
} as const satisfies RealmSessionLimits;

/**
 * The Towing Admin console (§9.4, §4.2).
 *
 * `sub_role` is re-read rather than carried forward, so demoting an operator
 * from `super_admin` to `support` takes effect on their next refresh instead of
 * whenever their access token happens to expire. For the realm that approves
 * KYC and later approves payouts, "eventually" is not good enough.
 *
 * ADMIN IS THE ONLY LIMITED REALM (W1, §3.6 / G15). The console reaches every
 * customer, driver and rupee on the platform, so its sessions get a 30-minute
 * idle window and a 12-hour absolute cap, where fleet/customer/driver keep the
 * refresh TTL alone. This is the policy side of the switch; `TokenService.rotate`
 * is the enforcement side.
 */
@Injectable()
export class AdminRealmPolicy implements RealmPolicy {
  readonly realm: Realm = 'admin';
  readonly requiresFleet = false;
  readonly sessionLimits: RealmSessionLimits = ADMIN_SESSION_LIMITS;

  constructor(@Inject(DB) private readonly db: Database) {}

  async resolve(subjectId: string): Promise<ResolvedSubject | null> {
    const [admin] = await this.db
      .select({
        id: adminUsers.id,
        subRole: adminUsers.subRole,
        status: adminUsers.status,
        authzVersion: adminUsers.authzVersion,
      })
      .from(adminUsers)
      .where(eq(adminUsers.id, subjectId))
      .limit(1);

    if (!admin || admin.status !== 'active') return null;

    return {
      claims: { sub: admin.id, role: 'admin', sub_role: admin.subRole, authz_version: admin.authzVersion },
      fleetId: null,
    };
  }
}
