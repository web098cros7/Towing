import { Inject, Injectable } from '@nestjs/common';
import type {
  AdminDeletionDecision,
  AdminDeletionHold,
  AdminDeletionRequest,
  AdminDeletionRequestsQuery,
  AdminDeletionRequestsResponse,
  AdminRetentionPoliciesResponse,
  AdminRetentionPolicy,
  AdminRetentionUpdate,
  AdminUserCorrection,
  AdminUserCorrectionResponse,
  AdminSubjectExportResponse,
  DeletionRequestStatus,
  ErasureJob,
} from '@towing/api-contracts';
import { eq, sql } from 'drizzle-orm';
import { ApiException } from '../../common/errors/api-exception';
import { isUniqueViolation } from '../../common/errors/pg-errors';
import { QUEUE, type QueuePort } from '../../common/queue/queue.port';
import { DB, type Database } from '../../db/db.module';
import { bookings, deletionRequests, erasureJobs, retentionPolicies, users } from '../../db/schema';
import { AdminAuditService } from '../admin-auth/admin-audit.service';
import { SWEPT_POLICY_KEYS } from './retention';
import { buildSubjectExport } from './subject-export';

/** The statuses an erasure may start from. `completed` is handled as a no-op first. */
const EXECUTABLE_STATUSES: readonly DeletionRequestStatus[] = ['approved', 'on_hold'];

/** The statuses `approve`/`reject` may move from — anything still open. */
const DECIDABLE_STATUSES: readonly DeletionRequestStatus[] = ['requested', 'on_hold', 'approved'];

interface RequestRow {
  id: string;
  subject_type: string;
  subject_id: string;
  status: string;
  reason: string | null;
  hold_reason: string | null;
  decided_by: string | null;
  decided_at: string | Date | null;
  executed_at: string | Date | null;
  anonymised_at: string | Date | null;
  requested_at: string | Date;
  updated_at: string | Date;
  user_name: string | null;
  user_mobile: string | null;
  driver_name: string | null;
  driver_mobile: string | null;
  total_count?: string | number;
}

interface JobRow {
  id: string;
  request_id: string;
  status: string;
  steps: unknown;
  error: string | null;
  started_at: string | Date | null;
  finished_at: string | Date | null;
  created_at: string | Date;
}

/**
 * W19's admin lane (§20.4 DPDP).
 *
 * THE LANE IS A WORKFLOW, NOT A DELETE BUTTON. Every mutation here changes a
 * `deletion_requests.status` and writes an `admin_actions` row; the only route
 * that actually erases anything enqueues `privacy.erasure` and returns — the
 * HTTP request must not hold a connection open across storage I/O, and the job
 * is idempotent in a way a request handler cannot be.
 *
 * EXECUTE IS A NO-OP ON A COMPLETED REQUEST (200, not 409) on purpose: the
 * button is behind a typed confirmation, an operator who double-taps it or
 * retries after a flaky network has done nothing wrong, and answering a
 * repeat with a conflict would teach them the API is unreliable rather than
 * that the job is done.
 *
 * RETENTION EDITS ARE `admin.manage` (super only) while every other route here
 * is `privacy.handle`: shortening a retention window is a compliance decision
 * about everyone's data, not a case-by-case act on one subject.
 */
