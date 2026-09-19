import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  DISPUTE_OPENED_FROM_STATUSES,
  ErrorCodes,
  paiseToRupeeString,
  rupeeStringToPaise,
  type AdminDispute,
  type AdminDisputeAssignBody,
  type AdminDisputeDetail,
  type AdminDisputeEvidence,
  type AdminDisputeEvidenceConfirmBody,
  type AdminDisputeEvidencePresignResponse,
  type AdminDisputeNoteBody,
  type AdminDisputeOpenBody,
  type AdminDisputeOpenResponse,
  type AdminDisputeResolveBody,
  type AdminDisputeResolveResponse,
  type AdminDisputesQuery,
  type AdminDisputesResponse,
  type AdminSubRole,
  type JobStatus,
} from '@towing/api-contracts';
import { ApiException } from '../../common/errors/api-exception';
import { isUniqueViolation } from '../../common/errors/pg-errors';
import { NotificationService } from '../../common/notifications/notification.service';
import {
  STORAGE,
  type StoragePort,
} from '../../common/storage/storage.port';
import { PresignedUploadService } from '../../common/storage/presigned-upload.helper';
import { DB, type Database } from '../../db/db.module';
import { ledgerKeys } from '../../db/ledger/idempotency-keys';
import { LedgerService } from '../../db/ledger/ledger.service';
import { AdminAuditService } from '../admin-auth/admin-audit.service';
import { AdminNotesService } from '../admin-notes/admin-notes.service';
import { BookingStateMachineService } from '../bookings/booking-state-machine.service';
import { JobExecutionService } from '../job-execution/job-execution.service';
import { RefundsService } from '../money/refunds.service';
import { PricingConfigRepo } from '../pricing/pricing-config.repo';
import type { SessionContext } from '../auth/token.service';
import { AdminBookingsRepo } from './admin-bookings.repo';
import { AdminDisputesRepo } from './admin-disputes.repo';

/** Evidence uploads ride the presign→confirm shape; this is the key namespace. */
const EVIDENCE_PREFIX = 'dispute-evidence';
/** How long an evidence thumbnail URL lives — long enough to view, short enough to leak safely. */
const EVIDENCE_URL_TTL_SECONDS = 900;

/**
 * W8's dispute lifecycle (§9.4.7, §5.6, §12.2).
 *
 * THE FIVE EXITS ARE THE WHOLE DESIGN — every dispute must be leavable, and
 * the exit decides where the booking lands and what money moves:
 *
 * | Opened from           | Resolution            | Ends at   | Money                                   |
 * | --------------------- | --------------------- | --------- | --------------------------------------- |
 * | in_progress/completed | `complete_and_charge` | completed | normal capture (settlement from completed) |
 * | in_progress/completed | `cancel_no_charge`    | cancelled | no capture; pending intents failed; optional platform comp |
 * | paid                  | `uphold_charge`       | paid      | nothing — A9's settlement guard applies |
 * | paid                  | `full_refund`         | cancelled | the full reversal, dispute-keyed        |
 * | paid                  | `partial_refund`      | paid      | gateway refund of X + liable-party clawback |
 *
 * The resolver ENFORCES this table rather than trusting the caller: an exit is
 * refused when the dispute did not open from one of its origins (`opened_from`
 * is pinned at open time for exactly this reason), and `disputed → paid` still
 * passes through A9's `DISPUTE_NOT_SETTLED` guard inside the state machine —
 * this service inherits it, it cannot bypass it.
 *
 * The refunds carry the DISPUTE-KEYED v2 grammar (`rf:v2:<booking>:<kind>:dispute:<id>`),
 * so retrying a resolution replays and a second, separately-resolved dispute on
 * the same booking is a new refund rather than a collision.
 */
@Injectable()
export class AdminDisputesService {
  private readonly logger = new Logger(AdminDisputesService.name);

  constructor(
    private readonly repo: AdminDisputesRepo,
    private readonly bookings: AdminBookingsRepo,
    private readonly machine: BookingStateMachineService,
    private readonly refunds: RefundsService,
    private readonly ledger: LedgerService,
    private readonly jobs: JobExecutionService,
    private readonly notes: AdminNotesService,
    private readonly audit: AdminAuditService,
    private readonly notifications: NotificationService,
    private readonly uploads: PresignedUploadService,
    private readonly rateCards: PricingConfigRepo,
    @Inject(STORAGE) private readonly storage: StoragePort,
    @Inject(DB) private readonly db: Database,
  ) {}

