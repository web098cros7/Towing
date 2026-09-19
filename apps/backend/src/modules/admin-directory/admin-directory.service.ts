import { Injectable } from '@nestjs/common';
import type {
  AdminDirectorySuspendBody,
  AdminDirectorySuspendResponse,
  AdminDirectoryUserBookingsQuery,
  AdminDirectoryUserBookingsResponse,
  AdminDirectoryUserDetail,
  AdminDirectoryUsersQuery,
  AdminDirectoryUsersResponse,
  AdminSuspensionRequest,
  AdminSuspensionRequestCreateBody,
  AdminSuspensionRequestDecisionBody,
  AdminSuspensionRequestsQuery,
  AdminSuspensionRequestsResponse,
} from '@towing/api-contracts';
import { ApiException } from '../../common/errors/api-exception';
import type { SessionContext } from '../auth/token.service';
import { AdminAuditService } from '../admin-auth/admin-audit.service';
import { AccountSuspensionService } from './account-suspension.service';
import { AdminDirectoryRepo } from './admin-directory.repo';

/**
 * W6's directory orchestration: user list/detail/trips, and the suspension
 * REQUEST flow (§4.2). Execution lives in `AccountSuspensionService` — this
 * service never touches a subject's status itself.
 */
@Injectable()
export class AdminDirectoryService {
  constructor(
    private readonly repo: AdminDirectoryRepo,
    private readonly suspension: AccountSuspensionService,
    private readonly audit: AdminAuditService,
  ) {}

  users(query: AdminDirectoryUsersQuery): Promise<AdminDirectoryUsersResponse> {
    return this.repo
      .searchUsers({
        q: query.q,
        status: query.status,
        limit: query.limit,
        offset: (query.page - 1) * query.limit,
      })
      .then((result) => ({ ...result, page: query.page, limit: query.limit }));
  }

  async userDetail(userId: string): Promise<AdminDirectoryUserDetail> {
    const detail = await this.repo.userDetail(userId);
    if (!detail) throw ApiException.notFound('User not found');
    return detail;
  }

  userBookings(
    userId: string,
    query: AdminDirectoryUserBookingsQuery,
  ): Promise<AdminDirectoryUserBookingsResponse> {
    return this.repo
      .userBookings({ userId, limit: query.limit, offset: (query.page - 1) * query.limit })
      .then((result) => ({ ...result, page: query.page, limit: query.limit }));
  }

  suspendUser(
    adminId: string,
    userId: string,
    body: AdminDirectorySuspendBody,
    context: SessionContext,
  ): Promise<AdminDirectorySuspendResponse> {
    return this.suspension.suspendUser(adminId, userId, body.reason, context);
  }

  reactivateUser(
    adminId: string,
    userId: string,
    context: SessionContext,
  ): Promise<AdminDirectorySuspendResponse> {
    return this.suspension.reactivateUser(adminId, userId, context);
  }

  /**
   * §4.2's support branch, in the HANDLER rather than the guard: a guard 403
   * fires before any code runs, and the acceptance for this route is "the
   * attempt is refused **and** a request row exists". So the request is filed
   * first (audited as `suspension.request` — rule 5's refusal trail), then the
   * 403 names it.
   */
  async refuseAndFileRequest(
    adminId: string,
    userId: string,
    body: AdminDirectorySuspendBody,
    context: SessionContext,
  ): Promise<never> {
    const request = await this.createRequest(
      adminId,
      { subjectType: 'user', subjectId: userId, reason: body.reason },
      context,
    );
    throw ApiException.forbidden(
      'Suspending an account requires approval — a request was filed for review',
      { requestId: request.id },
    );
  }