@Injectable()
export class AdminPrivacyService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(QUEUE) private readonly queue: QueuePort,
    private readonly audit: AdminAuditService,
  ) {}

  async list(query: AdminDeletionRequestsQuery): Promise<AdminDeletionRequestsResponse> {
    const filters = [sql`true`];
    if (query.status) filters.push(sql`r.status = ${query.status}`);
    if (query.subjectType) filters.push(sql`r.subject_type = ${query.subjectType}`);
    const where = sql.join(filters, sql` and `);
    const offset = (query.page - 1) * query.limit;

    // The label joins the subject tables rather than reading a denormalised
    // name off the request: a request files when the account exists, and the
    // label must follow the account through anonymisation (where it becomes
    // the tombstone and renders as nothing).
    const rows = (await this.db.execute(sql`
      select r.id, r.subject_type, r.subject_id, r.status, r.reason, r.hold_reason,
             r.decided_by, r.decided_at, r.executed_at, r.anonymised_at,
             r.requested_at, r.updated_at,
             u.name as user_name, u.mobile as user_mobile,
             d.name as driver_name, d.mobile as driver_mobile,
             count(*) over() as total_count
        from deletion_requests r
        left join users u on r.subject_type = 'user' and u.id = r.subject_id
        left join drivers d on r.subject_type = 'driver' and d.id = r.subject_id
       where ${where}
       order by r.requested_at desc, r.id desc
       limit ${query.limit} offset ${offset}
    `)) as unknown as RequestRow[];

    const latestJobs = await this.latestJobs(rows.map((row) => row.id));

    return {
      items: rows.map((row) => this.toContract(row, latestJobs.get(row.id) ?? null)),
      page: query.page,
      limit: query.limit,
      total: Number(rows[0]?.total_count ?? 0),
    };
  }

  async detail(requestId: string): Promise<AdminDeletionRequest> {
    const [row] = (await this.db.execute(sql`
      select r.id, r.subject_type, r.subject_id, r.status, r.reason, r.hold_reason,
             r.decided_by, r.decided_at, r.executed_at, r.anonymised_at,
             r.requested_at, r.updated_at,
             u.name as user_name, u.mobile as user_mobile,
             d.name as driver_name, d.mobile as driver_mobile
        from deletion_requests r
        left join users u on r.subject_type = 'user' and u.id = r.subject_id
        left join drivers d on r.subject_type = 'driver' and d.id = r.subject_id
       where r.id = ${requestId}
       limit 1
    `)) as unknown as RequestRow[];

    if (!row) throw ApiException.notFound('Deletion request not found');

    const latestJobs = await this.latestJobs([requestId]);
    return this.toContract(row, latestJobs.get(requestId) ?? null);
  }

  /** `POST …/approve|reject`. */
  async decide(
    adminId: string,
    requestId: string,
    decision: 'approved' | 'rejected',
    body: AdminDeletionDecision,
    context: Context,
  ): Promise<AdminDeletionRequest> {
    const before = await this.requireOpen(requestId, DECIDABLE_STATUSES);
    const now = new Date();

    await this.db
      .update(deletionRequests)
      .set({
        status: decision,
        decidedBy: adminId,
        decidedAt: now,
        // A decision clears a previous hold: leaving the reason behind would
        // make the detail page explain a hold that is no longer in force.
        holdReason: decision === 'approved' ? null : before.hold_reason,
        updatedAt: now,
      })
      .where(eq(deletionRequests.id, requestId));

    await this.audit.record({
      adminId,
      action: `privacy.deletion.${decision === 'approved' ? 'approve' : 'reject'}`,
      subjectType: 'deletion_request',
      subjectId: requestId,
      before: { status: before.status, holdReason: before.hold_reason },
      after: { status: decision },
      reason: body.reason ?? null,
      ...context,
    });

    return this.detail(requestId);
  }

  /** `POST …/hold` — the reason is required by the contract; a hold without one is a bug. */
  async hold(
    adminId: string,
    requestId: string,
    body: AdminDeletionHold,
    context: Context,
  ): Promise<AdminDeletionRequest> {
    const before = await this.requireOpen(requestId, ['requested', 'on_hold', 'approved']);
    const now = new Date();

    await this.db
      .update(deletionRequests)
      .set({ status: 'on_hold', holdReason: body.reason, updatedAt: now })
      .where(eq(deletionRequests.id, requestId));

    await this.audit.record({
      adminId,
      action: 'privacy.deletion.hold',
      subjectType: 'deletion_request',
      subjectId: requestId,
      before: { status: before.status, holdReason: before.hold_reason },
      after: { status: 'on_hold', holdReason: body.reason },
      reason: body.reason,
      ...context,
    });

    return this.detail(requestId);
  }

  /**
   * `POST …/execute` — enqueues the runner. Idempotent when the request is
   * already `completed` (see the class note), and refuses anything that has
   * not been approved: executing a `requested` row would let an operator skip
   * the two-person discipline the workflow exists for.
   */
  async execute(
    adminId: string,
    requestId: string,
    context: Context,
  ): Promise<AdminDeletionRequest> {
    const [row] = await this.db
      .select({ status: deletionRequests.status })
      .from(deletionRequests)
      .where(eq(deletionRequests.id, requestId))
      .limit(1);
    if (!row) throw ApiException.notFound('Deletion request not found');

    if (row.status === 'completed') return this.detail(requestId);

    if (!EXECUTABLE_STATUSES.includes(row.status as DeletionRequestStatus)) {
      throw ApiException.conflict(
        `Nothing to execute: request is ${row.status}. Approve it first.`,
      );
    }

    await this.queue.enqueue(
      'privacy.erasure',
      { requestId },
      // One live job per request: a double tap, or an operator re-queuing while
      // the first job is still waiting, must not run the whole sequence twice.
      { jobId: `privacy-erasure:${requestId}` },
    );

    await this.audit.record({
      adminId,
      action: 'privacy.deletion.execute',
      subjectType: 'deletion_request',
      subjectId: requestId,
      before: { status: row.status },
      after: { status: 'executing' },
      ...context,
    });

    return this.detail(requestId);
  }

  async retention(): Promise<AdminRetentionPoliciesResponse> {
    const rows = await this.db
      .select({
        policyKey: retentionPolicies.policyKey,
        retentionDays: retentionPolicies.retentionDays,
        description: retentionPolicies.description,
        updatedAt: retentionPolicies.updatedAt,
      })
      .from(retentionPolicies);

    const items: AdminRetentionPolicy[] = rows
      .map((row) => ({
        policyKey: row.policyKey,
        retentionDays: row.retentionDays,
        description: row.description,
        enforced: (SWEPT_POLICY_KEYS as readonly string[]).includes(row.policyKey),
        updatedAt: row.updatedAt.toISOString(),
      }))
      .sort((a, b) => a.policyKey.localeCompare(b.policyKey));

    return { items };
  }

  async updateRetention(
    adminId: string,
    body: AdminRetentionUpdate,
    context: Context,
  ): Promise<AdminRetentionPoliciesResponse> {
    const before = await this.retention();
    const known = new Map(before.items.map((item) => [item.policyKey, item]));

    for (const change of body.policies) {
      if (!known.has(change.policyKey)) {
        throw ApiException.validation(`Unknown retention policy: ${change.policyKey}`);
      }
    }

    for (const change of body.policies) {
      await this.db
        .update(retentionPolicies)
        .set({ retentionDays: change.retentionDays, updatedBy: adminId, updatedAt: new Date() })
        .where(eq(retentionPolicies.policyKey, change.policyKey));
    }

    await this.audit.record({
      adminId,
      action: 'privacy.retention.update',
      subjectType: 'privacy_retention',
      subjectId: null,
      before: { policies: before.items.map((i) => ({ key: i.policyKey, days: i.retentionDays })) },
      after: {
        policies: body.policies.map((i) => ({ key: i.policyKey, days: i.retentionDays })),
      },
      ...context,
    });

    return this.retention();
  }

  /** `GET /admin/users/:id/export` — the operator-served access request, audited. */
  async exportUser(
    adminId: string,
    userId: string,
    context: Context,
  ): Promise<AdminSubjectExportResponse> {
    const [user] = await this.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!user) throw ApiException.notFound('User not found');

    const base = await buildSubjectExport(this.db, 'user', userId);
    const bookingRows = await this.db
      .select({
        id: bookings.id,
        status: bookings.status,
        total: bookings.total,
        createdAt: bookings.createdAt,
        completedAt: bookings.completedAt,
      })
      .from(bookings)
      .where(eq(bookings.userId, userId));

    // Access reads of someone else's whole record are exactly what the audit
    // trail is for — the subject cannot see this request, so the row is the
    // only place it is recorded.
    await this.audit.record({
      adminId,
      action: 'privacy.user.export',
      subjectType: 'user',
      subjectId: userId,
      after: { bookings: bookingRows.length, consents: base.consents.length },
      ...context,
    });

    return {
      ...base,
      subjectType: 'user',
      subjectId: userId,
      generatedAt: new Date().toISOString(),
      bookings: bookingRows.map((row) => ({
        id: row.id,
        status: row.status,
        total: String(row.total),
        createdAt: row.createdAt.toISOString(),
        completedAt: row.completedAt?.toISOString() ?? null,
      })),
    };
  }

  /**
   * `POST /admin/users/:id/correct` — DPDP's correction right served by an
   * operator. Customers only: a driver's identity fields are bound to KYC
   * documents a human verified, and editing them here would silently invalidate
   * that verification.
   */
  async correctUser(
    adminId: string,
    userId: string,
    body: AdminUserCorrection,
    context: Context,
  ): Promise<AdminUserCorrectionResponse> {
    const [before] = await this.db
      .select({ id: users.id, name: users.name, email: users.email, mobile: users.mobile })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!before) throw ApiException.notFound('User not found');

    const next = {
      name: body.name ?? before.name,
      email: body.email ?? before.email,
      mobile: body.mobile ?? before.mobile,
    };

    try {
      await this.db
        .update(users)
        .set({ ...next, updatedAt: new Date() })
        .where(eq(users.id, userId));
    } catch (error) {
      // The mobile is a login identity — a collision is a conflict, not a 500.
      if (isUniqueViolation(error)) {
        throw ApiException.conflict('That mobile number belongs to another account');
      }
      throw error;
    }

    await this.audit.record({
      adminId,
      action: 'privacy.user.correct',
      subjectType: 'user',
      subjectId: userId,
      before,
      after: next,
      reason: body.reason,
      ...context,
    });

    return { ...next, id: before.id };
  }

  /** Loads the newest job per request id on a page. */
  private async latestJobs(requestIds: string[]): Promise<Map<string, ErasureJob>> {
    const result = new Map<string, ErasureJob>();
    if (requestIds.length === 0) return result;

    for (const requestId of requestIds) {
      const [job] = (await this.db.execute(sql`
        select id, request_id, status, steps, error, started_at, finished_at, created_at
          from erasure_jobs
         where request_id = ${requestId}
         order by created_at desc, id desc
         limit 1
      `)) as unknown as JobRow[];
      if (job) result.set(requestId, toJobContract(job));
    }

    return result;
  }

  private async requireOpen(
    requestId: string,
    allowed: readonly DeletionRequestStatus[],
  ): Promise<{ status: string; hold_reason: string | null }> {
    const [row] = await this.db
      .select({ status: deletionRequests.status, holdReason: deletionRequests.holdReason })
      .from(deletionRequests)
      .where(eq(deletionRequests.id, requestId))
      .limit(1);
    if (!row) throw ApiException.notFound('Deletion request not found');
    if (!allowed.includes(row.status as DeletionRequestStatus)) {
      throw ApiException.conflict(
        `Request is ${row.status}; this action needs one of ${allowed.join(', ')}`,
      );
    }
    return { status: row.status, hold_reason: row.holdReason };
  }

  private toContract(row: RequestRow, latestJob: ErasureJob | null): AdminDeletionRequest {
    return {
      id: row.id,
      subjectType: row.subject_type === 'driver' ? 'driver' : 'user',
      subjectId: row.subject_id,
      subjectLabel: subjectLabel(row),
      status: row.status as DeletionRequestStatus,
      reason: row.reason,
      holdReason: row.hold_reason,
      decidedBy: row.decided_by,
      decidedAt: iso(row.decided_at),
      executedAt: iso(row.executed_at),
      anonymisedAt: iso(row.anonymised_at),
      requestedAt: iso(row.requested_at)!,
      updatedAt: iso(row.updated_at)!,
      latestJob,
    };
  }
}