  // -------------------------------------------------------------------------
  // Open + queue + detail
  // -------------------------------------------------------------------------

  async open(
    adminId: string,
    bookingId: string,
    body: AdminDisputeOpenBody,
    context: SessionContext,
  ): Promise<AdminDisputeOpenResponse> {
    const booking = await this.bookings.actionRow(bookingId);
    if (!booking) throw ApiException.notFound('Booking not found');

    if (!DISPUTE_OPENED_FROM_STATUSES.includes(booking.status as never)) {
      throw new ApiException(
        409,
        ErrorCodes.INVALID_BOOKING_STATE,
        `A ${booking.status} booking has no dispute exit — disputes open from ` +
          DISPUTE_OPENED_FROM_STATUSES.join(', '),
        { status: booking.status },
      );
    }

    let disputeId: string;
    let transition: Awaited<ReturnType<BookingStateMachineService['transition']>>;
    try {
      const created = await this.db.transaction(async (tx) => {
        const inserted = await this.repo.insert(
          {
            bookingId,
            adminId,
            reasonCode: body.reasonCode,
            description: body.description,
            openedFromStatus: booking.status,
          },
          tx,
        );
        const moved = await this.machine.transition(tx, {
          bookingId,
          to: 'disputed',
          actor: 'admin',
          actorId: adminId,
          note: `Dispute opened (${body.reasonCode})`,
        });
        return { inserted, moved };
      });
      disputeId = created.inserted.id;
      transition = created.moved;
    } catch (error) {
      // The partial unique index — "one OPEN dispute per booking" — is a
      // database fact; this is where it becomes a 409 a person can read.
      if (isUniqueViolation(error)) {
        throw new ApiException(
          409,
          ErrorCodes.INVALID_BOOKING_STATE,
          'This booking already has an open dispute',
          { bookingId },
        );
      }
      throw error;
    }

    await this.machine.announce(transition);

    await this.emitTrigger('dispute.opened', {
      disputeId,
      bookingId,
      userId: booking.userId,
      driverId: booking.driverId,
      status: 'open',
    });

    await this.audit.record({
      adminId,
      action: 'dispute.open',
      subjectType: 'dispute',
      subjectId: disputeId,
      after: {
        bookingId,
        reasonCode: body.reasonCode,
        openedFromStatus: booking.status,
      },
      reason: body.description,
      ip: context.ip ?? null,
      userAgent: context.userAgent ?? null,
    });

    return { disputeId, bookingId, status: 'open', openedFromStatus: booking.status };
  }

  async list(query: AdminDisputesQuery): Promise<AdminDisputesResponse> {
    const result = await this.repo.queue({
      query,
      limit: query.limit,
      offset: (query.page - 1) * query.limit,
    });
    return { ...result, page: query.page, limit: query.limit };
  }

  async detail(disputeId: string): Promise<AdminDisputeDetail> {
    const found = await this.repo.detail(disputeId);
    if (!found) throw ApiException.notFound('Dispute not found');

    const evidence: AdminDisputeEvidence[] = await Promise.all(
      found.evidence.map(async (row) => {
        const presigned = await this.storage.presignGet(row.fileKey, EVIDENCE_URL_TTL_SECONDS);
        return {
          id: row.id,
          kind: row.kind,
          note: row.note,
          uploadedByType: row.uploadedByType,
          uploadedById: row.uploadedById,
          createdAt: row.createdAt,
          url: presigned.url,
        };
      }),
    );

    return { ...found.dispute, evidence };
  }

  // -------------------------------------------------------------------------
  // Workflow: assign, note, evidence
  // -------------------------------------------------------------------------

  async assign(
    adminId: string,
    disputeId: string,
    body: AdminDisputeAssignBody,
    context: SessionContext,
  ): Promise<AdminDispute> {
    const target = body.adminId ?? adminId;
    const moved = await this.repo.assign(disputeId, target);
    if (!moved) throw await this.refusalFor(disputeId);

    await this.audit.record({
      adminId,
      action: 'dispute.assign',
      subjectType: 'dispute',
      subjectId: disputeId,
      after: { assignedAdminId: target },
      ip: context.ip ?? null,
      userAgent: context.userAgent ?? null,
    });

    // The detail IS the row plus evidence; the contract's row shape is exactly
    // its subset, so this is assignable without a cast.
    return this.detail(disputeId);
  }