  async createRequest(
    adminId: string,
    body: AdminSuspensionRequestCreateBody,
    context: SessionContext,
  ): Promise<AdminSuspensionRequest> {
    if (!(await this.repo.subjectExists(body.subjectType, body.subjectId))) {
      throw ApiException.notFound(`${body.subjectType} not found`);
    }

    let request: AdminSuspensionRequest;
    try {
      request = await this.repo.insertSuspensionRequest({
        subjectType: body.subjectType,
        subjectId: body.subjectId,
        requestedBy: adminId,
        reason: body.reason,
      });
    } catch (error) {
      // The partial unique index makes "one open request per subject" a fact;
      // surfacing its violation is how the inbox never shows duplicates.
      // Drizzle wraps driver errors, so the pg code sits on `cause` too.
      if (isUniqueViolation(error)) {
        throw ApiException.conflict('An open suspension request already exists for this subject');
      }
      throw error;
    }

    await this.audit.record({
      adminId,
      action: 'suspension.request',
      subjectType: body.subjectType,
      subjectId: body.subjectId,
      after: { requestId: request.id, reason: body.reason },
      reason: body.reason,
      ip: context.ip ?? null,
      userAgent: context.userAgent ?? null,
    });

    return request;
  }

  listRequests(query: AdminSuspensionRequestsQuery): Promise<AdminSuspensionRequestsResponse> {
    return this.repo.listSuspensionRequests(query.status ?? 'open').then((items) => ({ items }));
  }

  /**
   * Approval EXECUTES the suspension through the one service, then marks the
   * request decided. That order matters: a failed execution leaves the request
   * open for a retry instead of silently dropping the decision.
   */
  async approveRequest(
    adminId: string,
    requestId: string,
    body: AdminSuspensionRequestDecisionBody,
    context: SessionContext,
  ): Promise<AdminSuspensionRequest> {
    const request = await this.openRequestOrThrow(requestId);
    await this.suspension.suspendSubject(
      adminId,
      request.subjectType,
      request.subjectId,
      request.reason,
      context,
    );
    await this.repo.decideSuspensionRequest(requestId, {
      status: 'approved',
      decidedBy: adminId,
      note: body.note ?? null,
    });
    await this.audit.record({
      adminId,
      action: 'suspension.approve',
      subjectType: request.subjectType,
      subjectId: request.subjectId,
      before: { requestId, status: 'open' },
      after: { requestId, status: 'approved' },
      reason: body.note ?? request.reason,
      ip: context.ip ?? null,
      userAgent: context.userAgent ?? null,
    });
    return {
      ...request,
      status: 'approved',
      decidedBy: adminId,
      decidedAt: new Date().toISOString(),
      decisionNote: body.note ?? null,
    };
  }

  async rejectRequest(
    adminId: string,
    requestId: string,
    body: AdminSuspensionRequestDecisionBody,
    context: SessionContext,
  ): Promise<AdminSuspensionRequest> {
    const request = await this.openRequestOrThrow(requestId);
    await this.repo.decideSuspensionRequest(requestId, {
      status: 'rejected',
      decidedBy: adminId,
      note: body.note ?? null,
    });
    await this.audit.record({
      adminId,
      action: 'suspension.reject',
      subjectType: request.subjectType,
      subjectId: request.subjectId,
      before: { requestId, status: 'open' },
      after: { requestId, status: 'rejected', note: body.note ?? null },
      reason: body.note ?? request.reason,
      ip: context.ip ?? null,
      userAgent: context.userAgent ?? null,
    });
    return {
      ...request,
      status: 'rejected',
      decidedBy: adminId,
      decidedAt: new Date().toISOString(),
      decisionNote: body.note ?? null,
    };
  }

  private async openRequestOrThrow(requestId: string): Promise<AdminSuspensionRequest> {
    const request = await this.repo.suspensionRequest(requestId);
    if (!request) throw ApiException.notFound('Suspension request not found');
    if (request.status !== 'open') {
      throw ApiException.conflict('This suspension request has already been decided');
    }
    return request;
  }
}

/** postgres.js puts the SQLSTATE on the error; drizzle may wrap it in `cause`. */
function isUniqueViolation(error: unknown): boolean {
  const code =
    (error as { code?: string }).code ?? (error as { cause?: { code?: string } }).cause?.code;
  return code === '23505';
}
