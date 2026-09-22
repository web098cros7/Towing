import { Inject, Injectable } from '@nestjs/common';
import { DB, type Database, type DatabaseExecutor } from '../../db/db.module';
import { adminActions } from '../../db/schema';

export interface AdminActionRecord {
  adminId: string;
  /** Dotted verb, e.g. `driver.kyc.approve`. */
  action: string;
  subjectType: string;
  subjectId?: string | null;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
  ip?: string | null;
  userAgent?: string | null;
}

/**
 * The sole writer of `admin_actions` (§20.4).
 *
 * Every admin mutation writes one row with the whole before and after state, so
 * "who changed this driver's status, when, and from what" is answerable without
 * reconstructing it from a diff of application logs. Phase 11's approval queue,
 * Phase 19's payout approvals and Phase 20's live-ops actions all record through
 * here rather than each inventing a shape.
 *
 * WRITES ARE NOT OPTIONAL AND NOT FIRE-AND-FORGET: an audit row that silently
 * fails to persist is worse than no audit trail, because it is trusted. If the
 * insert throws, the request fails.
 */
@Injectable()
export class AdminAuditService {
  constructor(@Inject(DB) private readonly db: Database) {}

  /**
   * @returns the inserted row id. Phase 13 uses it as the dedupe key for the
   *   notification a decision emits: it is the one value that is genuinely
   *   one-per-decision, unlike a per-call timestamp, which a double-tapped
   *   admin button produces two distinct copies.
   *
   * A15: `options.tx` writes the row inside the caller's transaction, so a
   * status flip and its audit row commit atomically. Callers without a
   * transaction omit it and behave exactly as before.
   */
  async record(entry: AdminActionRecord, options: { tx?: DatabaseExecutor } = {}): Promise<string> {
    const db = options.tx ?? this.db;
    const [row] = await db.insert(adminActions).values({
      adminId: entry.adminId,
      action: entry.action,
      subjectType: entry.subjectType,
      subjectId: entry.subjectId ?? null,
      // `undefined` would make drizzle omit the column; null is the intent.
      before: entry.before ?? null,
      after: entry.after ?? null,
      reason: entry.reason ?? null,
      ip: entry.ip ?? null,
      userAgent: entry.userAgent ?? null,
    }).returning({ id: adminActions.id });

    return row!.id;
  }
}
