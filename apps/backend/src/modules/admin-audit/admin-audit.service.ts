import { Inject, Injectable } from '@nestjs/common';
import {
  adminCan,
  type AdminAuditDetail,
  type AdminAuditListResponse,
  type AdminAuditQuery,
  type AdminPermission,
  type AdminSubRole,
} from '@towing/api-contracts';
import { and, desc, eq, gte, like, lt, lte, or, type SQL } from 'drizzle-orm';
import { ApiException } from '../../common/errors/api-exception';
import { DB, type Database } from '../../db/db.module';
import { adminActions } from '../../db/schema';

const DEFAULT_LIMIT = 50;

/** The caller, as far as audit visibility cares: who they are and what they are. */
export interface AuditViewer {
  id: string;
  subRole: AdminSubRole;
}

/**
 * Which subject-scoped audit reads a subject type unlocks (§3.5: "subject-scoped
 * reads follow whoever may read the subject").
 *
 * Each mapping reuses the SAME permission the subject's own screens are gated
 * on — `user.read` is the directory read for drivers/users/fleets, `kyc.read`
 * is deliberately NOT used for `driver` because finance holds `user.read` and
 * not `kyc.read`, and finance does need suspension history on a driver.
 *
 * A subject type NOT in this map has no cross-admin readers: only its actors
 * see its rows. That is the fail-closed default, and it is what makes this map
 * a gate rather than a comment.
 */
const SUBJECT_READ_PERMISSION: Record<string, AdminPermission> = {
  admin: 'admin.manage',
  booking: 'booking.read',
  dispute: 'dispute.handle',
  payout: 'finance.read',
  refund: 'finance.read',
  driver: 'user.read',
  user: 'user.read',
  fleet: 'user.read',
  sos_alert: 'sos.handle',
  support_ticket: 'ticket.handle',
  deletion_request: 'privacy.handle',
};

/**
 * The audit viewer (§3.5, §20.4) — read side of `admin_actions`.
 *
 * One WHERE builder feeds both consumers: the unscoped feed and the
 * subject-scoped timeline a detail screen renders (`?subjectType=&subjectId=`).
 *
 * VISIBILITY IS ENDPOINT-LEVEL, not route-level: every sub-role holds
 * `audit.read` (it means "may reach the route") and this service is where the
 * limitation lives — a non-super-admin sees their OWN rows plus rows on
 * subjects they may read, and nothing else. A super admin sees everything.
 */
@Injectable()
export class AdminAuditService {
  constructor(@Inject(DB) private readonly db: Database) {}

  async list(viewer: AuditViewer, query: AdminAuditQuery): Promise<AdminAuditListResponse> {
    const limit = query.limit ?? DEFAULT_LIMIT;
    const cursor = query.cursor ? decodeCursor(query.cursor) : null;

    const rows = await this.db
      .select({
        id: adminActions.id,
        adminId: adminActions.adminId,
        action: adminActions.action,
        subjectType: adminActions.subjectType,
        subjectId: adminActions.subjectId,
        reason: adminActions.reason,
        ip: adminActions.ip,
        userAgent: adminActions.userAgent,
        createdAt: adminActions.createdAt,
      })
      .from(adminActions)
      .where(
        and(
          this.visibilityPredicate(viewer, query),
          query.adminId ? eq(adminActions.adminId, query.adminId) : undefined,
          // Prefix filter, escaped: a user-supplied `%` must match literally.
          query.action ? like(adminActions.action, `${escapeLike(query.action)}%`) : undefined,
          query.subjectType ? eq(adminActions.subjectType, query.subjectType) : undefined,
          query.subjectId ? eq(adminActions.subjectId, query.subjectId) : undefined,
          query.from ? gte(adminActions.createdAt, parseInstant(query.from, 'from')) : undefined,
          query.to ? lte(adminActions.createdAt, parseInstant(query.to, 'to')) : undefined,
          // Keyset, not OFFSET: `(created_at, id)` strictly after the cursor in
          // DESCENDING order. The id tiebreak is what keeps a page boundary
          // from dropping rows that share a timestamp — which a bulk action
          // writes by the dozen.
          cursor
            ? or(
                lt(adminActions.createdAt, cursor.createdAt),
                and(
                  eq(adminActions.createdAt, cursor.createdAt),
                  lt(adminActions.id, cursor.id),
                ),
              )
            : undefined,
        ),
      )
      .orderBy(desc(adminActions.createdAt), desc(adminActions.id))
      .limit(limit + 1);

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;

    return {
      entries: page.map((row) => ({
        id: row.id,
        adminId: row.adminId,
        action: row.action,
        subjectType: row.subjectType,
        subjectId: row.subjectId,
        reason: row.reason,
        ip: row.ip,
        userAgent: row.userAgent,
        createdAt: row.createdAt.toISOString(),
      })),
      nextCursor: hasMore ? encodeCursor(page[page.length - 1]!) : null,
    };
  }

