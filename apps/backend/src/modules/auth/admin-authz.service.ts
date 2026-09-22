import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { ENV, type Env } from '../../config/env';
import { DB, type Database } from '../../db/db.module';
import { adminUsers } from '../../db/schema';
import type { AdminSubRole } from './auth.types';

export interface AdminAuthzRow {
  status: string;
  subRole: AdminSubRole;
  authzVersion: number;
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
      })
      .from(adminUsers)
      .where(eq(adminUsers.id, adminId))
      .limit(1);

    const out = row ?? null;
    this.cache.set(adminId, { row: out, at: Date.now() });
    return out;
  }
}
