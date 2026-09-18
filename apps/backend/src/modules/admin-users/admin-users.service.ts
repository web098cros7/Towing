import { randomBytes } from 'node:crypto';
import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import {
  ErrorCodes,
  type AdminAdminDetail,
  type AdminAdminListItem,
  type AdminAdminsListResponse,
  type AdminAdminsQuery,
  type AdminCreateAdmin,
  type AdminCreateAdminResponse,
  type AdminDeactivateAdmin,
  type AdminResetPasswordResponse,
  type AdminUpdateAdmin,
} from '@towing/api-contracts';
import { and, count, desc, eq, ilike, ne, or } from 'drizzle-orm';
import { ApiException } from '../../common/errors/api-exception';
import { DB, type Database } from '../../db/db.module';
import { adminUsers } from '../../db/schema';
import { ADMIN_REVOKE_CHANNEL, REDIS } from '../../redis/redis.constants';
import type { Redis } from 'ioredis';
import { hashPassword } from '../auth/password';
import { TokenService, type SessionContext } from '../auth/token.service';
import { AdminAuditService } from '../admin-auth/admin-audit.service';

/** Entropy in a generated temporary password: 9 bytes → 12 base64url chars. */
const TEMP_PASSWORD_BYTES = 9;

/**
 * Admin user management (W2, spec §4.2 "Manage admins & roles").
 *
 * Every route here is `@Permissions('admin.manage')` — super_admin only.
 * Three properties the tests pin:
 *
 * 1. Authority dies twice on demote/deactivate: the 0019 trigger bumps
 *    `authz_version` (so the guard 401s the next request within ~5 s), AND
 *    `revokeSubject` kills the refresh family outright (so no refresh can
 *    mint a new token). Belt and suspenders on purpose — the trigger covers
 *    writers that bypass this service, the revoke covers the session at hand.
 * 2. The last active super_admin cannot be removed — a service-level count,
 *    because no CHECK can express it. A concurrent double-deactivate races;
 *    demoting the last super_admin is a two-human ceremony anyway, and the
 *    report names the residual race rather than pretending a lock fixes it.
 * 3. Audit rows never carry credential material: `redactAdminForAudit`
 *    strips `password_hash` and both TOTP secrets from before/after.
 */
