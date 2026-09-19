import { Injectable } from '@nestjs/common';
import type {
  AdminDirectorySuspendBody,
  AdminDirectorySuspendResponse,
  AdminDirectoryUserBookingsQuery,
  AdminDirectoryUserBookingsResponse,
  AdminDirectoryUserDetail,
  AdminDirectoryUsersQuery,
  AdminDirectoryUsersResponse,
  AdminDriverBookingsQuery,
  AdminDriverBookingsResponse,
  AdminDriverDecisionResponse,
  AdminDriverDirectoryDetail,
  AdminDriverSuspendBody,
  AdminDriverZonesResponse,
  AdminDriverZonesUpdate,
  AdminDriversDirectoryQuery,
  AdminDriversDirectoryResponse,
  AdminDirectoryZonesResponse,
  AdminFleetDetail,
  AdminFleetSuspendBody,
  AdminFleetSuspensionResponse,
  AdminFleetsQuery,
  AdminFleetsResponse,
  AdminSuspensionRequest,
  AdminSuspensionRequestCreateBody,
  AdminSuspensionRequestDecisionBody,
  AdminSuspensionRequestsQuery,
  AdminSuspensionRequestsResponse,
  DriversListResponse,
  EarningsQuery,
  EarningsSummaryDto,
  FleetId,
  PageQuery,
  SuspensionRequestSubjectType,
  TrucksListQuery,
  TrucksListResponse,
} from '@towing/api-contracts';
import { ApiException } from '../../common/errors/api-exception';
import type { SessionContext } from '../auth/token.service';
import { AdminAuditService } from '../admin-auth/admin-audit.service';
import { DriversService } from '../drivers/drivers.service';
import { EarningsService } from '../money/earnings.service';
import { TrucksService } from '../trucks/trucks.service';
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
    private readonly trucks: TrucksService,
    private readonly driversService: DriversService,
    private readonly earnings: EarningsService,
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

  // -------------------------------------------------------------------------
  // W6: drivers directory (#9.4.4)
  // -------------------------------------------------------------------------

  drivers(query: AdminDriversDirectoryQuery): Promise<AdminDriversDirectoryResponse> {
    return this.repo
      .searchDrivers({
        q: query.q,
        kycStatus: query.kycStatus,
        online: query.online,
        longDistance: query.longDistance,
        zoneId: query.zoneId,
        fleetId: query.fleetId,
        vehicleClass: query.vehicleClass,
        minRating: query.minRating,
        limit: query.limit,
        offset: (query.page - 1) * query.limit,
      })
      .then((result) => ({ ...result, page: query.page, limit: query.limit }));
  }

  async driverDetail(driverId: string): Promise<AdminDriverDirectoryDetail> {
    const detail = await this.repo.driverDetail(driverId);
    if (!detail) throw ApiException.notFound('Driver not found');
    return detail;
  }

  driverBookings(
    driverId: string,
    query: AdminDriverBookingsQuery,
  ): Promise<AdminDriverBookingsResponse> {
    return this.repo
      .driverBookings({ driverId, limit: query.limit, offset: (query.page - 1) * query.limit })
      .then((result) => ({ ...result, page: query.page, limit: query.limit }));
  }

  suspendDriver(
    adminId: string,
    driverId: string,
    body: AdminDriverSuspendBody,
    context: SessionContext,
  ): Promise<AdminDriverDecisionResponse> {
    return this.suspension.suspendDriver(adminId, driverId, body.reason, context, {
      mode: body.mode,
    });
  }

  reactivateDriver(
    adminId: string,
    driverId: string,
    context: SessionContext,
  ): Promise<AdminDriverDecisionResponse> {
    return this.suspension.reactivateDriver(adminId, driverId, context);
  }

  /**
   * §6.10's zone editor. A FULL REPLACEMENT — the editor saves the new set.
   * Skipping the write AND the audit when the set is unchanged keeps a
   * double-click from looking like a decision; the diff lives in the audit
   * row's before/after.
   */
  async updateDriverZones(
    adminId: string,
    driverId: string,
    body: AdminDriverZonesUpdate,
    context: SessionContext,
  ): Promise<AdminDriverZonesResponse> {
    const before = await this.repo.driverZoneRefs(driverId);
    if (!before) throw ApiException.notFound('Driver not found');

    const wanted = new Set(body.zoneIds);
    const missing = await this.repo.missingZoneIds(body.zoneIds);
    if (missing.length > 0) {
      throw ApiException.notFound(`Service zone ${missing[0]} not found`);
    }

    const currentIds = before.map((zone) => zone.zoneId);
    const unchanged =
      currentIds.length === wanted.size && currentIds.every((id) => wanted.has(id));
    if (!unchanged) {
      await this.repo.replaceDriverZoneRestrictions(driverId, body.zoneIds, adminId);
      await this.audit.record({
        adminId,
        action: 'driver.zones.update',
        subjectType: 'driver',
        subjectId: driverId,
        before: { zoneIds: currentIds },
        after: { zoneIds: body.zoneIds },
        reason: null,
        ip: context.ip ?? null,
        userAgent: context.userAgent ?? null,
      });
    }

    const zoneRestrictions = (await this.repo.driverZoneRefs(driverId)) ?? [];
    return { driverId, zoneRestrictions };
  }

  // -------------------------------------------------------------------------
  // W6: fleets directory (#9.4.5)
  // -------------------------------------------------------------------------

  fleets(query: AdminFleetsQuery): Promise<AdminFleetsResponse> {
    return this.repo
      .searchFleets({
        q: query.q,
        status: query.status,
        limit: query.limit,
        offset: (query.page - 1) * query.limit,
      })
      .then((result) => ({ ...result, page: query.page, limit: query.limit }));
  }

  async fleetDetail(fleetId: string): Promise<AdminFleetDetail> {
    const detail = await this.repo.fleetDetail(fleetId);
    if (!detail) throw ApiException.notFound('Fleet not found');
    return detail;
  }

  suspendFleet(
    adminId: string,
    fleetId: string,
    body: AdminFleetSuspendBody,
    context: SessionContext,
  ): Promise<AdminFleetSuspensionResponse> {
    return this.suspension.suspendFleet(adminId, fleetId, context, body.reason);
  }

  reactivateFleet(
    adminId: string,
    fleetId: string,
    context: SessionContext,
  ): Promise<AdminFleetSuspensionResponse> {
    return this.suspension.reactivateFleet(adminId, fleetId, context);
  }

  /**
   * The fleet console's own services, handed an ADMIN-CHOSEN fleet instead of
   * the session's (the guide: "nearly free"). The `FleetId` brand exists so a
   * fleet-realm caller cannot paste the wrong id by accident — here the admin
   * deliberately names the tenant, so the cast states the intent exactly once.
   */
  async fleetTrucks(fleetId: string, query: TrucksListQuery): Promise<TrucksListResponse> {
    await this.assertFleet(fleetId);
    return this.trucks.list(fleetId as FleetId, query);
  }

  async fleetDrivers(fleetId: string, query: PageQuery): Promise<DriversListResponse> {
    await this.assertFleet(fleetId);
    return this.driversService.list(fleetId as FleetId, query);
  }

  async fleetEarnings(fleetId: string, query: EarningsQuery): Promise<EarningsSummaryDto> {
    await this.assertFleet(fleetId);
    return this.earnings.summary(fleetId as FleetId, query);
  }

  /** An unknown fleet must 404 on its sub-reads, not read as "empty". */
  private async assertFleet(fleetId: string): Promise<void> {
    if (!(await this.repo.fleetDetail(fleetId))) throw ApiException.notFound('Fleet not found');
  }

  /** C9: the zone picker — id/name/active for every filter and editor. */
  async zones(): Promise<AdminDirectoryZonesResponse> {
    return { items: await this.repo.zones() };
  }

  /**
   * §4.2's support branch, in the HANDLER rather than the guard: a guard 403
   * fires before any code runs, and the acceptance for these routes is "the
   * attempt is refused **and** a request row exists". So the request is filed
   * first (audited as `suspension.request` — rule 5's refusal trail), then the
   * 403 names it. Shared by the user, driver and fleet suspend routes.
   */
  async refuseAndFileRequest(
    adminId: string,
    subjectType: SuspensionRequestSubjectType,
    subjectId: string,
    body: { reason: string },
    context: SessionContext,
  ): Promise<never> {
    const request = await this.createRequest(
      adminId,
      { subjectType, subjectId, reason: body.reason },
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