  async detail(viewer: AuditViewer, id: string): Promise<AdminAuditDetail> {
    const [row] = await this.db
      .select()
      .from(adminActions)
      .where(eq(adminActions.id, id))
      .limit(1);

    // Other admins' rows on subjects this viewer cannot read are a 404, not a
    // 403: whether a given admin action EXISTS is itself information the audit
    // trail should not leak by status code.
    if (!row || !this.mayRead(viewer, row.adminId, row.subjectType)) {
      throw ApiException.notFound('Audit entry not found');
    }

    return {
      id: row.id,
      adminId: row.adminId,
      action: row.action,
      subjectType: row.subjectType,
      subjectId: row.subjectId,
      reason: row.reason,
      ip: row.ip,
      userAgent: row.userAgent,
      createdAt: row.createdAt.toISOString(),
      before: row.before ?? null,
      after: row.after ?? null,
    };
  }

  /** `undefined` = no restriction (super admin); otherwise the per-viewer WHERE. */
  private visibilityPredicate(viewer: AuditViewer, query: AdminAuditQuery): SQL | undefined {
    if (viewer.subRole === 'super_admin') return undefined;

    const own = eq(adminActions.adminId, viewer.id);

    // A subject-scoped page (BOTH halves present — one alone is just a filter)
    // also carries rows on that subject when the viewer may read its type.
    if (query.subjectType && query.subjectId && this.subjectReadable(viewer, query.subjectType)) {
      return or(
        own,
        and(
          eq(adminActions.subjectType, query.subjectType),
          eq(adminActions.subjectId, query.subjectId),
        ),
      );
    }

    return own;
  }

  private mayRead(viewer: AuditViewer, adminId: string, subjectType: string): boolean {
    if (viewer.subRole === 'super_admin') return true;
    if (adminId === viewer.id) return true;
    return this.subjectReadable(viewer, subjectType);
  }

  private subjectReadable(viewer: AuditViewer, subjectType: string): boolean {
    const permission = SUBJECT_READ_PERMISSION[subjectType];
    return permission !== undefined && adminCan(viewer.subRole, permission);
  }
}

/**
 * Cursors are `base64url(ISO instant + '|' + row id)` — opaque to the client
 * (it echoes what it was given), but a malformed one is a 422, never a silent
 * page restart. A `lastIndexOf` split rather than `split('|')`: ISO instants
 * contain no `|`, but the id is the regex-anchored half and wanton splitting
 * only hides bugs.
 */
function encodeCursor(row: { createdAt: Date; id: string }): string {
  return Buffer.from(`${row.createdAt.toISOString()}|${row.id}`, 'utf8').toString('base64url');
}

function decodeCursor(cursor: string): { createdAt: Date; id: string } {
  const raw = Buffer.from(cursor, 'base64url').toString('utf8');
  const separator = raw.lastIndexOf('|');

  if (separator > 0) {
    const createdAt = new Date(raw.slice(0, separator));
    const id = raw.slice(separator + 1);

    if (
      !Number.isNaN(createdAt.getTime()) &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
    ) {
      return { createdAt, id };
    }
  }

  throw ApiException.validation('Invalid pagination cursor');
}

function parseInstant(value: string, field: string): Date {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw ApiException.validation(`\`${field}\` is not a valid instant`);
  }
  return parsed;
}

/** Postgres LIKE treats `%`, `_` and the backslash itself as syntax. */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}