@Injectable()
export class AdminUsersService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly tokens: TokenService,
    private readonly audit: AdminAuditService,
  ) {}

  async list(query: AdminAdminsQuery): Promise<AdminAdminsListResponse> {
    const page = query.page;
    const limit = query.limit;
    const conditions = listConditions(query);

    const where = conditions.length > 0 ? and(...conditions) : undefined;
    const [rows, totalRows] = await Promise.all([
      this.db
        .select(listColumns)
        .from(adminUsers)
        .where(where)
        .orderBy(desc(adminUsers.createdAt), desc(adminUsers.id))
        .limit(limit)
        .offset((page - 1) * limit),
      this.db.select({ total: count() }).from(adminUsers).where(where),
    ]);

    return { items: rows.map(toListItem), page, limit, total: totalRows[0]?.total ?? 0 };
  }

  async get(adminId: string): Promise<AdminAdminDetail> {
    const row = await this.findById(adminId);
    if (!row) throw ApiException.notFound('Admin not found');
    return toDetail(row);
  }

  async create(
    actorId: string,
    input: AdminCreateAdmin,
    context: SessionContext = {},
  ): Promise<AdminCreateAdminResponse> {
    const email = input.email.trim().toLowerCase();
    const mobile = input.mobile.trim();

    const [existing] = await this.db
      .select({ id: adminUsers.id })
      .from(adminUsers)
      .where(or(eq(adminUsers.email, email), eq(adminUsers.mobile, mobile)))
      .limit(1);
    if (existing) {
      throw new ApiException(
        HttpStatus.CONFLICT,
        ErrorCodes.DUPLICATE_MOBILE,
        'An admin with that email or mobile already exists',
      );
    }

    const temporaryPassword = randomBytes(TEMP_PASSWORD_BYTES).toString('base64url');
    const now = new Date();
    const [row] = await this.db
      .insert(adminUsers)
      .values({
        email,
        mobile,
        name: input.name,
        passwordHash: await hashPassword(temporaryPassword),
        subRole: input.subRole,
        status: 'active',
        receivesOpsAlerts: input.receivesOpsAlerts ?? false,
        createdBy: actorId,
      })
      .returning();

    const admin = toDetail(row!);
    // The temp password is handed over out of band (SES is sandboxed) and is
    // NEVER stored or returned again — so it must not reach the audit row
    // either. What the audit keeps is the redacted projection, not the secret.
    await this.audit.record({
      adminId: actorId,
      action: 'admin.create',
      subjectType: 'admin',
      subjectId: admin.id,
      before: null,
      after: redactAdminForAudit(row!),
      reason: null,
      ip: context.ip ?? null,
      userAgent: context.userAgent ?? null,
    });

    return { admin, temporaryPassword };
  }

  async update(
    actorId: string,
    targetId: string,
    input: AdminUpdateAdmin,
    context: SessionContext = {},
  ): Promise<AdminAdminDetail> {
    const before = await this.findById(targetId);
    if (!before) throw ApiException.notFound('Admin not found');

    const subRoleChanging = input.subRole !== undefined && input.subRole !== before.subRole;
    if (subRoleChanging) {
      await this.refuseLastSuperAdminRemoval(targetId, before.subRole, input.subRole, actorId, context);
    }

    const now = new Date();
    const [after] = await this.db
      .update(adminUsers)
      .set({
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.subRole !== undefined ? { subRole: input.subRole } : {}),
        ...(input.receivesOpsAlerts !== undefined
          ? { receivesOpsAlerts: input.receivesOpsAlerts }
          : {}),
        updatedAt: now,
      })
      .where(eq(adminUsers.id, targetId))
      .returning();
    // The 0019 trigger bumps `authz_version` when `sub_role` changed — no
    // manual bump here (M0-F10: the trigger owns it, writers MUST NOT).

    await this.audit.record({
      adminId: actorId,
      action: 'admin.update',
      subjectType: 'admin',
      subjectId: targetId,
      before: redactAdminForAudit(before),
      after: redactAdminForAudit(after!),
      reason: input.reason,
      ip: context.ip ?? null,
      userAgent: context.userAgent ?? null,
    });

    if (subRoleChanging) {
      await this.killSessions(targetId, 'sub_role_changed');
    }

    return toDetail(after!);
  }

  async deactivate(
    actorId: string,
    targetId: string,
    input: AdminDeactivateAdmin,
    context: SessionContext = {},
  ): Promise<AdminAdminDetail> {
    const before = await this.findById(targetId);
    if (!before) throw ApiException.notFound('Admin not found');
    if (before.status !== 'active') {
      throw ApiException.conflict('Admin is not active');
    }

    await this.refuseLastSuperAdminRemoval(targetId, before.subRole, null, actorId, context);

    const now = new Date();
    const [after] = await this.db
      .update(adminUsers)
      .set({ status: 'suspended', deactivatedAt: now, deactivatedBy: actorId, updatedAt: now })
      .where(eq(adminUsers.id, targetId))
      .returning();

    await this.audit.record({
      adminId: actorId,
      action: 'admin.deactivate',
      subjectType: 'admin',
      subjectId: targetId,
      before: redactAdminForAudit(before),
      after: redactAdminForAudit(after!),
      reason: input.reason,
      ip: context.ip ?? null,
      userAgent: context.userAgent ?? null,
    });

    await this.killSessions(targetId, 'deactivated');

    return toDetail(after!);
  }

  async reactivate(
    actorId: string,
    targetId: string,
    input: AdminDeactivateAdmin,
    context: SessionContext = {},
  ): Promise<AdminAdminDetail> {
    const before = await this.findById(targetId);
    if (!before) throw ApiException.notFound('Admin not found');
    if (before.status === 'active') {
      throw ApiException.conflict('Admin is already active');
    }

    const now = new Date();
    const [after] = await this.db
      .update(adminUsers)
      .set({ status: 'active', deactivatedAt: null, deactivatedBy: null, updatedAt: now })
      .where(eq(adminUsers.id, targetId))
      .returning();

    await this.audit.record({
      adminId: actorId,
      action: 'admin.reactivate',
      subjectType: 'admin',
      subjectId: targetId,
      before: redactAdminForAudit(before),
      after: redactAdminForAudit(after!),
      reason: input.reason,
      ip: context.ip ?? null,
      userAgent: context.userAgent ?? null,
    });

    return toDetail(after!);
  }

  async resetPassword(
    actorId: string,
    targetId: string,
    context: SessionContext = {},
  ): Promise<AdminResetPasswordResponse> {
    const before = await this.findById(targetId);
    if (!before) throw ApiException.notFound('Admin not found');

    // A reset must not coexist with live sessions: whoever holds the old
    // sessions could keep working while the temp password travels out of
    // band. The admin logs back in with the temp and is forced through the
    // completion route by `must_change_password`.
    const temporaryPassword = randomBytes(TEMP_PASSWORD_BYTES).toString('base64url');
    const now = new Date();
    await this.db
      .update(adminUsers)
      .set({
        passwordHash: await hashPassword(temporaryPassword),
        mustChangePassword: true,
        failedAttempts: 0,
        lockedUntil: null,
        updatedAt: now,
      })
      .where(eq(adminUsers.id, targetId));

    await this.audit.record({
      adminId: actorId,
      action: 'admin.password_reset',
      subjectType: 'admin',
      subjectId: targetId,
      before: redactAdminForAudit(before),
      after: { mustChangePassword: true },
      reason: null,
      ip: context.ip ?? null,
      userAgent: context.userAgent ?? null,
    });

    await this.killSessions(targetId, 'password_reset');

    return { adminId: targetId, temporaryPassword };
  }

  private async findById(adminId: string) {
    const [row] = await this.db.select().from(adminUsers).where(eq(adminUsers.id, adminId)).limit(1);
    return row ?? null;
  }

  /**
   * Refuses to strand the platform without a super_admin — when deactivating
   * (`nextSubRole` null) or demoting away from it. The refusal is audited
   * OUTSIDE any transaction (same shape as the commission guardrail): a
   * refused write leaves no row change, but it must still leave a trace.
   */
  private async refuseLastSuperAdminRemoval(
    targetId: string,
    currentSubRole: string,
    nextSubRole: string | null | undefined,
    actorId: string,
    context: SessionContext,
  ): Promise<void> {
    const removing =
      currentSubRole === 'super_admin' && nextSubRole !== 'super_admin';
    if (!removing) return;

    const totalRows = await this.db
      .select({ total: count() })
      .from(adminUsers)
      .where(and(eq(adminUsers.subRole, 'super_admin'), eq(adminUsers.status, 'active'), ne(adminUsers.id, targetId)));

    if ((totalRows[0]?.total ?? 0) === 0) {
      await this.audit.record({
        adminId: actorId,
        action: 'admin.deactivate.refused',
        subjectType: 'admin',
        subjectId: targetId,
        before: null,
        after: null,
        reason: 'Refused: the last active super_admin cannot be removed',
        ip: context.ip ?? null,
        userAgent: context.userAgent ?? null,
      });
      throw new ApiException(
        HttpStatus.CONFLICT,
        ErrorCodes.LAST_SUPER_ADMIN,
        'The last active super_admin cannot be deactivated or demoted — promote a successor first',
      );
    }
  }

  /**
   * Kills the refresh family immediately AND tells every node to drop the
   * admin's sockets. The publish is W1-3's contract: `admin.gateway` consumes
   * `admin:revoke` and leaves `admin:user:{id}`. Until W1-3 lands the publish
   * has no consumer — session revocation ( enforced on the next request by
   * the A17 guard) is what actually bites today, and the e2e asserts that.
   */
  private async killSessions(targetId: string, reason: string): Promise<void> {
    await this.tokens.revokeSubject(targetId, 'admin', reason);
    await this.redis.publish(
      ADMIN_REVOKE_CHANNEL,
      JSON.stringify({ adminId: targetId, reason, at: new Date().toISOString() }),
    );
  }
}

