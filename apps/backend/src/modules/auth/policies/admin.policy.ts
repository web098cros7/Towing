import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DB, type Database } from '../../../db/db.module';
import { adminUsers } from '../../../db/schema';
import type { Realm } from '../auth.types';
import type { RealmPolicy, ResolvedSubject } from '../realm.policy';

/**
 * The Towing Admin console (§9.4, §4.2).
 *
 * `sub_role` is re-read rather than carried forward, so demoting an operator
 * from `super_admin` to `support` takes effect on their next refresh instead of
 * whenever their access token happens to expire. For the realm that approves
 * KYC and later approves payouts, "eventually" is not good enough.
 */
@Injectable()
export class AdminRealmPolicy implements RealmPolicy {
  readonly realm: Realm = 'admin';
  readonly requiresFleet = false;

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