  /** `POST :id/note` — a note row through the shared notes service, plus the dispute audit trail. */
  async note(
    adminId: string,
    subRole: AdminSubRole,
    disputeId: string,
    body: AdminDisputeNoteBody,
    context: SessionContext,
  ): Promise<{ noteId: string }> {
    const dispute = await this.repo.byId(disputeId);
    if (!dispute) throw ApiException.notFound('Dispute not found');

    const note = await this.notes.create(
      { id: adminId, subRole },
      { subjectType: 'dispute', subjectId: disputeId, body: body.note },
      context,
    );

    await this.audit.record({
      adminId,
      action: 'dispute.note',
      subjectType: 'dispute',
      subjectId: disputeId,
      after: { noteId: note.id },
      reason: body.note,
      ip: context.ip ?? null,
      userAgent: context.userAgent ?? null,
    });

    return { noteId: note.id };
  }

  async evidencePresign(disputeId: string): Promise<AdminDisputeEvidencePresignResponse> {
    const dispute = await this.repo.byId(disputeId);
    if (!dispute) throw ApiException.notFound('Dispute not found');
    if (dispute.status === 'resolved') {
      throw new ApiException(
        409,
        ErrorCodes.INVALID_BOOKING_STATE,
        'A resolved dispute takes no further evidence',
      );
    }

    const slot = await this.uploads.presign(EVIDENCE_PREFIX, disputeId, 'evidence');
    return { uploadUrl: slot.uploadUrl, key: slot.key, expiresAt: slot.expiresAt };
  }

  async evidenceConfirm(
    adminId: string,
    disputeId: string,
    body: AdminDisputeEvidenceConfirmBody,
    context: SessionContext,
  ): Promise<AdminDisputeEvidence> {
    const dispute = await this.repo.byId(disputeId);
    if (!dispute) throw ApiException.notFound('Dispute not found');
    if (dispute.status === 'resolved') {
      throw new ApiException(
        409,
        ErrorCodes.INVALID_BOOKING_STATE,
        'A resolved dispute takes no further evidence',
      );
    }

    // A key from someone else's presign would still carry a valid signature —
    // the exact-shape check is what keeps evidence with the dispute that
    // minted the slot (same rule as KYC documents).
    if (!this.uploads.isOwnKey(body.key, EVIDENCE_PREFIX, disputeId, 'evidence')) {
      throw ApiException.validation('That upload key does not belong to this dispute', {
        key: body.key,
      });
    }

    const evidenceId = await this.repo.insertEvidence({
      disputeId,
      adminId,
      kind: body.kind,
      fileKey: body.key,
      note: body.note ?? null,
    });

    await this.audit.record({
      adminId,
      action: 'dispute.evidence',
      subjectType: 'dispute',
      subjectId: disputeId,
      after: { evidenceId, kind: body.kind },
      ip: context.ip ?? null,
      userAgent: context.userAgent ?? null,
    });

    const presigned = await this.storage.presignGet(body.key, EVIDENCE_URL_TTL_SECONDS);
    return {
      id: evidenceId,
      kind: body.kind,
      note: body.note ?? null,
      uploadedByType: 'admin',
      uploadedById: adminId,
      createdAt: new Date().toISOString(),
      url: presigned.url,
    };
  }

  // -------------------------------------------------------------------------
  // Resolve — the five exits
  // -------------------------------------------------------------------------

