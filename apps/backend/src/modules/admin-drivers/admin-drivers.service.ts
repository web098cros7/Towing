import { HttpStatus, Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import type {
  AdminCapabilitiesResponse,
  AdminCapabilitiesUpdate,
  AdminDocumentReview,
  AdminDocumentReviewResult,
  AdminKycDecision,
  AdminKycResult,
  AdminPendingDriversResponse,
} from '@towing/api-contracts';
import { ErrorCodes } from '@towing/api-contracts';
import { and, asc, eq, sql } from 'drizzle-orm';
import { ApiException } from '../../common/errors/api-exception';
import { DeviceRegistryService } from '../../common/notifications/device-registry.service';
import { NotificationService } from '../../common/notifications/notification.service';
import { keyFromFileUrl } from '../../common/storage/file-url';
import { STORAGE, type StoragePort } from '../../common/storage/storage.port';
import { DB, type Database } from '../../db/db.module';
import { bookings, driverDocuments, drivers } from '../../db/schema';
import { QUEUE, type QueuePort } from '../../common/queue/queue.port';
import { ACTIVE_JOB_STATUSES } from '../bookings/booking-state-machine.service';
import type { KycStatus } from '../auth/auth.types';
import { TokenService, type SessionContext } from '../auth/token.service';
import { DriverPresenceService } from '../driver-presence/driver-presence.service';
import { AdminAuditService } from '../admin-auth/admin-audit.service';

/** Where each driver-level decision lands. */
const NEXT_STATUS: Record<AdminKycDecision['decision'], KycStatus> = {
  approve: 'approved',
  reject: 'rejected',
  // Back to `incomplete`, not `pending`: the driver needs to act (resubmit a
  // document) before this can be `pending` again — leaving it `pending` would
  // put a request-info'd driver right back in the queue with nothing changed.
  request_info: 'incomplete',
  suspend: 'suspended',
  // Back to `pending` rather than `approved`: reinstating an account is not the
  // same judgement as approving its documents, and a human should make the
  // second one explicitly.
  reactivate: 'pending',
};

/** Thumbnail links in the queue are short-lived — re-fetch the queue rather than caching them. */
const THUMBNAIL_TTL_SECONDS = 5 * 60;

/**
 * The §3.1 KYC queue and per-document review (Phase 11) — built on Phase 10's
 * single `decide()` action, which now lives here instead of `admin-auth`
 * (that module stays authentication-only).
 */
@Injectable()
export class AdminDriversService implements OnModuleInit {
  private readonly logger = new Logger(AdminDriversService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(QUEUE) private readonly queue: QueuePort,
    private readonly audit: AdminAuditService,
    private readonly tokens: TokenService,
    @Inject(STORAGE) private readonly storage: StoragePort,
    private readonly notifications: NotificationService,
    private readonly deviceRegistry: DeviceRegistryService,
    private readonly presence: DriverPresenceService,
  ) {}

  /**
   * The worker over `applyPendingSuspension` — see the `admin.apply-suspension`
   * job docs in `queue.port.ts`. One line by design, like the dispatch
   * workers: the logic lives in the method the queue-off suite calls directly.
   */
  onModuleInit(): void {
    this.queue.process('admin.apply-suspension', async ({ driverId }) => {
      await this.applyPendingSuspension(driverId);
    });
  }

  async decide(
    adminId: string,
    driverId: string,
    body: AdminKycDecision,
    context: SessionContext = {},
  ): Promise<AdminKycResult> {
    const [before] = await this.db
      .select({
        id: drivers.id,
        name: drivers.name,
        kycStatus: drivers.kycStatus,
        rejectionReason: drivers.rejectionReason,
        approvedBy: drivers.approvedBy,
        pendingSuspensionReason: drivers.pendingSuspensionReason,
        pendingSuspensionBy: drivers.pendingSuspensionBy,
        pendingSuspensionAt: drivers.pendingSuspensionAt,
      })
      .from(drivers)
      .where(eq(drivers.id, driverId))
      .limit(1);

    if (!before) throw ApiException.notFound('Driver not found');

    // A14: suspension is two-mode — it owns its audit and side effects.
    if (body.decision === 'suspend') {
      return this.suspend(adminId, driverId, body, context, before);
    }

    const status = NEXT_STATUS[body.decision];
    const approving = body.decision === 'approve';
    const now = new Date();

    const [after] = await this.db
      .update(drivers)
      .set({
        kycStatus: status,
        // `approved_by` now references `admin_users` (migration 0007). Cleared
        // on any non-approval so a rejected/reinstated driver does not keep a
        // stale approver.
        approvedBy: approving ? adminId : null,
        approvedAt: approving ? now : null,
        rejectionReason: ['reject', 'request_info'].includes(body.decision)
          ? (body.reason ?? null)
          : null,
        // A14: reinstating clears a shelved suspension, or the next completed
        // job would suspend a driver an admin just cleared.
        ...(body.decision === 'reactivate'
          ? { pendingSuspensionReason: null, pendingSuspensionBy: null, pendingSuspensionAt: null }
          : {}),
        updatedAt: now,
      })
      .where(eq(drivers.id, driverId))
      .returning({
        id: drivers.id,
        kycStatus: drivers.kycStatus,
        rejectionReason: drivers.rejectionReason,
        approvedBy: drivers.approvedBy,
      });

    /**
     * Losing authority must be IMMEDIATE, not eventual (§9.4.3).
     *
     * Without this, a suspended or rejected driver keeps a valid access token
     * for the rest of its 900-second life and could accept a job in that window.
     * `DriverRealmPolicy` covers the same ground at the next refresh; this
     * closes the gap before it.
     */
    const revokesAuthority = status === 'suspended' || status === 'rejected';
    const sessionsRevoked = revokesAuthority
      ? await this.tokens.revokeSubject(driverId, 'driver', `kyc_${body.decision}`)
      : 0;

    // Devices are revoked alongside sessions for SUSPENSION only (invariant 73).
    // A push token outlives the session on its handset, and a suspended driver
    // must stop receiving anything at all.
    //
    // NOT for `reject`: the rejection push has to reach the very phone that is
    // about to be told why it was rejected, and revoking first would silently
    // drop it. That token is cleared by the driver's own logout, or replaced on
    // the next registration.
    if (status === 'suspended') {
      await this.deviceRegistry.revokeAllForSubject('driver', driverId, 'kyc_suspended');
    }

    /**
     * ...and the same immediacy for SUPPLY (Phase 16).
     *
     * Revoking sessions and devices stops the driver ACTING; it does not remove
     * them from §6.1's candidate store, which is keyed in Redis and knows
     * nothing about tokens. A suspended driver left in a GEO set is phantom
     * supply: dispatch scores them, locks an offer against them, and waits out
     * the timeout while the customer's search widens for no reason.
     *
     * `evictRevoked` swallows its own failures — the ping path re-checks approval
     * whenever it rehydrates, and the hot hash expires in 30s regardless, so the
     * worst case here is a delayed eviction rather than a permanent one. An
     * admin's recorded decision must not fail because Redis blinked.
     */
    if (revokesAuthority) {
      await this.presence.evictRevoked(driverId);
    }

    // Written after the mutation and awaited, not fire-and-forget: an audit row
    // that can silently go missing is worse than none, because it is trusted.
    const auditId = await this.audit.record({
      adminId,
      action: `driver.kyc.${body.decision}`,
      subjectType: 'driver',
      subjectId: driverId,
      before,
      after: after ?? null,
      reason: body.reason ?? null,
      ip: context.ip ?? null,
      userAgent: context.userAgent ?? null,
    });

    // §9.4.3's AC: "action triggers driver notification (Push+SMS+WhatsApp)".
    // Until Phase 13 this sent nothing at all, and the driver learned their fate
    // by opening the app and pulling to refresh.
    //
    // THE APPROVAL PATH IS THE ONE THAT MATTERS and it is deliberately not
    // fighting the revocation above: `revokesAuthority` covers only `suspended`
    // and `rejected`, so an approved driver's session is fully intact and the
    // push can drive an in-place refetch that unlocks the online toggle.
    //
    // Best-effort. A notification failure must never undo a recorded decision —
    // and `emit` only writes rows and enqueues, so a provider outage cannot
    // reach this far anyway.
    const NOTIFY_EVENT: Partial<Record<AdminKycDecision['decision'], string>> = {
      approve: 'driver.kyc.approved',
      reject: 'driver.kyc.rejected',
      request_info: 'driver.kyc.request_info',
    };
    const event = NOTIFY_EVENT[body.decision];
    if (event) {
      try {
        await this.notifications.emit(event, {
          driverId,
          driverName: before.name,
          reason: body.reason ?? null,
          auditId,
        });
      } catch (error) {
        this.logger.warn(`kyc ${body.decision} notification failed: ${String(error)}`);
      }
    }

    return {
      driverId,
      kycStatus: after!.kycStatus,
      rejectionReason: after!.rejectionReason,
      sessionsRevoked,
      suspensionPending: false,
    };
  }

  /**
   * A14's two-mode suspension. `KycApprovedGuard` is deliberately untouched —
   * the grace lives here, not in the gate.
   *
   * - `after_current_job` (default): with a live booking, the suspension is
   *   shelved on the driver row, the driver is evicted from presence and
   *   blocked from new offers, and everything else — sessions, devices,
   *   `kyc_status` — stays so they can finish the job. It applies when the
   *   job ends (`applyPendingSuspension`, called from completion, unable and
   *   cancel paths). With no live booking it suspends at once.
   * - `immediate`: suspends at once, but is refused while a live booking
   *   exists — the booking needs a disposition (reassign/cancel) first, and
   *   those admin actions land in W8. Ending the trip out from under the
   *   driver here would strand the customer.
   */
  private async suspend(
    adminId: string,
    driverId: string,
    body: AdminKycDecision,
    context: SessionContext,
    before: {
      id: string;
      name: string | null;
      kycStatus: KycStatus;
      rejectionReason: string | null;
      approvedBy: string | null;
    },
  ): Promise<AdminKycResult> {
    const mode = body.mode ?? 'after_current_job';
    const live = await this.liveBooking(driverId);
    const now = new Date();

    if (live && mode === 'immediate') {
      throw new ApiException(
        HttpStatus.CONFLICT,
        ErrorCodes.INVALID_BOOKING_STATE,
        'Driver holds an active booking — reassign or cancel it first (admin dispositions land in W8), or suspend after the current job',
        { bookingId: live.id, status: live.status },
      );
    }

    if (live) {
      const [after] = await this.db
        .update(drivers)
        .set({
          pendingSuspensionReason: body.reason ?? null,
          pendingSuspensionBy: adminId,
          pendingSuspensionAt: now,
          updatedAt: now,
        })
        .where(eq(drivers.id, driverId))
        .returning({
          id: drivers.id,
          kycStatus: drivers.kycStatus,
          rejectionReason: drivers.rejectionReason,
          approvedBy: drivers.approvedBy,
          pendingSuspensionReason: drivers.pendingSuspensionReason,
          pendingSuspensionBy: drivers.pendingSuspensionBy,
          pendingSuspensionAt: drivers.pendingSuspensionAt,
        });

      // 18 Sep correction: NO evict here. `evictRevoked` deletes the driver
      // hash and flips `is_online` off, so every later ping comes back unknown
      // → rehydrate refuses → the customer's live tracking freezes for the
      // rest of the job, the trip replay loses its tail, and EnRouteWatcher
      // goes blind. Eviction buys nothing either: eligibility already excludes
      // a driver with an active booking, and the shelf keeps them out if the
      // booking goes back to searching. Sessions, devices, `kyc_status` and
      // presence all stay — the driver must finish the job. Eviction happens
      // in `applyPendingSuspension`, when the suspension actually applies.
      await this.audit.record({
        adminId,
        action: 'driver.kyc.suspend',
        subjectType: 'driver',
        subjectId: driverId,
        before: before as unknown as Record<string, unknown>,
        after: (after ?? null) as unknown as Record<string, unknown> | null,
        reason: body.reason ?? null,
        ip: context.ip ?? null,
        userAgent: context.userAgent ?? null,
      });

      return {
        driverId,
        kycStatus: after!.kycStatus,
        rejectionReason: after!.rejectionReason,
        sessionsRevoked: 0,
        suspensionPending: true,
      };
    }

    // No live booking: the pre-A14 immediate path, verbatim in effect.
    const [after] = await this.db
      .update(drivers)
      .set({
        kycStatus: 'suspended',
        approvedBy: null,
        approvedAt: null,
        rejectionReason: null,
        pendingSuspensionReason: null,
        pendingSuspensionBy: null,
        pendingSuspensionAt: null,
        updatedAt: now,
      })
      .where(eq(drivers.id, driverId))
      .returning({
        id: drivers.id,
        kycStatus: drivers.kycStatus,
        rejectionReason: drivers.rejectionReason,
        approvedBy: drivers.approvedBy,
      });

    const sessionsRevoked = await this.tokens.revokeSubject(driverId, 'driver', 'kyc_suspend');
    await this.deviceRegistry.revokeAllForSubject('driver', driverId, 'kyc_suspended');
    await this.presence.evictRevoked(driverId);

    await this.audit.record({
      adminId,
      action: 'driver.kyc.suspend',
      subjectType: 'driver',
      subjectId: driverId,
      before: before as unknown as Record<string, unknown>,
      after: (after ?? null) as unknown as Record<string, unknown> | null,
      reason: body.reason ?? null,
      ip: context.ip ?? null,
      userAgent: context.userAgent ?? null,
    });

    return {
      driverId,
      kycStatus: after!.kycStatus,
      rejectionReason: after!.rejectionReason,
      sessionsRevoked,
      suspensionPending: false,
    };
  }

  /**
   * Applies a shelved suspension once the driver's job has ended — called
   * from job completion, unable-to-deliver and cancellation, the three paths
   * that free a driver. No-op when nothing is shelved or the driver somehow
   * holds another live booking (defensive: callers invoke this exactly when a
   * job ended, but a second assignment racing the call must not suspend
   * under it — the shelf survives for the next ending).
   *
   * Never throws: a suspension that fails to apply must not fail the
   * completion/cancellation it rides on. The shelf stays, eligibility keeps
   * blocking offers, and the next job ending retries.
   */
  async applyPendingSuspension(driverId: string): Promise<boolean> {
    const [pending] = await this.db
      .select({
        reason: drivers.pendingSuspensionReason,
        by: drivers.pendingSuspensionBy,
        at: drivers.pendingSuspensionAt,
      })
      .from(drivers)
      .where(eq(drivers.id, driverId))
      .limit(1);

    if (!pending?.at) return false;
    if (!pending.by) {
      // A shelf without an author is corrupt data, not a suspension: applying
      // it would write an audit row no admin can own (`admin_id` is a uuid FK).
      this.logger.warn(`deferred suspension for ${driverId} has no author — leaving shelved`);
      return false;
    }
    if (await this.liveBooking(driverId)) {
      this.logger.warn(`deferred suspension for ${driverId} skipped — driver holds another live booking`);
      return false;
    }

    try {
      const now = new Date();
      await this.db
        .update(drivers)
        .set({
          kycStatus: 'suspended',
          approvedBy: null,
          approvedAt: null,
          rejectionReason: null,
          pendingSuspensionReason: null,
          pendingSuspensionBy: null,
          pendingSuspensionAt: null,
          updatedAt: now,
        })
        .where(eq(drivers.id, driverId));

      await this.tokens.revokeSubject(driverId, 'driver', 'kyc_suspend_deferred');
      await this.deviceRegistry.revokeAllForSubject('driver', driverId, 'kyc_suspended');
      await this.presence.evictRevoked(driverId);

      await this.audit.record({
        adminId: pending.by,
        action: 'driver.kyc.suspend',
        subjectType: 'driver',
        subjectId: driverId,
        before: { pendingSuspensionReason: pending.reason, pendingSuspensionAt: pending.at },
        after: { kycStatus: 'suspended' },
        reason: pending.reason,
        ip: null,
        userAgent: null,
      });
      return true;
    } catch (error) {
      this.logger.warn(
        `deferred suspension for ${driverId} failed to apply: ${error instanceof Error ? error.message : String(error)}`,
      );
      return false;
    }
  }

  /** The driver's live booking, if any — assigned, en route, arrived or in progress. */
  private async liveBooking(driverId: string): Promise<{ id: string; status: string } | null> {
    const [row] = (await this.db.execute(sql`
      select id, status from bookings
       where driver_id = ${driverId}::uuid
         and status in (${sql.join(
           ACTIVE_JOB_STATUSES.map((status) => sql`${status}::booking_status`),
           sql`, `,
         )})
       limit 1
    `)) as unknown as Array<{ id: string; status: string }>;
    return row ?? null;
  }

  /**
   * Strictly `kyc_status = 'pending'` — "submitted and awaiting a human", per
   * migration 0007's default change. An `incomplete` driver (nothing submitted
   * yet) must never appear here, however long ago they signed up.
   */
  async pending(): Promise<AdminPendingDriversResponse> {
    const rows = await this.db
      .select({
        id: drivers.id,
        name: drivers.name,
        mobile: drivers.mobile,
        vehicleClass: drivers.vehicleClass,
        longDistanceEnabled: drivers.longDistanceEnabled,
        kycSubmittedAt: drivers.kycSubmittedAt,
      })
      .from(drivers)
      .where(eq(drivers.kycStatus, 'pending'))
      // Oldest submission first — a queue should clear front-to-back.
      .orderBy(asc(drivers.kycSubmittedAt));

    const items = await Promise.all(
      rows.map(async (row) => {
        const docs = await this.db
          .select({
            id: driverDocuments.id,
            docType: driverDocuments.docType,
            status: driverDocuments.status,
            rejectionReason: driverDocuments.rejectionReason,
            fileUrl: driverDocuments.fileUrl,
          })
          .from(driverDocuments)
          .where(eq(driverDocuments.driverId, row.id));

        const documents = await Promise.all(
          docs.map(async (doc) => {
            const thumbnail = await this.storage.presignGet(
              keyFromFileUrl(doc.fileUrl),
              THUMBNAIL_TTL_SECONDS,
            );
            return {
              id: doc.id,
              docType: doc.docType,
              status: doc.status,
              rejectionReason: doc.rejectionReason,
              thumbnailUrl: thumbnail.url,
            };
          }),
        );

        return {
          id: row.id,
          name: row.name,
          mobile: row.mobile,
          vehicleClass: row.vehicleClass,
          longDistanceEnabled: row.longDistanceEnabled,
          kycSubmittedAt: row.kycSubmittedAt?.toISOString() ?? null,
          documents,
        };
      }),
    );

    return { items };
  }

  /**
   * Per-document review — new in Phase 11. `driverId` is checked against the
   * document's own `driver_id`, not just used to build the query: without it,
   * a valid `docId` for a DIFFERENT driver, addressed through this driver's
   * URL, would silently review the wrong person's document.
   */
  async reviewDocument(
    adminId: string,
    driverId: string,
    documentId: string,
    body: AdminDocumentReview,
    context: SessionContext = {},
  ): Promise<AdminDocumentReviewResult> {
    const [before] = await this.db
      .select({
        id: driverDocuments.id,
        driverId: driverDocuments.driverId,
        docType: driverDocuments.docType,
        status: driverDocuments.status,
        rejectionReason: driverDocuments.rejectionReason,
      })
      .from(driverDocuments)
      .where(and(eq(driverDocuments.id, documentId), eq(driverDocuments.driverId, driverId)))
      .limit(1);

    if (!before) throw ApiException.notFound('Document not found');

    const status = body.decision === 'approve' ? ('approved' as const) : ('rejected' as const);
    const now = new Date();

    const [after] = await this.db
      .update(driverDocuments)
      .set({
        status,
        rejectionReason: body.decision === 'reject' ? (body.reason ?? null) : null,
        verifiedBy: adminId,
        verifiedAt: now,
        updatedAt: now,
      })
      .where(eq(driverDocuments.id, documentId))
      .returning({
        id: driverDocuments.id,
        docType: driverDocuments.docType,
        status: driverDocuments.status,
        rejectionReason: driverDocuments.rejectionReason,
      });

    await this.audit.record({
      adminId,
      action: `driver.document.${body.decision}`,
      subjectType: 'driver_document',
      subjectId: documentId,
      before,
      after,
      reason: body.reason ?? null,
      ip: context.ip ?? null,
      userAgent: context.userAgent ?? null,
    });

    return {
      documentId: after!.id,
      docType: after!.docType,
      status: after!.status,
      rejectionReason: after!.rejectionReason,
    };
  }

  /** §3.2 — admin can revoke (or grant) the Band C long-haul opt-in and reclassify vehicle class. */
  async updateCapabilities(
    adminId: string,
    driverId: string,
    body: AdminCapabilitiesUpdate,
    context: SessionContext = {},
  ): Promise<AdminCapabilitiesResponse> {
    const [before] = await this.db
      .select({ vehicleClass: drivers.vehicleClass, longDistanceEnabled: drivers.longDistanceEnabled })
      .from(drivers)
      .where(eq(drivers.id, driverId))
      .limit(1);
    if (!before) throw ApiException.notFound('Driver not found');

    const [after] = await this.db
      .update(drivers)
      .set({
        ...(body.vehicleClass !== undefined ? { vehicleClass: body.vehicleClass } : {}),
        ...(body.longDistanceEnabled !== undefined
          ? { longDistanceEnabled: body.longDistanceEnabled }
          : {}),
        updatedAt: new Date(),
      })
      .where(eq(drivers.id, driverId))
      .returning({ vehicleClass: drivers.vehicleClass, longDistanceEnabled: drivers.longDistanceEnabled });

    await this.audit.record({
      adminId,
      action: 'driver.capabilities.update',
      subjectType: 'driver',
      subjectId: driverId,
      before,
      after,
      ip: context.ip ?? null,
      userAgent: context.userAgent ?? null,
    });

    return after!;
  }
}