/**
 * Audit projection for admin rows. `AdminAuditService` writes whole
 * before/after — for admin subjects that would persist credential material,
 * so every call site above passes through here instead. Unit-pinned key by
 * key in `admin-users.e2e.spec.ts` (no password_hash, no TOTP secrets).
 */
export function redactAdminForAudit(row: Record<string, unknown>): Record<string, unknown> {
  const { passwordHash: _passwordHash, twofaSecretEnc: _twofaSecretEnc, twofaSecret: _twofaSecret, ...rest } = row;
  void _passwordHash;
  void _twofaSecretEnc;
  void _twofaSecret;
  return rest;
}

function listConditions(query: AdminAdminsQuery) {
  const conditions = [];
  if (query.subRole) conditions.push(eq(adminUsers.subRole, query.subRole));
  if (query.status) conditions.push(eq(adminUsers.status, query.status));
  if (query.q) {
    // Small table, no trigram yet (W6 brings `pg_trgm` for the big tables).
    // LIKE metacharacters in the input are escaped so `%` cannot become "all".
    const needle = `%${query.q.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
    conditions.push(
      or(
        ilike(adminUsers.name, needle),
        ilike(adminUsers.email, needle),
        ilike(adminUsers.mobile, needle),
      ),
    );
  }
  return conditions;
}

const listColumns = {
  id: adminUsers.id,
  email: adminUsers.email,
  name: adminUsers.name,
  mobile: adminUsers.mobile,
  subRole: adminUsers.subRole,
  status: adminUsers.status,
  twofaEnabled: adminUsers.twofaEnabled,
  receivesOpsAlerts: adminUsers.receivesOpsAlerts,
  mustChangePassword: adminUsers.mustChangePassword,
  lastLoginAt: adminUsers.lastLoginAt,
  createdAt: adminUsers.createdAt,
};

type AdminRow = typeof adminUsers.$inferSelect;

function toListItem(row: Pick<AdminRow, keyof typeof listColumns>): AdminAdminListItem {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    mobile: row.mobile,
    subRole: row.subRole,
    status: row.status,
    twofaEnabled: row.twofaEnabled,
    receivesOpsAlerts: row.receivesOpsAlerts,
    mustChangePassword: row.mustChangePassword,
    lastLoginAt: row.lastLoginAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

function toDetail(row: AdminRow): AdminAdminDetail {
  return {
    ...toListItem(row),
    createdBy: row.createdBy,
    deactivatedAt: row.deactivatedAt?.toISOString() ?? null,
    deactivatedBy: row.deactivatedBy,
    twofaConfirmedAt: row.twofaConfirmedAt?.toISOString() ?? null,
  };
}
