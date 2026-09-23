import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { ENV, type Env } from '../../config/env';
import { DB, type Database } from '../../db/db.module';
import { adminUsers } from '../../db/schema';
import { TOTP_REQUIRED_SUB_ROLES } from '@towing/api-contracts';
import type { AdminSubRole } from './auth.types';

export interface AdminAuthzRow {
  status: string;
  subRole: AdminSubRole;
  authzVersion: number;
  twofaEnabled: boolean;
}

/**
 * A17's per-process copy of admin authorization state.
 *
 * `JwtAuthGuard` trusts `sub_role` off a 900-second JWT; this is what pulls a
 * demotion forward to ~`ADMIN_AUTHZ_TTL_MS`. One indexed PK read per admin per
 * window — admin traffic is thin, and the alternative (a read per request) is
 * pure overhead for the same staleness bound the TTL already states openly.
 *
 * The comparison in the guard is DIRECTIONAL (row newer than token ⇒ stale),
 * never equality: after a demote → 401 → refresh → retry, the retry's fresh
 * claims meet a possibly-stale cached row, and equality would 401 a token
 * that is already correct — logging the admin out instead of continuing with
 * reduced scope. Direction holds for that case by construction.
 */
@Injectable()
export class AdminAuthzService {
  private readonly cache = new Map<string, { row: AdminAuthzRow | null; at: number }>();

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async read(adminId: string): Promise<AdminAuthzRow | null> {
    const hit = this.cache.get(adminId);
    if (hit && Date.now() - hit.at < this.env.ADMIN_AUTHZ_TTL_MS) return hit.row;

    const [row] = await this.db
      .select({
        status: adminUsers.status,
        subRole: adminUsers.subRole,
        authzVersion: adminUsers.authzVersion,
        twofaEnabled: adminUsers.twofaEnabled,
      })
      .from(adminUsers)
      .where(eq(adminUsers.id, adminId))
      .limit(1);

    const out = row ?? null;
    this.cache.set(adminId, { row: out, at: Date.now() });
    return out;
  }

  /**
   * ADM-16: does this admin still owe an authenticator enrolment?
   *
   * Read off the SAME row the guard already fetched for A17, so the rule costs
   * no query of its own, and off the row's `sub_role` rather than the token's:
   * promoting a Support admin to Finance must start requiring 2FA on their next
   * request, not when their old token expires.
   */
  totpEnrolmentRequired(row: Pick<AdminAuthzRow, 'subRole' | 'twofaEnabled'>): boolean {
    if (!this.env.ADMIN_TOTP_REQUIRED) return false;
    return (
      !row.twofaEnabled &&
      (TOTP_REQUIRED_SUB_ROLES as readonly string[]).includes(row.subRole)
    );
  }

  /**
   * Drop the cached row after a 2FA change on this admin.
   *
   * Without it the admin who just confirmed their authenticator would be told
   * to enrol for up to `ADMIN_AUTHZ_TTL_MS` more on this instance — the next
   * click after "done" failing is exactly the moment they would conclude it had
   * not worked. Other instances still wait out the TTL (5 s by default); that
   * is the same staleness bound A17 already states for a demotion.
   */
  forget(adminId: string): void {
    this.cache.delete(adminId);
  }
}