  async resolve(
    adminId: string,
    disputeId: string,
    body: AdminDisputeResolveBody,
    context: SessionContext,
  ): Promise<AdminDisputeResolveResponse> {
    const dispute = await this.repo.byId(disputeId);
    if (!dispute) throw ApiException.notFound('Dispute not found');
    if (dispute.status === 'resolved') {
      throw new ApiException(
        409,
        ErrorCodes.INVALID_BOOKING_STATE,
        'This dispute is already resolved',
      );
    }

    const booking = await this.bookings.actionRow(dispute.bookingId);
    if (!booking) throw ApiException.notFound('Booking not found');

    const openedFromPaid = dispute.openedFromStatus === 'paid';
    let bookingStatus: JobStatus = booking.status;
    let refundId: string | null = null;
    let refundAmountPaise: number | null = null;

    switch (body.resolution) {
      case 'complete_and_charge': {
        this.requireOrigin(dispute.openedFromStatus, ['in_progress', 'completed']);
        // Through the real completion service: §7.4's waiting charge bills
        // from the booking's own snapshot, and `disputed → completed` is the
        // edge it walks (the state machine allows it; the guard below is the
        // completion itself).
        await this.jobs.completeByAdmin(dispute.bookingId, adminId, body.note);
        bookingStatus = 'completed';
        break;
      }

      case 'cancel_no_charge': {
        this.requireOrigin(dispute.openedFromStatus, ['in_progress', 'completed']);
        const transition = await this.db.transaction((tx) =>
          this.machine.transition(tx, {
            bookingId: dispute.bookingId,
            to: 'cancelled',
            actor: 'admin',
            actorId: adminId,
            note: body.note,
            patch: { cancelledBy: 'admin', cancellationReason: `Dispute: ${body.note}` },
          }),
        );
        // No capture: an intent still open at the gateway is failed rather than
        // left to settle into a booking that was just cancelled.
        await this.repo.failPendingIntents(
          dispute.bookingId,
          'Dispute resolved without charge — the platform cancelled the booking',
        );

        // Optional platform-funded compensation: an `adjustment` (never an
        // earning type), keyed per dispute so a replay is a ledger replay.
        if (body.compensateDriver && dispute.driverId) {
          const { charges } = await this.rateCards.load();
          const compensationPaise = Math.round(
            (rupeeStringToPaise(booking.baseFare) * charges.cancelDriverCompPct) / 100,
          );
          if (compensationPaise > 0) {
            await this.ledger.post([
              {
                owner: { ownerType: 'driver', ownerId: dispute.driverId },
                type: 'adjustment',
                amountPaise: compensationPaise,
                reason: `Dispute compensation (${dispute.id})`,
                refId: dispute.bookingId,
                idempotencyKey: ledgerKeys.disputeCompensation(dispute.id),
              },
            ]);
          }
        }

        await this.machine.announce(transition);
        bookingStatus = 'cancelled';
        break;
      }

      case 'uphold_charge': {
        if (!openedFromPaid) {
          throw new ApiException(
            409,
            ErrorCodes.INVALID_BOOKING_STATE,
            'Only a dispute opened from a paid booking can uphold the charge — ' +
              'this booking never settled',
            { openedFromStatus: dispute.openedFromStatus },
          );
        }
        // A9's guard lives inside `transition()`: `disputed → paid` refuses
        // with DISPUTE_NOT_SETTLED unless a captured payment and settlement
        // legs exist. This service cannot bypass it, which is the point.
        const transition = await this.db.transaction((tx) =>
          this.machine.transition(tx, {
            bookingId: dispute.bookingId,
            to: 'paid',
            actor: 'admin',
            actorId: adminId,
            note: body.note,
          }),
        );
        await this.machine.announce(transition);
        bookingStatus = 'paid';
        break;
      }

      case 'full_refund': {
        if (!openedFromPaid) {
          throw new ApiException(
            409,
            ErrorCodes.INVALID_BOOKING_STATE,
            'Only a dispute opened from a paid booking carries money to refund',
            { openedFromStatus: dispute.openedFromStatus },
          );
        }
        const result = await this.refunds.refundBooking({
          bookingId: dispute.bookingId,
          reason: 'dispute',
          initiatedBy: adminId,
          transitionTo: 'cancelled',
          note: body.note,
          keySource: { kind: 'dispute', disputeId },
        });
        refundId = result.refundId;
        const amount = await this.repo.refundAmount(result.refundId);
        refundAmountPaise = amount === null ? null : rupeeStringToPaise(amount);
        bookingStatus = 'cancelled';

        await this.audit.record({
          adminId,
          action: 'refund.issue',
          subjectType: 'refund',
          subjectId: refundId,
          after: { bookingId: dispute.bookingId, kind: 'full', amountPaise: refundAmountPaise },
          reason: body.note,
          ip: context.ip ?? null,
          userAgent: context.userAgent ?? null,
        });
        break;
      }

      case 'partial_refund': {
        if (!openedFromPaid) {
          throw new ApiException(
            409,
            ErrorCodes.INVALID_BOOKING_STATE,
            'Only a dispute opened from a paid booking carries money to refund',
            { openedFromStatus: dispute.openedFromStatus },
          );
        }
        // The exit table's "ends at `paid`": the booking is `disputed` right
        // now, so it walks back first (A9 guards the edge), then the partial
        // refund claws back the liable party's share and leaves the booking
        // `paid` — drift-free by construction.
        const transition = await this.db.transaction((tx) =>
          this.machine.transition(tx, {
            bookingId: dispute.bookingId,
            to: 'paid',
            actor: 'admin',
            actorId: adminId,
            note: body.note,
          }),
        );
        await this.machine.announce(transition);

        const result = await this.refunds.refundPartial({
          bookingId: dispute.bookingId,
          amountPaise: body.refundAmountPaise!,
          liability: body.liability!,
          reason: 'dispute',
          initiatedBy: adminId,
          keySource: { kind: 'dispute', disputeId },
        });
        refundId = result.refundId;
        refundAmountPaise = body.refundAmountPaise!;
        bookingStatus = 'paid';

        await this.audit.record({
          adminId,
          action: 'refund.issue',
          subjectType: 'refund',
          subjectId: refundId,
          after: {
            bookingId: dispute.bookingId,
            kind: 'partial',
            amountPaise: refundAmountPaise,
            liability: body.liability,
          },
          reason: body.note,
          ip: context.ip ?? null,
          userAgent: context.userAgent ?? null,
        });
        break;
      }
    }

    const resolved = await this.repo.markResolved({
      disputeId,
      adminId,
      resolution: body.resolution,
      liability: body.liability ?? null,
      refundId,
      refundAmount: refundAmountPaise === null ? null : paiseToRupeeString(refundAmountPaise),
      note: body.note,
    });
    if (!resolved) {
      // Lost a double-resolve race: the winner's row stands. The money actions
      // above were either replays (dispute-keyed refunds) or refused edges.
      throw new ApiException(
        409,
        ErrorCodes.INVALID_BOOKING_STATE,
        'This dispute was resolved by another operator while this request was in flight',
      );
    }

    await this.emitTrigger('dispute.resolved', {
      disputeId,
      bookingId: dispute.bookingId,
      userId: dispute.userId,
      driverId: dispute.driverId,
      status: 'resolved',
      resolution: body.resolution,
    });

    await this.audit.record({
      adminId,
      action: 'dispute.resolve',
      subjectType: 'dispute',
      subjectId: disputeId,
      before: { status: dispute.status, openedFromStatus: dispute.openedFromStatus },
      after: {
        status: 'resolved',
        resolution: body.resolution,
        liability: body.liability ?? null,
        refundId,
        refundAmountPaise,
        bookingStatus,
      },
      reason: body.note,
      ip: context.ip ?? null,
      userAgent: context.userAgent ?? null,
    });

    this.logger.log(
      `event=dispute_resolved dispute=${disputeId} booking=${dispute.bookingId} ` +
        `resolution=${body.resolution} refund=${refundId ?? 'none'}`,
    );

    return {
      disputeId,
      status: 'resolved',
      resolution: body.resolution,
      bookingStatus,
      refundId,
      refundAmountPaise,
    };
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  /** An exit only exists for the origins its row in the table covers. */
  private requireOrigin(from: JobStatus, allowed: readonly JobStatus[]): void {
    if (!allowed.includes(from)) {
      throw new ApiException(
        409,
        ErrorCodes.INVALID_BOOKING_STATE,
        `This exit does not apply to a dispute opened from ${from} ` +
          `(it is defined for ${allowed.join(', ')})`,
        { openedFromStatus: from, allowed },
      );
    }
  }

  /** 404 vs 409 for an assign that did not move — resolved disputes take no readers. */
  private async refusalFor(disputeId: string): Promise<ApiException> {
    const dispute = await this.repo.byId(disputeId);
    if (!dispute) return ApiException.notFound('Dispute not found');
    return new ApiException(
      409,
      ErrorCodes.INVALID_BOOKING_STATE,
      'A resolved dispute cannot be reassigned',
    );
  }

  /**
   * The two §12.2 triggers, fire-and-warn: a notification failure must never
   * fail a resolution that already moved money. The dedupe keys are
   * `(disputeId, status)` — stable across a double-submit, distinct across the
   * open and the resolve.
   */
  private async emitTrigger(event: string, payload: Record<string, unknown>): Promise<void> {
    try {
      await this.notifications.emit(event, payload);
    } catch (error) {
      this.logger.warn(`${event} notification failed for ${payload.disputeId}: ${String(error)}`);
    }
  }
}