/**
 * Raw `db.execute` hands timestamps back as STRINGS, not Dates — the drizzle
 * query builder parses them only on the typed paths. Every raw read in this
 * file passes its instants through here so the contract's `z.iso.datetime()`
 * is fed an ISO string rather than a `Date`.toISOString crash in production.
 */
function iso(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

export interface Context {
  ip?: string | null;
  userAgent?: string | null;
}

/**
 * A name if there is one, else a masked mobile, else nothing. The tombstone
 * (`deleted:<uuid>`) is deliberately NOT rendered: it is the absence of an
 * identity, and showing it as a label would look like a person called
 * "deleted".
 */
function subjectLabel(row: RequestRow): string | null {
  const name = row.subject_type === 'driver' ? row.driver_name : row.user_name;
  const mobile = row.subject_type === 'driver' ? row.driver_mobile : row.user_mobile;
  if (name) return name;
  if (!mobile || mobile.startsWith('deleted:')) return null;
  return `******${mobile.slice(-4)}`;
}

function toJobContract(row: JobRow): ErasureJob {
  return {
    id: row.id,
    status: row.status as ErasureJob['status'],
    steps: row.steps as ErasureJob['steps'],
    error: row.error,
    startedAt: iso(row.started_at),
    finishedAt: iso(row.finished_at),
    createdAt: iso(row.created_at)!,
  };
}
